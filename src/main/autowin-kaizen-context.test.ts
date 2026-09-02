import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAutowinKaizenTask, collectAutowinKaizenEvidence } from './autowin-kaizen-context'
import { isMutationTask } from './orchestrator'

describe('buildAutowinKaizenTask', () => {
  it('adapte /kaizen à la conversation et aux preuves Autowin', () => {
    const task = buildAutowinKaizenTask('/kaizen', {
      conversation: {
        id: 'conv-7',
        title: 'Worktrees',
        messages: [
          { role: 'user', content: 'corrige le worktree', ts: 1 },
          { role: 'assistant', content: 'fait', ts: 2 }
        ],
        runPaths: ['C:/Audit/RUN.md']
      },
      activity: [
        {
          ts: '2026-07-27T10:00:00.000Z',
          kind: 'exec',
          label: 'build',
          costUsd: 0.12,
          inputTokens: 100,
          outputTokens: 20
        }
      ],
      brainTraces: [
        {
          timestamp: '2026-07-27T10:00:01.000Z',
          conversationId: 'conv-7',
          query: 'worktree',
          injectedChars: 450
        }
      ],
      causalEvents: [
        {
          timestamp: '2026-07-27T10:00:02.000Z',
          type: 'gate',
          status: 'failed',
          actor: 'judge',
          payload: 'preuve manquante'
        }
      ],
      runs: [{ path: 'C:/Audit/RUN.md', content: '# RUN\nStatus: RED' }]
    })

    expect(task).toContain('/kaizen')
    expect(task).toContain('conv-7')
    expect(task).toContain('corrige le worktree')
    expect(task).toContain('"costUsd":0.12')
    expect(task).toContain('"injectedChars":450')
    expect(task).toContain('preuve manquante')
    expect(task).toContain('Status: RED')
    // La consigne doit dire d'APPLIQUER (SKILL.md:40/97/146), pas de proposer et attendre.
    expect(task).toContain('Applique')
    expect(task).toContain('un commit par édition')
    expect(task).not.toContain('lecture seule')
    expect(task).not.toContain('faire approuver')
    expect(isMutationTask(task)).toBe(false)
  })

  it('ignore les fichiers externes attachés et ne lit que les RUN natifs Autowin', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-runs-'))
    const nativeRun = join(appData, 'runs', 'conv-3', 'native-workspace', 'RUN.md')
    const externalClaude = join(appData, 'CLAUDE.md')
    mkdirSync(join(appData, 'runs', 'conv-3', 'native-workspace'), { recursive: true })
    writeFileSync(nativeRun, 'RUN NATIF AUTOWIN')
    writeFileSync(externalClaude, 'SECRET CLAUDE INTERDIT')
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-3',
          title: 'Audit',
          provider: 'codex',
          messages: [],
          runPaths: [externalClaude],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.runs).toEqual([{ path: nativeRun, content: 'RUN NATIF AUTOWIN' }])
      expect(JSON.stringify(evidence)).not.toContain('SECRET CLAUDE INTERDIT')
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('borne les contenus volumineux', () => {
    const task = buildAutowinKaizenTask('/kaizen cible', {
      conversation: {
        id: 'conv-1',
        title: 'Longue',
        messages: Array.from({ length: 80 }, (_, index) => ({
          role: index % 2 ? ('assistant' as const) : ('user' as const),
          content: `message-${index}-${'x'.repeat(3000)}`,
          ts: index
        }))
      },
      activity: [],
      brainTraces: [],
      causalEvents: [],
      runs: []
    })

    expect(task.length).toBeLessThan(30_000)
    expect(task).toContain('message-79')
    expect(task).not.toContain('message-0-')
  })
})

