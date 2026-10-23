import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'
import {
  buildRequestThread,
  familyOf,
  liveStoryFromMessages,
  nativeGestureCount,
  withNativeActions
} from './request-thread-model'
import { gestesDesEvenements } from '../../../shared/gestes-agent'

/**
 * FIL DES DEMANDES — formes reprises des traces réelles du 2026-10-12 : conv-904 (/draft : outils
 * d'Autowin, question posée, bilan du superviseur), conv-879 (appel unique en échec), conv-770
 * (trois appels dont un en échec, repris).
 */
let sequence = 0
function ev(
  id: string,
  turnId: string,
  second: number,
  overrides: Partial<HarnessTraceEvent> = {}
): HarnessTraceEvent {
  sequence += 1
  return {
    id,
    conversationId: 'conv-fil',
    turnId,
    timestamp: `2026-10-12T07:${String(10 + Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.000Z`,
    sequence,
    type: 'message',
    status: 'completed',
    channel: 'internal',
    actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
    payloads: [],
    observation: { boundary: 'orchestration', fidelity: 'exact' },
    ...overrides
  }
}

const prompt = (id: string, turnId: string, second: number, text?: string): HarnessTraceEvent =>
  ev(id, turnId, second, {
    provider: { id: 'claude', model: 'claude-opus-5-5' },
    payloads: text
      ? [{ kind: 'user-message', content: `ÉTAT DE L'APP:\n{}\n\nUTILISATEUR: ${text}` }]
      : []
  })
const response = (id: string, turnId: string, second: number, parentId: string, ms: number) =>
  ev(id, turnId, second, { type: 'model-response', parentId, metrics: { durationMs: ms } })
const call = (id: string, turnId: string, second: number, name: string, parentId?: string) =>
  ev(id, turnId, second, {
    type: 'tool-call',
    parentId,
    actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    payloads: [{ kind: 'tool-call', name, content: '' }]
  })
const result = (id: string, turnId: string, second: number, name: string, parentId: string) =>
  ev(id, turnId, second, {
    type: 'tool-result',
    parentId,
    actor: { id: name, kind: 'tool', label: name },
    payloads: [{ kind: 'tool-result', name, content: '' }]
  })
const bilan = (
  id: string,
  turnId: string,
  second: number,
  ms: number,
  cost: number,
  status = 'completed'
) =>
  ev(id, turnId, second, {
    type: 'boundary',
    status,
    actor: { id: 'execution-supervisor', kind: 'system', label: 'Execution supervisor' },
    metrics: { durationMs: ms, costUsd: cost }
  })

const draftTurn = (): HarnessTraceEvent[] => [
  call('d-c1', 'turn-draft', 1, 'mcp__autowin__brain_query'),
  result('d-r1', 'turn-draft', 2, 'brain_query', 'd-c1'),
  call('d-c2', 'turn-draft', 3, 'brain_read', 'd-r1'),
  result('d-r2', 'turn-draft', 4, 'brain_read', 'd-c2'),
  call('d-c3', 'turn-draft', 5, 'brain_read', 'd-r2'),
  result('d-r3', 'turn-draft', 6, 'brain_read', 'd-c3'),
  bilan('d-bilan', 'turn-draft', 420, 420539, 2.5968),
  prompt('d-prompt', 'turn-draft', 421, '/draft une nouvelle apparence pour cette barre'),
  response('d-resp', 'turn-draft', 421, 'd-prompt', 201086),
  call('d-c4', 'turn-draft', 422, 'ask', 'd-prompt'),
  result('d-r4', 'turn-draft', 423, 'ask', 'd-c4'),
  ev('d-shown', 'turn-draft', 424, {
    type: 'response-displayed',
    parentId: 'd-r4',
    actor: { id: 'autowin-renderer', kind: 'system', label: 'Interface Autowin' }
  })
]

