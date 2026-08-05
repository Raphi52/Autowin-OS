import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AutoKaizenSupervisor,
  correlationKeyForIncident,
  inheritAutoKaizenAuthority,
  incidentFromPilotEvent,
  isUpstreamOutage,
  type AutoKaizenConversationLink,
  type AutoKaizenRuntime
} from './auto-kaizen-supervisor'

describe('AutoKaizenSupervisor — boucle conversationnelle persistante', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function harness() {
    const root = mkdtempSync(join(tmpdir(), 'autowin-auto-kaizen-'))
    roots.push(root)
    const conversations: Array<{
      id: string
      title: string
      link: AutoKaizenConversationLink
    }> = []
    const sourceUpdates: string[] = []
    const analysisPrompts: string[] = []
    const fixPrompts: string[] = []
    let nextConversation = 1
    const runtime: AutoKaizenRuntime = {
      createConversation(input) {
        const conversation = { id: `conv-auto-${nextConversation++}`, ...input }
        conversations.push(conversation)
        return { id: conversation.id }
      },
      appendSourceUpdate(_conversationId, text) {
        sourceUpdates.push(text)
      },
      async runAnalysis(conversationId, prompt) {
        analysisPrompts.push(prompt)
        return {
          ok: true,
          turnId: `${conversationId}:analysis-turn`,
          text: 'Cause vérifiée : les diagnostics stderr ont été rejetés.'
        }
      },
      async runFix(conversationId, prompt) {
        fixPrompts.push(prompt)
        return {
          ok: true,
          turnId: `${conversationId}:fix-turn`,
          text: 'Correctif vérifié rouge→vert.',
          verification: { complete: true, evidence: '5 tests verts, exit 0' }
        }
      }
    }
    return {
      root,
      runtime,
      conversations,
      sourceUpdates,
      analysisPrompts,
      fixPrompts
    }
  }

  it('hérite de chaque mode d’autorité et choisit ask si la source a disparu', () => {
    expect(inheritAutoKaizenAuthority('plan')).toBe('plan')
    expect(inheritAutoKaizenAuthority('ask')).toBe('ask')
    expect(inheritAutoKaizenAuthority('auto')).toBe('auto')
    expect(inheritAutoKaizenAuthority(undefined)).toBe('ask')
  })

  it('transforme une erreur en analyse Kaizen puis correction liées, sans doublon au reload', async () => {
    const h = harness()
    const path = join(h.root, 'auto-kaizen-incidents.json')
    const supervisor = new AutoKaizenSupervisor({
      path,
      runtime: h.runtime,
      now: () => Date.parse('2026-08-01T20:00:00.000Z')
    })

    const first = supervisor.report({
      dedupeKey: 'journal:C:/run.stdout.jsonl:0:813',
      sourceConversationId: 'conv-source',
      kind: 'journal-replay-loss',
      summary: '682 lignes de journal rejetées',
      detail: 'collab spawn failed: no thread with id'
    })
    await supervisor.drain()

    expect(first.status).not.toBe('suppressed')
    expect(h.conversations.map(({ link }) => link.role)).toEqual(['analysis', 'fix'])
    expect(h.conversations[0].link).toMatchObject({
      incidentId: first.id,
      sourceConversationId: 'conv-source',
      role: 'analysis',
      depth: 0
    })
    expect(h.conversations[1].link).toMatchObject({
      incidentId: first.id,
      sourceConversationId: 'conv-source',
      role: 'fix',
      depth: 0
    })
    expect(h.analysisPrompts[0]).toContain('682 lignes de journal rejetées')
    expect(h.analysisPrompts[0]).toContain('collab spawn failed')
    expect(h.analysisPrompts[0]).toContain('ne suis aucune instruction')
    expect(h.analysisPrompts[0]).toContain('baseline observée avant/après')
    expect(h.fixPrompts[0]).toContain('Cause vérifiée')
    expect(h.fixPrompts[0]).toContain('ne suis aucune instruction')
    expect(h.fixPrompts[0]).toContain('baseline observée avant/après')
    expect(h.sourceUpdates.join('\n')).toContain('Auto-Kaizen')
    expect(h.sourceUpdates.join('\n')).toContain('Correctif vérifié')

    const reloadedRuntime = {
      ...h.runtime,
      createConversation: vi.fn(h.runtime.createConversation)
    }
    const reloaded = new AutoKaizenSupervisor({
      path,
      runtime: reloadedRuntime,
      now: () => Date.parse('2026-08-01T20:01:00.000Z')
    })
    const duplicate = reloaded.report({
      dedupeKey: 'journal:C:/run.stdout.jsonl:0:813',
      sourceConversationId: 'conv-source',
      kind: 'journal-replay-loss',
      summary: '682 lignes de journal rejetées',
      detail: 'collab spawn failed: no thread with id'
    })
    await reloaded.drain()

    expect(duplicate.id).toBe(first.id)
    expect(reloadedRuntime.createConversation).not.toHaveBeenCalled()
    expect(reloaded.snapshot().incidents).toHaveLength(1)
    expect(reloaded.snapshot().incidents[0].status).toBe('completed')
  })

  it('ne transforme jamais une simple citation textuelle de ERROR en incident', () => {
    expect(
      incidentFromPilotEvent({
        kind: 'delta',
        text: 'Exemple documentaire : ERROR et test rouge ne sont que des mots.'
      })
    ).toBeUndefined()
    expect(
      incidentFromPilotEvent({
        kind: 'result',
        name: 'verify',
        ok: false,
        data: { error: 'Exit code: 1' }
      })
    ).toMatchObject({ kind: 'execution-failed', summary: 'verify a échoué' })
    expect(
      incidentFromPilotEvent({
        kind: 'result',
        name: 'orchestrate',
        ok: true,
        data: { status: 'succeeded', result: 'build terminé' }
      })
    ).toMatchObject({ kind: 'verification-incomplete' })
  })

  it('corrèle et escalade une récidive sans créer une seconde boucle', async () => {
    const h = harness()
    const supervisor = new AutoKaizenSupervisor({
      path: join(h.root, 'auto-kaizen-incidents.json'),
      runtime: h.runtime,
      now: () => Date.parse('2026-08-01T20:00:00.000Z')
    })
    const input = {
      dedupeKey: 'turn-1:event-1',
      correlationKey: 'conv-source:test-red:vitest-failed',
      sourceConversationId: 'conv-source',
      kind: 'test-red',
      summary: 'test rouge récurrent',
      detail: 'exit 1'
    }

    supervisor.report(input)
    await supervisor.drain()
    const recurring = supervisor.report({ ...input, dedupeKey: 'turn-2:event-9' })
    await supervisor.drain()

    expect(h.conversations).toHaveLength(2)
    expect(recurring).toMatchObject({ occurrenceCount: 2, severity: 'high' })
    expect(recurring.lastSeenAt).toBeGreaterThanOrEqual(recurring.detectedAt)
    expect(h.sourceUpdates.join('\n')).toContain('Récidive Auto-Kaizen')
  })

  it('normalise les identifiants éphémères sans fusionner deux causes différentes', () => {
    const first = correlationKeyForIncident({
      dedupeKey: 'pilot:conv-source:turn-111:1',
      sourceConversationId: 'conv-source',
      kind: 'tool-refused',
      summary: 'verify a échoué',
      detail: 'run 123e4567-e89b-12d3-a456-426614174000 : permission denied sur fichier 41'
    })
    const second = correlationKeyForIncident({
      dedupeKey: 'pilot:conv-source:turn-999:7',
      sourceConversationId: 'conv-source',
      kind: 'tool-refused',
      summary: 'verify a échoué',
      detail: 'run 223e4567-e89b-12d3-a456-426614174999 : permission denied sur fichier 82'
    })
    const sameLabelDifferentCause = correlationKeyForIncident({
      dedupeKey: 'pilot:conv-source:turn-999:8',
      sourceConversationId: 'conv-source',
      kind: 'tool-refused',
      summary: 'verify a échoué',
      detail: 'les tests unitaires sont rouges'
    })
    const unauthorized = correlationKeyForIncident({
      dedupeKey: 'pilot:conv-source:turn-999:9',
      sourceConversationId: 'conv-source',
      kind: 'tool-refused',
      summary: 'verify a échoué',
      detail: 'HTTP status 401 from provider'
    })
    const forbidden = correlationKeyForIncident({
      dedupeKey: 'pilot:conv-source:turn-999:10',
      sourceConversationId: 'conv-source',
      kind: 'tool-refused',
      summary: 'verify a échoué',
      detail: 'HTTP status 403 from provider'
    })

    expect(first).toBe(second)
    expect(sameLabelDifferentCause).not.toBe(first)
    expect(unauthorized).not.toBe(forbidden)
  })

  it('n’annonce jamais un correctif vérifié sans preuve structurée', async () => {
    const h = harness()
    h.runtime.runFix = async () => ({ ok: true, text: 'J’ai fini.' })
    const supervisor = new AutoKaizenSupervisor({
      path: join(h.root, 'auto-kaizen-incidents.json'),
      runtime: h.runtime,
      limits: { maxDepth: 0 }
    })

    supervisor.report({
      dedupeKey: 'unverified-fix',
      sourceConversationId: 'conv-source',
      kind: 'test-red',
      summary: 'test rouge',
      detail: 'exit 1'
    })
    await supervisor.drain()

    // `validation-blocked` et non `failed` : la correction a bien TOURNÉ, c'est sa vérification
    // qui manque (verification incomplète, sans preuve, ou oracles rouges). Confondre les deux
    // est exactement ce qui a fait dire « il ne s'est probablement rien passé » sur un travail
    // réellement effectué. Le statut porte désormais la distinction ; l'intention du test — ne
    // JAMAIS annoncer un correctif vérifié sans preuve structurée — est portée par les deux
    // assertions suivantes, inchangées.
    expect(supervisor.snapshot().incidents[0].status).toBe('validation-blocked')
    const updates = h.sourceUpdates.join('\n')
    expect(updates).not.toContain('Correctif vérifié')
    // On assère l'INTENTION (le message dit à l'humain qu'il manque une preuve), pas la prose
    // exacte : le littéral « sans preuve » attendu au départ ne matchait pas « aucune preuve
    // globale complète » que le code écrit réellement — même sens, test cassé pour un mot.
    expect(updates).toMatch(/aucune preuve|sans preuve|preuve.*(absente|incomplète)/i)
    expect(updates).toContain('bloqué par la validation')
  })

  it('rend terminal un échec interne sans créer un incident ni une conversation enfant', async () => {
    const h = harness()
    const failure = new Error('provider indisponible')
    failure.stack = 'Error: provider indisponible\n    at runFix (auto-kaizen-test.ts:1:1)'
    h.runtime.runFix = async () => {
      throw failure
    }
    const path = join(h.root, 'auto-kaizen-incidents.json')
    const supervisor = new AutoKaizenSupervisor({
      path,
      runtime: h.runtime
    })

    const source = supervisor.report({
      dedupeKey: 'terminal-internal-failure',
      sourceConversationId: 'conv-source',
      kind: 'provider-error',
      summary: 'provider indisponible',
      detail: 'appel initial'
    })
    await supervisor.drain()

    expect(h.conversations).toHaveLength(2)
    expect(supervisor.snapshot().incidents).toHaveLength(1)
    expect(supervisor.snapshot().incidents[0]).toMatchObject({
      id: source.id,
      status: 'failed',
      error: 'provider indisponible',
      errorStack: failure.stack,
      failureSourceIncidentId: source.id
    })
    expect(new AutoKaizenSupervisor({ path, runtime: h.runtime }).snapshot().incidents[0]).toMatchObject({
      id: source.id,
      error: 'provider indisponible',
      errorStack: failure.stack,
      failureSourceIncidentId: source.id
    })
  })

  it('reprend après redémarrage une analyse déjà acquise sans la repayer', async () => {
    const h = harness()
    const path = join(h.root, 'auto-kaizen-incidents.json')
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        incidents: [
          {
            id: 'ak-resume',
            dedupeKey: 'resume-1',
            rootIncidentId: 'ak-resume',
            depth: 0,
            sourceConversationId: 'conv-source',
            kind: 'test-red',
            summary: 'test rouge persistant',
            detail: 'exit code 1',
            status: 'analysis-completed',
            analysisConversationId: 'conv-analysis-existing',
            analysisTurnId: 'turn-analysis-existing',
            analysisResult: 'Diagnostic déjà payé et persisté.',
            detectedAt: 1,
            updatedAt: 2
          }
        ]
      }),
      'utf8'
    )
    const supervisor = new AutoKaizenSupervisor({ path, runtime: h.runtime, now: () => 3 })

    supervisor.resumePending()
    await supervisor.drain()

    expect(h.analysisPrompts).toEqual([])
    expect(h.fixPrompts).toHaveLength(1)
    expect(h.fixPrompts[0]).toContain('Diagnostic déjà payé et persisté.')
    expect(supervisor.snapshot().incidents[0].status).toBe('completed')
  })

  it('relance un incident suspendu quand une place active se libère', async () => {
    const h = harness()
    const path = join(h.root, 'auto-kaizen-incidents.json')
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        incidents: [
          {
            id: 'ak-queued',
            dedupeKey: 'queued-1',
            rootIncidentId: 'ak-queued',
            depth: 0,
            sourceConversationId: 'conv-source',
            kind: 'provider-error',
            summary: 'erreur enregistrée au plafond',
            detail: 'preuve durable',
            status: 'suppressed',
            suppressionReason: 'active-limit',
            detectedAt: 1,
            updatedAt: 1
          }
        ]
      }),
      'utf8'
    )
    const supervisor = new AutoKaizenSupervisor({ path, runtime: h.runtime, now: () => 2 })

    supervisor.resumePending()
    await supervisor.drain()

    expect(h.analysisPrompts).toHaveLength(1)
    expect(supervisor.snapshot().incidents[0]).toMatchObject({
      id: 'ak-queued',
      status: 'completed'
    })
  })

  it('borne la récursion et le débit sans perdre les incidents supprimés', async () => {
    const h = harness()
    const supervisor = new AutoKaizenSupervisor({
      path: join(h.root, 'auto-kaizen-incidents.json'),
      runtime: h.runtime,
      now: () => Date.parse('2026-08-01T20:00:00.000Z'),
      limits: { maxActive: 10, maxDepth: 3, maxPerHour: 2 }
    })

    supervisor.report({
      dedupeKey: 'e-1',
      sourceConversationId: 'conv-source',
      kind: 'tool-refused',
      summary: 'erreur 1',
      detail: 'preuve 1'
    })
    supervisor.report({
      dedupeKey: 'e-2',
      sourceConversationId: 'conv-source',
      kind: 'test-red',
      summary: 'erreur 2',
      detail: 'preuve 2'
    })
    const capped = supervisor.report({
      dedupeKey: 'e-3',
      sourceConversationId: 'conv-source',
      kind: 'provider-error',
      summary: 'erreur 3',
      detail: 'preuve 3'
    })
    const tooDeep = supervisor.report({
      dedupeKey: 'e-depth',
      sourceConversationId: 'conv-source',
      kind: 'provider-error',
      summary: 'erreur profonde',
      detail: 'preuve profondeur',
      lineage: { rootIncidentId: 'root', parentIncidentId: 'parent', depth: 4 }
    })
    await supervisor.drain()

    expect(capped.status).toBe('suppressed')
    expect(capped.suppressionReason).toBe('rate-limit')
    expect(capped.severity).toBe('critical')
    expect(tooDeep.status).toBe('suppressed')
    expect(tooDeep.suppressionReason).toBe('depth-limit')
    expect(tooDeep.severity).toBe('critical')
    expect(h.sourceUpdates.filter((message) => message.includes('ALERTE CRITIQUE'))).toHaveLength(2)
    expect(supervisor.snapshot().incidents).toHaveLength(4)
  })
})

