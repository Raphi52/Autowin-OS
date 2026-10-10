// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'
import { formatClock } from './observatory-timeline-axis'

/**
 * Chronologie en FRISE — demande utilisateur du 2026-10-11 (conv-226) : « mon observatory je le
 * veux en mode timeline dans chronologie ». Avant, la Chronologie empilait des cartes numérotées
 * sans aucune heure. Ces tests fixent ce que l'axe doit montrer, sur la vraie vue montée.
 */
function traceEvent(
  id: string,
  sequence: number,
  type: string,
  timestamp: string | undefined,
  content: string
): HarnessTraceEvent {
  return {
    id,
    conversationId: 'conv-1',
    turnId: 'conv-1-turn',
    timestamp,
    sequence,
    type,
    status: 'completed',
    channel: 'assistant',
    actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads: [{ kind: 'text', content }],
    observation: { boundary: 'Autowin OS', fidelity: 'exact' },
    provider: { id: 'claude', model: 'claude-opus-5' }
  } as unknown as HarnessTraceEvent
}

const T0 = '2026-10-11T08:30:00.000Z'
const events = [
  traceEvent('evt-tool', 1, 'tool-call', T0, 'npm test'),
  traceEvent('evt-result', 2, 'tool-result', '2026-10-11T08:30:02.400Z', 'ok'),
  traceEvent('evt-error', 3, 'error', '2026-10-11T08:31:00.000Z', 'échec réseau')
]

describe('Observatory · Chronologie en frise', () => {
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

  it('pose l’heure de chaque événement sur l’axe, à côté de sa carte', async () => {
    const view = await mount(events)
    const rows = [...view.querySelectorAll('.observatory-event-row')]

    expect(rows).toHaveLength(3)
    // L'heure est HORS du bouton : la carte et ses sélecteurs restent ceux d'avant.
    for (const row of rows) {
      expect(row.querySelector(':scope > .observatory-event-when')).not.toBeNull()
      expect(row.querySelector(':scope > button.observatory-event')).not.toBeNull()
      expect(row.querySelector('button .observatory-event-when')).toBeNull()
    }
    expect(rows[0].querySelector('.observatory-event-when b')?.textContent).toBe(formatClock(T0))
    expect(rows[0].getAttribute('data-kind')).toBe('tool-call')
    expect(rows[2].getAttribute('data-kind')).toBe('error')
  })

  it('affiche l’écart avec la ligne précédente et fait ressortir une longue attente', async () => {
    const view = await mount(events)
    const whens = [...view.querySelectorAll('[data-testid="observatory-event-when"]')]

    expect(whens[0].querySelector('small')).toBeNull()
    expect(whens[1].querySelector('small')?.textContent).toBe('+2,4 s')
    expect(whens[1].getAttribute('data-pause')).toBeNull()
    expect(whens[2].querySelector('small')?.textContent).toBe('+58 s')
    expect(whens[2].getAttribute('data-pause')).toBe('true')
  })

  it('donne la durée du tour dans son jalon', async () => {
    const view = await mount(events)

    expect(view.querySelector('[data-testid="observatory-turn-span"]')?.textContent).toBe(
      'sur 1 min 00'
    )
  })

  it('laisse un trou visible plutôt qu’une heure inventée quand la trace n’en a pas', async () => {
    const view = await mount([
      traceEvent('evt-a', 1, 'tool-call', T0, 'a'),
      traceEvent('evt-b', 2, 'tool-result', 'pas une date', 'b')
    ])
    const whens = [...view.querySelectorAll('[data-testid="observatory-event-when"]')]

    expect(whens).toHaveLength(2)
    expect(whens[1].querySelector('b')?.textContent).toBe('—')
    expect(whens[1].getAttribute('title')).toBe('Horodatage absent de la trace')
  })
})