describe('buildRequestThread — une ligne et un récit par demande', () => {
  it('raconte la demande /draft : décision, gestes par famille, résultat et bilan', () => {
    const [story] = buildRequestThread(buildHarnessTimelineFromTrace(draftTurn()))

    expect(story).toMatchObject({
      turnId: 'turn-draft',
      status: 'completed',
      durationMs: 420539,
      costUsd: 2.5968,
      calls: 1,
      failedCalls: 0
    })
    expect(story.text).toContain('/draft une nouvelle apparence')
    expect(story.decision).toEqual(['Chat direct', 'Orchestrator', 'claude-opus-5-5'])
    expect(story.families.map((family) => [family.family, family.count])).toEqual([
      ['lire', 2],
      ['chercher', 1],
      ['demander', 1]
    ])
    expect(story.families[0].actions).toEqual([
      expect.objectContaining({ title: 'Note lue', count: 2 })
    ])
    expect(story.outcome).toEqual(['Question posée : il attend ta réponse'])
    expect(story.failure).toBeUndefined()
  })

  it('un appel unique en échec rend la demande en échec, avec la cause écrite par la trace', () => {
    const [story] = buildRequestThread(
      buildHarnessTimelineFromTrace([
        prompt('m-prompt', 'turn-mail', 1, 'Un mail vient d’arriver'),
        ev('m-err', 'turn-mail', 3, {
          type: 'error',
          status: 'failed',
          parentId: 'm-prompt',
          metrics: { durationMs: 2848 },
          payloads: [{ kind: 'error', content: 'quota du modèle atteint' }]
        })
      ])
    )

    expect(story.status).toBe('failed')
    expect(story.failure).toBe('quota du modèle atteint')
    expect(story.outcome[0]).toBe('Échec : quota du modèle atteint')
  })

  it('un appel en échec puis repris laisse la demande terminée, en le disant', () => {
    const [story] = buildRequestThread(
      buildHarnessTimelineFromTrace([
        prompt('a1', 'turn-770', 1, 'demande longue'),
        response('a1-r', 'turn-770', 398, 'a1', 397817),
        prompt('a2', 'turn-770', 400),
        ev('a2-err', 'turn-770', 402, {
          type: 'error',
          status: 'failed',
          parentId: 'a2',
          metrics: { durationMs: 2364 }
        }),
        prompt('a3', 'turn-770', 403),
        response('a3-r', 'turn-770', 430, 'a3', 27418)
      ])
    )

    expect(story).toMatchObject({ status: 'completed', calls: 3, failedCalls: 1 })
    expect(story.outcome).toContain('1 appel en échec, repris ensuite')
    expect(story.decision).toContain('3 appels au modèle')
    // Sans bilan du superviseur : du premier instant journalisé (1 s) à la fin du dernier appel
    // (lancé à 403 s, 27,418 s de réponse), soit 429,418 s.
    expect(story.durationMs).toBe(403000 + 27418 - 1000)
  })

  it('un tour arrêté par Stop est annulé, pas en échec', () => {
    const [story] = buildRequestThread(
      buildHarnessTimelineFromTrace([
        ev('s-cancel', 'turn-stop', 1, {
          type: 'cancellation',
          status: 'cancelled',
          actor: { id: 'claude', kind: 'agent', label: 'claude' }
        }),
        bilan('s-bilan', 'turn-stop', 2, 13222, 0, 'cancelled')
      ])
    )
    expect(story.status).toBe('cancelled')
    expect(story.outcome).toContain('Arrêtée avant la fin')
  })

  it('range la plus récente en tête et ne laisse « en cours » qu’à elle seule en direct', () => {
    const timeline = buildHarnessTimelineFromTrace([
      prompt('old', 'turn-old', 1, 'ancienne'),
      ev('old-run', 'turn-old', 2, {
        type: 'tool-call',
        status: 'running',
        parentId: 'old',
        payloads: [{ kind: 'tool-call', name: 'verify', content: '' }]
      }),
      prompt('new', 'turn-new', 100, 'nouvelle'),
      ev('new-run', 'turn-new', 101, {
        type: 'tool-call',
        status: 'running',
        parentId: 'new',
        payloads: [{ kind: 'tool-call', name: 'verify', content: '' }]
      })
    ])

    const enDirect = buildRequestThread(timeline, { live: true })
    expect(enDirect.map((story) => [story.turnId, story.status])).toEqual([
      ['turn-new', 'running'],
      ['turn-old', 'interrupted']
    ])
    expect(buildRequestThread(timeline).map((story) => story.status)).toEqual([
      'interrupted',
      'interrupted'
    ])
  })
})