describe('dossier de preuve /kaizen — intégrité', () => {
  function conversationEvent(id: string, sequence: number, content: string): unknown {
    return {
      schema: 'autowin.trace/v1',
      id,
      conversationId: 'conv-9',
      turnId: 'turn-1',
      timestamp: new Date(1_000 + sequence).toISOString(),
      sequence,
      type: 'message',
      status: 'completed',
      actor: { id: 'human', kind: 'human', label: 'Vous' },
      recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
      channel: 'user',
      payloads: [{ kind: 'user-message', content }],
      observation: { boundary: 'renderer', fidelity: 'exact' }
    }
  }

  it('reste relisible en JSON même saturé, et garde la consigne finale', () => {
    const task = buildAutowinKaizenTask('/kaizen ' + 'z'.repeat(5_000), {
      conversation: {
        id: 'conv-8',
        title: 'Saturée',
        messages: Array.from({ length: 60 }, (_, index) => ({
          role: index % 2 ? ('assistant' as const) : ('user' as const),
          content: `message-${index}-${'x'.repeat(4000)}`,
          ts: index
        }))
      },
      activity: Array.from({ length: 60 }, (_, index) => ({
        ts: `2026-07-27T10:00:${String(index).padStart(2, '0')}.000Z`,
        kind: 'exec',
        label: `label-${index}`,
        text: 'y'.repeat(2000)
      })),
      brainTraces: Array.from({ length: 40 }, (_, index) => ({
        timestamp: `2026-07-27T11:00:${String(index).padStart(2, '0')}.000Z`,
        conversationId: 'conv-8',
        query: 'q'.repeat(1500),
        injectedChars: index
      })),
      causalEvents: Array.from({ length: 90 }, (_, index) => ({
        timestamp: `2026-07-27T12:00:00.000Z`,
        type: 'gate',
        status: 'failed',
        actor: 'judge',
        payload: `payload-${index}-${'p'.repeat(800)}`
      })),
      runs: Array.from({ length: 4 }, (_, index) => ({
        path: `C:/runs/run-${index}/RUN.md`,
        content: 'r'.repeat(4000)
      }))
    })

    expect(task.length).toBeLessThanOrEqual(28_000)
    const debut = task.indexOf('=== DOSSIER DE PREUVE AUTOWIN OS ===\n')
    const fin = task.indexOf('\n=== FIN DU DOSSIER ===')
    const json = task.slice(debut + '=== DOSSIER DE PREUVE AUTOWIN OS ===\n'.length, fin)
    const dossier = JSON.parse(json) as { source: string; conversation: { id: string } }
    expect(dossier.source).toBe('autowin-os')
    expect(dossier.conversation.id).toBe('conv-8')
    expect(task.trimEnd().endsWith('revert.')).toBe(true)
    expect(isMutationTask(task)).toBe(false)
  })

  it('garde les événements causaux valides malgré une ligne corrompue au milieu', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-trace-'))
    mkdirSync(join(appData, 'causal-trace'), { recursive: true })
    writeFileSync(
      join(appData, 'causal-trace', 'conv-9.jsonl'),
      [
        JSON.stringify(conversationEvent('evt-0', 0, 'un')),
        JSON.stringify({ schema: 'autowin.trace/v1' }),
        JSON.stringify(conversationEvent('evt-1', 1, 'deux')),
        JSON.stringify(conversationEvent('evt-2', 2, 'trois'))
      ].join('\n') + '\n'
    )
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-9',
          title: 'Trace',
          provider: 'codex',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.causalEvents.map((event) => event.payload)).toEqual([
        'user-message: un',
        'user-message: deux',
        'user-message: trois'
      ])
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('garde les RUN natifs les plus récents, pas les premiers par ordre alphabétique', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-recents-'))
    // Ordre alphabétique volontairement INVERSE de l'ordre chronologique.
    const noms = ['a-recent', 'b-plus', 'c-moyen', 'd-ancien', 'e-vieux']
    noms.forEach((nom, index) => {
      const dossier = join(appData, 'runs', 'conv-4', `${nom}-workspace`)
      mkdirSync(dossier, { recursive: true })
      const fichier = join(dossier, 'RUN.md')
      writeFileSync(fichier, `RUN ${nom}`)
      const date = new Date(1_000_000_000_000 - index * 60_000)
      utimesSync(fichier, date, date)
      utimesSync(dossier, date, date)
    })
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-4',
          title: 'Runs',
          provider: 'codex',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.runs.map((run) => run.content)).toEqual([
        'RUN d-ancien',
        'RUN c-moyen',
        'RUN b-plus',
        'RUN a-recent'
      ])
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })
})

