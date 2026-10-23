// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'

/**
 * Déroulé par agent dans la Chronologie — demande utilisateur du 2026-10-11 (conv-232) : « j'aimerais
 * une vue comme ça dans observatory chronology », capture d'un diagramme en barres par agent. Ces
 * tests montent la VRAIE vue sur une trace qui a la forme relevée dans `causal-trace/conv-222`.
 */
const T0 = Date.parse('2026-10-11T08:30:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()
let sequence = 0

function traceEvent(
  partial: Partial<HarnessTraceEvent> & Pick<HarnessTraceEvent, 'id' | 'type'>
): HarnessTraceEvent {
  sequence += 1
  return {
    conversationId: 'conv-1',
    turnId: 'turn-run',
    timestamp: at(0),
    sequence,
    status: 'completed',
    channel: 'internal',
    actor: { id: 'subagent', kind: 'agent', label: 'subagent' },
    payloads: [{ kind: 'model-response', content: '' }],
    observation: { boundary: 'Autowin orchestration', fidelity: 'exact' },
    ...partial
  } as HarnessTraceEvent
}

function agentRun(
  agentId: string,
  startS: number,
  durationS: number,
  content: string,
  type: 'handoff' | 'verdict' = 'handoff'
): HarnessTraceEvent[] {
  const execution = { phase: agentId.split(':')[0], agentId }
  const provider = { id: 'claude', model: 'claude-opus-5-5' }
  const metrics = { durationMs: durationS * 1000, outputTokens: 12_400, costUsd: 0.18 }
  return [
    traceEvent({
      id: `${agentId}:${startS}:start`,
      type,
      status: 'running',
      timestamp: at(startS),
      execution,
      provider,
      payloads: [{ kind: 'app-state', content: 'exec démarré' }]
    }),
    traceEvent({
      id: `${agentId}:${startS}:end`,
      type,
      timestamp: at(startS + durationS),
      execution,
      provider,
      metrics,
      payloads: [{ kind: 'model-response', content }]
    }),
    traceEvent({
      id: `${agentId}:${startS}:response`,
      type: 'model-response',
      actor: { id: 'claude', kind: 'provider', label: 'claude' },
      timestamp: at(startS + durationS),
      execution,
      provider,
      metrics,
      payloads: [{ kind: 'model-response', content }]
    })
  ]
}

const runTrace: HarnessTraceEvent[] = [
  ...agentRun('scout:dette', 0, 60, 'Repérage dette rendu.'),
  ...agentRun('scout:usage', 2, 50, 'Repérage usage rendu.'),
  ...agentRun('judge:single', 70, 21, 'DEFAUT: preuve visuelle manquante.', 'verdict'),
  traceEvent({
    id: 'gate-refus',
    type: 'gate',
    parentId: 'judge:single:70:end',
    timestamp: at(91.1),
    actor: { id: 'gate', kind: 'system', label: 'gate' },
    payloads: [
      {
        kind: 'app-state',
        content: 'BLOQUÉ: Aucune capture d’écran lue : preuve visuelle manquante.'
      }
    ]
  })
]

describe('Observatory · déroulé par agent', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  async function mount(trace: HarnessTraceEvent[]): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversations: vi.fn(async () => [
          { id: 'conv-1', title: 'Conversation A', provider: 'claude', updatedAt: 2 }
        ]),
        promptCalls: vi.fn(async () => []),
        promptTraceSummary: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        causalTrace: vi.fn(async () => trace),
        brainTraces: vi.fn(async () => []),
        conversationActivity: vi.fn(async () => []),
        activitySessions: vi.fn(async () => [])
      }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ObservatoryView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  it('pose une ligne par agent en tête du tour, une barre par exécution', async () => {
    const view = await mount(runTrace)
    const gantt = view.querySelector('[data-testid="observatory-agent-gantt"]')
    expect(gantt).not.toBeNull()
    // Le déroulé précède la liste des événements du même tour.
    const turn = gantt!.closest('.observatory-turn')!
    expect(turn.querySelector('.observatory-event-wrap')!.compareDocumentPosition(gantt!)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    )
    const lanes = [...view.querySelectorAll('[data-testid="observatory-gantt-lane"]')]
    expect(lanes.map((lane) => lane.querySelector('b')?.textContent)).toEqual([
      'scout · dette',
      'scout · usage',
      'judge'
    ])
    expect(lanes[0].querySelector('small')?.textContent).toBe('Opus 5.5')
    // Réponse doublée par la trace : toujours UNE barre par exécution.
    expect(view.querySelectorAll('[data-testid="observatory-gantt-bar"]')).toHaveLength(3)
    expect(gantt!.querySelector('.observatory-gantt__axis')?.textContent).toContain('0 s')
  })

  it('peint en rouge le verdict refusé et donne son motif dans la bulle', async () => {
    const view = await mount(runTrace)
    const refused = view.querySelector(
      '[data-testid="observatory-gantt-bar"][data-status="refused"]'
    )
    expect(refused).not.toBeNull()
    const tip = refused!.querySelector('.observatory-gantt__tip')!
    expect(tip.querySelector('em')?.textContent).toBe('Refus')
    expect(tip.querySelector('small')?.textContent).toBe('12,4 k tokens · 0,18 $ · 21 s')
    expect(tip.querySelector('q')?.textContent).toBe(
      'Aucune capture d’écran lue : preuve visuelle manquante.'
    )
    expect(view.querySelector('.observatory-gantt__head')?.textContent).toContain('1 refus')
  })

  it('ouvre l’événement de la barre cliquée dans la liste du tour', async () => {
    const view = await mount(runTrace)
    const refused = view.querySelector<HTMLButtonElement>(
      '[data-testid="observatory-gantt-bar"][data-status="refused"]'
    )!
    await act(async () => refused.click())
    expect(refused.classList.contains('is-selected')).toBe(true)
    const wrap = view.querySelector('[data-event-id="judge:single:70:end"]')!
    expect(wrap.querySelector('.observatory-event.is-selected')).not.toBeNull()
    expect(wrap.querySelector('.observatory-event-detail')).not.toBeNull()
  })

  it('rejoue le déroulé du tour, comme depuis le bilan du run (conv-981)', async () => {
    const view = await mount(runTrace)
    const tour = view
      .querySelector('[data-testid="observatory-agent-gantt"]')!
      .closest('.observatory-turn')!
    const rejouer = tour.querySelector<HTMLButtonElement>('[data-testid="run-rejeu-bouton"]')
    expect(rejouer?.textContent).toBe('Rejouer ce tour')
    expect(
      tour.querySelector('[data-testid="observatory-agent-gantt"]')?.hasAttribute('data-rejeu')
    ).toBe(false)
    await act(async () => rejouer!.click())
    expect(
      tour.querySelector('[data-testid="observatory-agent-gantt"]')?.getAttribute('data-rejeu')
    ).toBe('1')
    expect(rejouer!.textContent).toBe('Rejouer encore')
  })

  /**
   * conv-1105 : « observatory doit ressembler au graph timeline des bilans de runs ». Un tour de chat
   * qui a AGI reçoit le même déroulé que le bilan : l'orchestrateur, puis une ligne par outil appelé.
   */
  it('pose aussi le déroulé sur un tour de chat qui a agi : une ligne par outil', async () => {
    const orchestrateur = { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' } as const
    const view = await mount([
      traceEvent({
        id: 'grep',
        type: 'tool-call',
        actor: orchestrateur,
        recipient: { id: 'Grep', kind: 'tool', label: 'Grep' },
        channel: 'tool',
        timestamp: at(2),
        metrics: { durationMs: 1000 },
        payloads: [{ kind: 'tool-call', name: 'Grep', content: '{"pattern":"Envoyer"}' }]
      }),
      traceEvent({
        id: 'bash',
        type: 'tool-call',
        status: 'failed',
        actor: orchestrateur,
        recipient: { id: 'Bash', kind: 'tool', label: 'Bash' },
        channel: 'tool',
        timestamp: at(10),
        metrics: { durationMs: 6000 },
        payloads: [
          {
            kind: 'tool-call',
            name: 'Bash',
            content: '{"command":"npm run typecheck","description":"Typage"}'
          }
        ]
      }),
      traceEvent({
        id: 'reponse',
        type: 'model-response',
        actor: { id: 'claude', kind: 'provider', label: 'claude' },
        provider: { id: 'claude', model: 'claude-opus-5-5' },
        timestamp: at(40),
        metrics: { durationMs: 40_000 },
        payloads: [{ kind: 'model-response', content: 'Corrigé.' }]
      })
    ])
    const lanes = [...view.querySelectorAll('[data-testid="observatory-gantt-lane"]')]
    expect(lanes.map((lane) => lane.querySelector('b')?.textContent)).toEqual([
      'Orchestrateur',
      'Grep',
      'Bash'
    ])
    expect(lanes[0].querySelector('small')?.textContent).toBe('Opus 5.5')
    expect(lanes[2].querySelector('small')?.textContent).toBe('outil · 1 appel')
    const bash = lanes[2].querySelector('[data-testid="observatory-gantt-bar"]')!
    expect(bash.getAttribute('data-status')).toBe('failed')
    expect(bash.querySelector('q')?.textContent).toBe('Typage')
    expect(view.querySelector('[data-testid="run-rejeu-bouton"]')?.textContent).toBe(
      'Rejouer ce tour'
    )
  })

  it('ne montre aucun déroulé pour un tour de simple conversation', async () => {
    const view = await mount([
      traceEvent({
        id: 'reponse',
        type: 'model-response',
        actor: { id: 'claude', kind: 'provider', label: 'claude' },
        timestamp: at(30),
        metrics: { durationMs: 30_000 },
        payloads: [{ kind: 'model-response', content: 'Bonjour.' }]
      })
    ])
    expect(view.querySelector('.observatory-event-row')).not.toBeNull()
    expect(view.querySelector('[data-testid="observatory-agent-gantt"]')).toBeNull()
  })
})