describe('gestes propres de l’agent, lus dans le journal de la demande', () => {
  const journal = [
    { kind: 'provider-status', text: 'Read · D:\\AutoWinOS\\src\\x.ts' },
    { kind: 'provider-status', text: 'Read terminé - 3 s' },
    { kind: 'provider-status', text: 'Bash échoué - 12 s' },
    { kind: 'provider-status', text: 'Edit terminé - 0,5 s' },
    { kind: 'provider-status', text: 'mcp__autowin__verify terminé - 5 s' },
    { kind: 'reasoning-step', text: 'Read terminé - 9 s' }
  ]

  it('compte chaque geste terminé avec sa durée, sans les commandes d’Autowin ni les débuts', () => {
    const gestes = gestesDesEvenements(journal)
    expect(gestes).toEqual({
      Read: { nombre: 1, echecs: 0, dureeMs: 3000 },
      Bash: { nombre: 1, echecs: 1, dureeMs: 12000 },
      Edit: { nombre: 1, echecs: 0, dureeMs: 500 }
    })
    expect(nativeGestureCount(gestes)).toBe(3)
    expect(nativeGestureCount(undefined)).toBe(0)
  })

  it('les ajoute aux familles de la trace, un échec restant visible', () => {
    const families = withNativeActions(
      [
        {
          family: 'lire',
          count: 1,
          durationMs: 200,
          actions: [{ title: 'Note lue', count: 1, durationMs: 200 }]
        }
      ],
      gestesDesEvenements(journal)
    )
    expect(families.map((family) => [family.family, family.count])).toEqual([
      ['lire', 2],
      ['modifier', 1],
      ['lancer', 1]
    ])
    expect(families[2].actions[0]).toMatchObject({ title: 'Commande', status: 'failed' })
    expect(familyOf('mcp__autowin__ask')).toBe('demander')
    expect(familyOf('outil-inconnu')).toBe('autre')
  })
})

describe('liveStoryFromMessages — la demande en cours, lue dans le flux du chat', () => {
  const user = (content: string, ts?: number): Msg => ({
    role: 'user',
    content,
    ...(ts ? { ts } : {})
  })
  const streaming = (parts: unknown[], providerStatus?: string): Msg =>
    ({
      role: 'assistant',
      turnId: 'turn-vivant',
      parts,
      status: 'streaming',
      done: false,
      ...(providerStatus ? { providerStatus } : {})
    }) as unknown as Msg

  it('prend le battement de la commande en vol, le temps écoulé et les gestes déjà faits', () => {
    const story = liveStoryFromMessages(
      [
        user('ancienne', 1),
        user('refais le graphe', 10_000),
        streaming([
          { kind: 'action', name: 'brain_query', ok: true },
          { kind: 'action', name: 'verify', progress: '5 s · > tsc --noEmit' }
        ])
      ],
      70_000
    )
    expect(story).toMatchObject({
      text: 'refais le graphe',
      turnId: 'turn-vivant',
      elapsedMs: 60_000,
      heartbeat: '5 s · > tsc --noEmit'
    })
    expect(story?.actions.map((action) => [action.title, action.state])).toEqual([
      ['Brain interrogé', 'done'],
      ['Vérification', 'running']
    ])
    expect(story?.families).toEqual([
      { family: 'chercher', count: 1 },
      { family: 'verifier', count: 1 }
    ])
  })

  it('sans commande en vol, la ligne d’état du modèle sert de battement', () => {
    const story = liveStoryFromMessages(
      [user('lis le code', 1_000), streaming([], 'Read · src/x.ts')],
      2_000
    )
    expect(story?.heartbeat).toBe('Read · src/x.ts')
  })

  it('pas de message de l’utilisateur : pas de demande en cours inventée', () => {
    expect(liveStoryFromMessages([], 0)).toBeUndefined()
  })
})