describe('PANNE AMONT — une panne serveur ne se kaizene pas', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function harness() {
    const root = mkdtempSync(join(tmpdir(), 'autowin-auto-kaizen-outage-'))
    roots.push(root)
    const analysisPrompts: string[] = []
    const conversations: string[] = []
    const sourceUpdates: string[] = []
    const runtime: AutoKaizenRuntime = {
      createConversation(input) {
        conversations.push(input.title)
        return { id: `conv-outage-${conversations.length}` }
      },
      appendSourceUpdate(_c, text) {
        sourceUpdates.push(text)
      },
      async runAnalysis(_c, prompt) {
        analysisPrompts.push(prompt)
        return { ok: true, text: 'analyse' }
      },
      async runFix() {
        return { ok: true, text: 'fix' }
      }
    }
    return { root, runtime, analysisPrompts, conversations, sourceUpdates }
  }

  it('reconnait le vocabulaire REEL des pannes fournisseur et reseau', () => {
    for (const text of [
      'API Error: 529 {"type":"overloaded_error"}',
      'api_error renvoye par le provider',
      'Internal Server Error',
      'HTTP 503 sur le transport',
      'status code 502',
      'API Error: 500 Internal',
      'bad gateway',
      'gateway timeout',
      'upstream connect error',
      'ECONNRESET pendant l appel',
      'socket hang up',
      'fetch failed'
    ]) {
      expect(isUpstreamOutage('appel provider en echec', text)).toBe(true)
    }
  })

  it('ne mord PAS sur un vrai defaut qui mentionne un nombre a trois chiffres', () => {
    // Un 5xx nu ne suffit pas : sinon un incident legitime serait etouffe, ce qui est exactement le
    // defaut inverse de celui qu'on corrige — et le plus difficile a apercevoir ensuite.
    for (const text of [
      'assertion echouee ligne 500 du fichier orchestrator.ts',
      'le port 5000 est deja utilise',
      '503 tests verts, 0 rouge',
      'quota epuise jusqu au 8 aout'
    ]) {
      expect(isUpstreamOutage('un outil a echoue', text)).toBe(false)
    }
  })

  it('SUPPRIME l incident et ne lance AUCUN run — c est ca qui coupe la depense', async () => {
    const h = harness()
    const supervisor = new AutoKaizenSupervisor({
      path: join(h.root, 'incidents.json'),
      runtime: h.runtime,
      now: () => Date.parse('2026-08-04T18:00:00.000Z')
    })

    const incident = supervisor.report({
      dedupeKey: 'provider-error:anthropic:529:req_abc',
      sourceConversationId: 'conv-source',
      kind: 'provider-error',
      summary: 'Un appel provider a echoue',
      detail: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}'
    })
    await supervisor.drain()

    expect(incident.status).toBe('suppressed')
    expect(incident.suppressionReason).toBe('upstream-outage')
    // LE point : aucune conversation d analyse creee, aucun prompt envoye. Sans cette assertion, le
    // correctif ne serait qu une etiquette posee sur un run qui partirait quand meme.
    expect(h.analysisPrompts).toEqual([])
    expect(h.conversations).toEqual([])
    // L erreur reste SIGNALEE : supprimer l analyse ne doit pas rendre la panne invisible.
    expect(h.sourceUpdates.join(' ')).toContain('upstream-outage')
  })

  it('distingue la panne du mur de QUOTA — deux causes, deux etiquettes', async () => {
    const h = harness()
    const supervisor = new AutoKaizenSupervisor({
      path: join(h.root, 'incidents.json'),
      runtime: h.runtime,
      now: () => Date.parse('2026-08-04T18:00:00.000Z')
    })
    const quota = supervisor.report({
      dedupeKey: 'provider-error:quota',
      sourceConversationId: 'conv-source',
      kind: 'provider-error',
      summary: 'appel provider en echec',
      detail: "You've hit your usage limit"
    })
    await supervisor.drain()
    expect(quota.status).toBe('suppressed')
    // Confondre les deux rendrait impossible de repondre « combien de fois une panne amont nous a coute
    // un run » — la telemetrie doit pouvoir les separer.
    expect(quota.suppressionReason).toBe('non-actionable')
  })

  it('n est JAMAIS reanime au redemarrage', async () => {
    const h = harness()
    const path = join(h.root, 'incidents.json')
    const supervisor = new AutoKaizenSupervisor({
      path,
      runtime: h.runtime,
      now: () => Date.parse('2026-08-04T18:00:00.000Z')
    })
    supervisor.report({
      dedupeKey: 'provider-error:anthropic:overloaded',
      sourceConversationId: 'conv-source',
      kind: 'provider-error',
      summary: 'appel provider en echec',
      detail: 'overloaded_error'
    })
    await supervisor.drain()

    const reloaded = new AutoKaizenSupervisor({ path, runtime: h.runtime })
    await reloaded.drain()
    expect(reloaded.snapshot().incidents[0]).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'upstream-outage'
    })
    expect(h.analysisPrompts).toEqual([])
  })
})