/*
  TERRAIN — harnais des 4 défauts du dossier de preuve /kaizen qui tiennent encore.
  (Le 5e, la coupe au milieu du JSON, est déjà traité par `ajusterAuBudget`.)
  Chaque test affirme le comportement CIBLE : il doit être ROUGE avant la correction.
*/
describe('dossier de preuve /kaizen — ce que les journaux portent déjà', () => {
  function evenementComplet(): unknown {
    return {
      schema: 'autowin.trace/v1',
      id: 'evt-a',
      conversationId: 'conv-11',
      turnId: 'turn-42',
      parentId: 'evt-parent',
      timestamp: new Date(2_000).toISOString(),
      sequence: 7,
      type: 'tool-call',
      status: 'completed',
      actor: { id: 'claude', kind: 'agent', label: 'Claude' },
      channel: 'tool',
      payloads: [{ kind: 'tool-call', content: 'verify' }],
      observation: { boundary: 'main', fidelity: 'derived', limitation: 'coût estimé' },
      execution: { phase: 'build', agentId: 'agent-1', taskId: 'task-1', runId: 'run-9' },
      metrics: { durationMs: 22_000, inputTokens: 10, outputTokens: 3, cacheReadTokens: 5 }
    }
  }

  it("recopie les 4 champs d'activité écrits puis jetés", () => {
    const task = buildAutowinKaizenTask('/kaizen', {
      conversation: { id: 'conv-10', title: 'Activité', messages: [] },
      activity: [
        {
          ts: '2026-09-02T10:00:00.000Z',
          kind: 'exec',
          label: 'build',
          durationMs: 132_000,
          cacheReadTokens: 4_096,
          usageCallId: 'call-abc',
          screenshots: ['D:/preuves/apres.png']
        }
      ],
      brainTraces: [],
      causalEvents: [],
      runs: []
    })

    expect(task).toContain('"durationMs":132000')
    expect(task).toContain('"cacheReadTokens":4096')
    expect(task).toContain('call-abc')
    expect(task).toContain('D:/preuves/apres.png')
  })

  it('garde le lien causal des événements : tour, rang, parent, phase, mesures, fidélité', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-causal-'))
    mkdirSync(join(appData, 'causal-trace'), { recursive: true })
    writeFileSync(
      join(appData, 'causal-trace', 'conv-11.jsonl'),
      JSON.stringify(evenementComplet()) + '\n'
    )
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-11',
          title: 'Causal',
          provider: 'codex',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      const event = evidence.causalEvents[0] as unknown as Record<string, unknown>
      expect(event.turnId).toBe('turn-42')
      expect(event.sequence).toBe(7)
      expect(event.parentId).toBe('evt-parent')
      expect(event.execution).toMatchObject({ phase: 'build', runId: 'run-9' })
      expect(event.metrics).toMatchObject({ durationMs: 22_000, cacheReadTokens: 5 })
      expect(event.observation).toMatchObject({
        fidelity: 'derived',
        limitation: 'coût estimé'
      })
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it("joint les saisies de la conversation ciblée, et seulement les siennes", () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-saisies-'))
    writeFileSync(
      join(appData, 'saisies-utilisateur.jsonl'),
      [
        JSON.stringify({
          schema: 'autowin.saisie/v1',
          ts: 1,
          conversationId: 'conv-12',
          texte: 'ORIENTATION DONNEE EN COURS DE ROUTE',
          voie: 'orientation'
        }),
        JSON.stringify({
          schema: 'autowin.saisie/v1',
          ts: 2,
          conversationId: 'conv-autre',
          texte: 'SAISIE D UNE AUTRE CONVERSATION',
          voie: 'orientation'
        })
      ].join('\n') + '\n'
    )
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-12',
          title: 'Saisies',
          provider: 'codex',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      const saisies = (evidence as unknown as Record<string, unknown>).saisies as
        | Array<Record<string, unknown>>
        | undefined
      expect(saisies?.map((saisie) => saisie.texte)).toEqual([
        'ORIENTATION DONNEE EN COURS DE ROUTE'
      ])

      const task = buildAutowinKaizenTask('/kaizen', evidence)
      expect(task).toContain('ORIENTATION DONNEE EN COURS DE ROUTE')
      expect(task).not.toContain('SAISIE D UNE AUTRE CONVERSATION')
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })
})

