import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildAutowinKaizenTask,
  collectAutowinKaizenEvidence,
  PLAFONDS_AMPLES
} from './autowin-kaizen-context'
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
    // Le pied se termine désormais par l'exigence d'appui sur une source neuve (appels modèle /
    // tours / saisies), ajoutée APRÈS la consigne d'application. Les deux doivent survivre à la
    // saturation : elles sont déduites du budget avant l'ajustement.
    expect(task).toContain('un commit par édition')
    expect(task.trimEnd().endsWith('refuse le rendu.')).toBe(true)
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

describe('dossier de preuve /kaizen — les RUN survivent au resserrage', () => {
  /*
    Mesure sur le dossier REEL de conv-105 (tsx sur le code du depot) : `runs: 0`, et
    `troncature.runs = 4`. Les QUATRE RUN.md etaient jetes en entier, donc kaizen n'avait
    AUCUN RUN sous les yeux. Cause : l'ajustement au budget ne sait que SUPPRIMER un element,
    jamais le RESUMER ; un RUN pesant jusqu'a 4 000 signes est le plus lourd, donc le premier
    sacrifie des que le depassement est gros.
  */
  it('resume les RUN au lieu de les jeter quand le depassement est gros', () => {
    const task = buildAutowinKaizenTask('/kaizen', {
      conversation: {
        id: 'conv-runs',
        title: 'RUN',
        messages: Array.from({ length: 24 }, (_, index) => ({
          role: 'user' as const,
          content: 'm'.repeat(700),
          ts: index
        }))
      },
      activity: Array.from({ length: 50 }, (_, index) => ({
        ts: new Date(index).toISOString(),
        kind: 'exec',
        label: 'phase-' + index,
        text: 't'.repeat(600)
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
    // Les 4 RUN sont TOUS presents, resumes et non supprimes.
    expect(snapshot.runs).toHaveLength(4)
    for (const run of snapshot.runs as Array<{ path: string; content: string }>) {
      expect(run.content.length).toBeGreaterThanOrEqual(1_200)
    }
    // Aucun RUN compte comme ecarte.
    expect(snapshot.troncature?.runs ?? 0).toBe(0)
  })
})

describe('dossier de preuve /kaizen — le deroule des 3 tours arrive en entier', () => {
  /*
    Mesure du 2026-09-02 (conv-131) : le dossier annonce 3 tours mais n'en montre qu'un.
    Cause : la coupure par tour existe deja (`events.slice(-TURN_EVENT_LIMIT)` par journal), puis
    une SECONDE coupure globale du meme plafond rabote l'ensemble des tours reunis — elle ne garde
    donc que la fin d'un seul journal. Il y a une coupure EN TROP, pas un plafond a ecrire.
  */
  it('garde les 3 tours distincts quand chacun porte 20 evenements', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-3tours-'))
    mkdirSync(join(appData, 'turn-journals', 'conv-3t'), { recursive: true })
    for (const tour of ['turn-1', 'turn-2', 'turn-3']) {
      writeFileSync(
        join(appData, 'turn-journals', 'conv-3t', `${tour}.jsonl`),
        Array.from({ length: 20 }, (_, index) =>
          JSON.stringify({ kind: 'command', name: 'verify', detail: `${tour}-evt-${index}` })
        ).join('\n') + '\n'
      )
    }
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-3t',
          title: 'Trois tours',
          provider: 'claude',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      const tours = new Set((evidence.turnEvents ?? []).map((event) => event.turnId))
      expect([...tours].sort()).toEqual(['turn-1', 'turn-2', 'turn-3'])

      // Et le dossier REELLEMENT envoye au modele porte lui aussi les 3 tours.
      const task = buildAutowinKaizenTask('/kaizen', evidence)
      const snapshot = JSON.parse(task.slice(task.indexOf('{'), task.lastIndexOf('}') + 1))
      const toursEnvoyes = new Set(
        (snapshot.turnEvents as Array<{ turnId: string }>).map((event) => event.turnId)
      )
      expect([...toursEnvoyes].sort()).toEqual(['turn-1', 'turn-2', 'turn-3'])
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })
})

/*
  DEFAUT VECU 2026-09-04. Les plafonds du dossier sont un BUDGET DE PROMPT (`/kaizen` doit tenir
  dans 28 000 signes), pas une verite sur ce qui s'est passe. L'outil `retrospective` rendait
  pourtant le meme echantillon a un agent qui LIT : 4 RUN.md et 80 evenements causaux au maximum,
  sans que rien ne le dise. On repond alors « voila ce qui s'est passe » sur un echantillon.

  ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA COUPE REVIENT : 9 RUN.md et 300 evenements causaux.
  Sous les plafonds serres on en verrait 4 et 80.
*/
describe('regime ample : la retrospective ne rend pas un echantillon muet', () => {
  it('garde 9 RUN.md et 300 evenements causaux la ou le regime kaizen en couperait 4 et 80', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-ample-'))
    try {
      for (let i = 0; i < 9; i += 1) {
        const dossier = join(appData, 'runs', 'conv-77', `run-${i}-workspace`)
        mkdirSync(dossier, { recursive: true })
        const fichier = join(dossier, 'RUN.md')
        writeFileSync(fichier, `RUN ${i}`)
        utimesSync(fichier, new Date(1000 + i), new Date(1000 + i))
      }
      mkdirSync(join(appData, 'causal-trace'), { recursive: true })
      const lignes = Array.from({ length: 300 }, (_, i) =>
        JSON.stringify({
          schema: 'autowin.trace/v1',
          id: `evt-${i}`,
          conversationId: 'conv-77',
          turnId: 'turn-1',
          timestamp: new Date(1_000 + i).toISOString(),
          sequence: i,
          type: 'message',
          status: 'completed',
          actor: { id: 'human', kind: 'human', label: 'Vous' },
          recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
          channel: 'user',
          payloads: [{ kind: 'user-message', content: `appel ${i}` }],
          observation: { boundary: 'renderer', fidelity: 'exact' }
        })
      ).join(String.fromCharCode(10))
      writeFileSync(join(appData, 'causal-trace', 'conv-77.jsonl'), lignes + String.fromCharCode(10))

      const conversation = {
        id: 'conv-77',
        title: 'ample',
        messages: [],
        runPaths: []
      } as never

      const serre = collectAutowinKaizenEvidence(conversation, appData)
      expect(serre.runs.length).toBe(4)
      expect(serre.causalEvents.length).toBe(80)

      const ample = collectAutowinKaizenEvidence(conversation, appData, PLAFONDS_AMPLES)
      expect(ample.runs.length).toBe(9)
      expect(ample.causalEvents.length).toBe(300)
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })
})
