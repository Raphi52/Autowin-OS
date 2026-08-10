// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'

function baseTrace(
  overrides: Partial<HarnessTraceEvent> & { id: string; type: HarnessTraceEvent['type'] }
): HarnessTraceEvent {
  return {
    conversationId: 'conv-1',
    turnId: 'turn-1',
    timestamp: '2026-07-20T07:00:00.000Z',
    sequence: 1,
    status: 'completed',
    channel: 'assistant',
    actor: { id: 'agent', kind: 'model', label: 'Agent' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads: [{ kind: 'text', content: 'contenu' }],
    observation: { boundary: 'renderer', fidelity: 'exact' },
    ...overrides
  } as HarnessTraceEvent
}

const events: HarnessTraceEvent[] = [
  baseTrace({
    id: 'decision-1',
    type: 'decision',
    sequence: 1,
    payloads: [{ kind: 'text', content: 'Hypothèse : le cache est froid' }]
  }),
  // Gros payload SAIN : 40 000 caractères, aucun défaut diagnostique.
  baseTrace({
    id: 'injection-1',
    type: 'injection',
    sequence: 2,
    channel: 'system',
    payloads: [{ kind: 'text', content: 'A'.repeat(40_000) }]
  }),
  baseTrace({
    id: 'error-1',
    type: 'error',
    sequence: 3,
    status: 'error',
    payloads: [{ kind: 'text', content: 'exit 1' }]
  })
]

function nativeTrace(id: string, conversationId: string | undefined) {
  return {
    apiRequestId: id,
    conversationId,
    turnId: 'unknown',
    timestamp: '2026-07-20T07:00:00.000Z',
    provider: 'codex',
    model: 'gpt-5',
    messageCount: 2,
    toolCount: 0,
    request: { system: `payload ${id}` },
    fidelity: 'exact-redacted'
  }
}

function mockApi(nativeTraces: unknown[]) {
  return {
    conversations: vi.fn().mockResolvedValue([
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 },
      { id: 'conv-2', title: 'Conversation B', provider: 'codex', updatedAt: 1 }
    ]),
    promptCalls: vi.fn().mockResolvedValue([]),
    promptTraceSummary: vi.fn().mockResolvedValue([]),
    authorizeDiagnostics: vi.fn().mockResolvedValue({ token: 'ok' }),
    promptTracesGlobal: vi.fn().mockResolvedValue(nativeTraces),
    causalTrace: vi.fn(async (id: string) => (id === 'conv-1' ? events : [])),
    shadowRouteRecommendation: vi.fn().mockResolvedValue({ kind: 'insufficient-data' }),
    onAppEvent: vi.fn(() => () => {})
  }
}

describe('Observatory triage : gravité, remontée du verdict, scope des payloads natifs', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let container: HTMLDivElement | null = null

  async function mount(nativeTraces: unknown[] = []): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi(nativeTraces) })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ObservatoryView, { active: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    return container
  }

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('classe l’erreur avant un gros payload sain dans les signaux prioritaires', async () => {
    const view = await mount()
    const signals = [
      ...view.querySelectorAll('.observatory-diagnostics button[data-signal-id]')
    ] as HTMLElement[]
    expect(signals.length).toBeGreaterThanOrEqual(2)
    const severities = signals.map((button) => button.dataset.severity)
    expect(severities[0]).toBe('error')
    // Un gros payload sain ne doit JAMAIS précéder une erreur, même avec 40 000 caractères.
    expect(severities.indexOf('error')).toBeLessThan(severities.lastIndexOf('info'))
  })

  it('rend « Décisions & preuves » AVANT la timeline des tours', async () => {
    const view = await mount()
    const ledger = view.querySelector('[data-testid="observatory-decision-ledger"]')
    const firstTurn = view.querySelector('.observatory-turn')
    expect(ledger).not.toBeNull()
    expect(firstTurn).not.toBeNull()
    expect(ledger!.textContent).toContain('Décisions & preuves')
    expect(ledger!.textContent).toContain('Gate')
    expect(
      ledger!.compareDocumentPosition(firstTurn!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('ne fait fuiter aucun payload natif global non rattaché dans une autre conversation', async () => {
    const view = await mount([
      nativeTrace('native-global', undefined),
      nativeTrace('native-conv-2', 'conv-2')
    ])
    const diagnostics = view.querySelector('.observatory-native-diagnostics')
    // conv-1 est ouverte : ni le payload global, ni celui de conv-2 ne la décrivent.
    expect(diagnostics).toBeNull()

    const conv2 = [...view.querySelectorAll('.observatory-conversations button')].find((button) =>
      button.textContent?.includes('Conversation B')
    ) as HTMLButtonElement
    await act(async () => {
      conv2.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const scoped = view.querySelector('.observatory-native-diagnostics')
    expect(scoped).not.toBeNull()
    expect(scoped!.textContent).toContain('1 payload')
  })
})