/*
  Repris de la branche de secours `run-657abec585f1-1` : les deux SEULES sources qu'elle apportait
  en plus (son mecanisme de budget, lui, doublait celui deja en place).
*/
describe('dossier de preuve /kaizen — appels modele et deroule des tours', () => {
  it("joint ce qui est REELLEMENT parti au modele, et seulement pour la conversation ciblee", () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-prompts-'))
    mkdirSync(join(appData, 'prompt-observability'), { recursive: true })
    const appel = (conversationId: string, response: string): string =>
      JSON.stringify({
        id: `call-${conversationId}`,
        ts: '2026-09-02T10:00:00.000Z',
        conversationId,
        turnId: 'turn-77',
        iteration: 2,
        actor: 'orchestrator',
        phase: 'build',
        provider: 'claude',
        model: 'opus',
        resolvedModel: 'claude-opus-5',
        transport: 'cli',
        boundary: 'main',
        limitation: 'aucune',
        response,
        status: 'failed',
        error: 'error_during_execution',
        durationMs: 4_200
      })
    writeFileSync(
      join(appData, 'prompt-observability', 'conv-13.jsonl'),
      appel('conv-13', 'REPONSE DU MODELE CIBLE') + '\n'
    )
    writeFileSync(
      join(appData, 'prompt-observability', 'conv-autre.jsonl'),
      appel('conv-autre', 'REPONSE D UNE AUTRE CONVERSATION') + '\n'
    )
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-13',
          title: 'Appels',
          provider: 'claude',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.promptCalls?.map((call) => call.response)).toEqual([
        'REPONSE DU MODELE CIBLE'
      ])
      expect(evidence.promptCalls?.[0]).toMatchObject({
        phase: 'build',
        resolvedModel: 'claude-opus-5',
        status: 'failed',
        error: 'error_during_execution',
        durationMs: 4_200
      })
      const task = buildAutowinKaizenTask('/kaizen', evidence)
      expect(task).toContain('REPONSE DU MODELE CIBLE')
      expect(task).not.toContain('REPONSE D UNE AUTRE CONVERSATION')
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('joint le deroule des derniers tours journalises', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-tours-'))
    mkdirSync(join(appData, 'turn-journals', 'conv-14'), { recursive: true })
    writeFileSync(
      join(appData, 'turn-journals', 'conv-14', 'turn-1.jsonl'),
      [
        JSON.stringify({ kind: 'command', name: 'verify', detail: 'CE QUE LE TOUR A FAIT' }),
        JSON.stringify({ kind: 'done', exitCode: 0 })
      ].join('\n') + '\n'
    )
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-14',
          title: 'Tours',
          provider: 'claude',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.turnEvents?.map((event) => event.kind)).toEqual(['command', 'done'])
      expect(evidence.turnEvents?.[0].turnId).toBe('turn-1')
      expect(buildAutowinKaizenTask('/kaizen', evidence)).toContain('CE QUE LE TOUR A FAIT')
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })
})

describe('dossier de preuve /kaizen — budget reellement utilise', () => {
  /*
    Mesure sur le dossier REEL de conv-105 : 23 870 signes utilises sur 28 000 alors que 167
    elements avaient ete jetes. Cause : le retrait vise la section la plus LOURDE, or un RUN pese
    jusqu'a 4 000 signes ; pour resorber un depassement de quelques signes, un RUN entier partait
    et 4 000 signes de budget avec lui. Reproduction hermetique ci-dessous : 4 RUN + 30 lignes
    d'activite -> un RUN jete, 4 144 signes perdus.
  */
  it("ne sacrifie pas un RUN entier pour resorber un petit depassement", () => {
    const task = buildAutowinKaizenTask('/kaizen', {
      conversation: { id: 'conv-budget', title: 'Budget', messages: [{ role: 'user', content: 'x', ts: 1 }] },
      activity: Array.from({ length: 30 }, (_, index) => ({
        ts: new Date(index).toISOString(),
        kind: 'exec',
        label: 'phase-' + index,
        text: 't'.repeat(300)
      })),
      brainTraces: [],
      causalEvents: [],
      runs: Array.from({ length: 4 }, (_, index) => ({
        path: 'C:/R' + index + '/RUN.md',
        content: String.fromCharCode(97 + index).repeat(4_000)
      }))
    })
    const snapshot = JSON.parse(task.slice(task.indexOf('{'), task.lastIndexOf('}') + 1))

    expect(task.length).toBeLessThanOrEqual(28_000)
    // En dessous de 27 000, du budget a ete jete pour rien.
    expect(task.length).toBeGreaterThan(27_000)
    // Le depassement se resorbe sur des elements LEGERS : les 4 RUN survivent.
    expect(snapshot.runs).toHaveLength(4)
  })
})
