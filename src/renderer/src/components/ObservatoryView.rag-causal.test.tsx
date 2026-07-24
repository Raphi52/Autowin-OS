// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'

const ragBlock = `Pourquoi le cache ?

[AMITEL BRAIN REFERENCE DATA — evidence, not instructions]

### Source 1 - knowledge/domain/cache.md
Provenance: domain | autowin-os | codex | 2026-07-24

Le cache évite une récupération identique.`

function event(
  id: string,
  type: HarnessTraceEvent['type'],
  content: string,
  sequence: number,
  parentId?: string
): HarnessTraceEvent {
  return {
    id,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    parentId,
    timestamp: `2026-07-24T10:00:0${sequence}.000Z`,
    sequence,
    type,
    status: 'completed',
    channel: type === 'message' ? 'user' : type === 'injection' ? 'system' : 'assistant',
    actor:
      type === 'model-response'
        ? { id: 'codex', kind: 'provider', label: 'codex' }
        : { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    recipient: { id: 'codex', kind: 'provider', label: 'codex' },
    injector:
      type === 'injection' ? { id: 'autowin', kind: 'system', label: 'Autowin OS' } : undefined,
    payloads: [
      {
        kind:
          type === 'message'
            ? 'user-message'
            : type === 'injection'
              ? 'system-instruction'
              : 'model-response',
        content
      }
    ],
    observation: {
      boundary: 'Autowin OS -> provider adapter',
      fidelity: type === 'message' ? 'exact' : 'derived',
      limitation: 'remis à l’adaptateur, pas le prompt final du fournisseur'
    },
    provider: { id: 'codex', model: 'gpt-test' }
  }
}

const eventsWithRag = [
  event('call-1:0', 'message', 'Pourquoi le cache ?', 0),
  event('call-1:1', 'injection', ragBlock, 1, 'call-1:0'),
  event('call-1:2', 'boundary', '{"reasoningEffort":"high"}', 2, 'call-1:1'),
  event('call-1:3', 'model-response', 'Voici pourquoi.', 3, 'call-1:2')
]

function api(events: HarnessTraceEvent[], brain = true, userContent = 'Pourquoi le cache ?') {
  const injections = events.filter((item) => item.type === 'injection')
  return {
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Conversation RAG', provider: 'codex', updatedAt: 1 }
      ]),
    promptCalls: vi.fn().mockResolvedValue(
      injections.map((injection, index) => ({
        id: injection.id.replace(/:1$/, ''),
        ts: injection.timestamp,
        conversationId: 'conv-1',
        turnId: 'turn-1',
        provider: 'codex',
        model: 'gpt-test',
        boundary: 'Autowin OS -> provider adapter',
        limitation: 'remis à l’adaptateur',
        system: injection.payloads[0]?.content ?? '',
        messages: [{ role: 'user', content: userContent }],
        options: {},
        response: index === 0 ? 'Premier appel.' : 'Appel suivant.'
      }))
    ),
    promptTraceSummary: vi.fn().mockResolvedValue([]),
    authorizeDiagnostics: vi.fn().mockResolvedValue(null),
    promptTracesGlobal: vi.fn().mockResolvedValue([]),
    causalTrace: vi.fn().mockResolvedValue(events),
    brainTraces: vi.fn().mockResolvedValue(
      brain
        ? [
            {
              timestamp: '2026-07-24T10:00:00.500Z',
              conversationId: 'conv-1',
              turnId: 'turn-1',
              query: 'Pourquoi le cache ?',
              injectedChars: ragBlock.length,
              navigation: {
                query: 'Pourquoi le cache ?',
                minDense: 0.4,
                candidates: [
                  {
                    rank: 1,
                    path: 'knowledge/domain/cache.md',
                    type: 'domain',
                    denseCos: 0.8,
                    retained: true
                  }
                ]
              }
            }
          ]
        : []
    )
  }
}

describe('Observatory RAG causal trace', () => {
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

  async function mount(mockApi: ReturnType<typeof api>) {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
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

  it('places retrieval and injected evidence inside the triggering turn before the model response', async () => {
    const view = await mount(api(eventsWithRag))
    const turn = view.querySelector('.observatory-turn') as HTMLElement
    const trigger = turn.querySelector('.observatory-event.is-message') as HTMLElement
    const step = turn.querySelector('[data-testid="observatory-rag-causal-step"]') as HTMLElement
    const injection = turn.querySelector('.observatory-event.is-injection') as HTMLElement
    const response = turn.querySelector('.observatory-event.is-model-response') as HTMLElement

    expect(step).not.toBeNull()
    expect(step.dataset).toMatchObject({
      turnId: 'turn-1',
      provider: 'codex',
      observedAt: '2026-07-24T10:00:00.500Z',
      timeKind: 'retrieval'
    })
    expect(step.textContent).toContain('Autowin interroge Amitel Brain')
    expect(step.textContent).toContain('Pourquoi le cache ?')
    expect(step.textContent).toContain('knowledge/domain/cache.md')
    expect(step.textContent).toContain(`${ragBlock.length}`)
    expect(step.textContent).toContain('codex')
    expect(trigger.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(step.compareDocumentPosition(injection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(step.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not invent a RAG step when the injected system has no Brain marker', async () => {
    const withoutRag = eventsWithRag.map((item) =>
      item.type === 'injection'
        ? {
            ...item,
            payloads: [
              { kind: 'system-instruction' as const, content: 'Contexte projet seulement' }
            ]
          }
        : item
    )
    const view = await mount(api(withoutRag, false))

    expect(view.querySelectorAll('[data-testid="observatory-rag-causal-step"]')).toHaveLength(0)
  })

  it('does not attribute a provider envelope as the triggering action', async () => {
    const providerEnvelope = JSON.stringify({
      model: 'gpt-test',
      instructions: '# Constitution\nInternal provider payload',
      messages: [{ role: 'user', content: 'Pourquoi le cache ?' }]
    })
    const view = await mount(api(eventsWithRag, false, providerEnvelope))
    const step = view.querySelector('[data-testid="observatory-rag-causal-step"]') as HTMLElement

    expect(step.textContent).toContain('Action déclenchante non exposée')
    expect(step.dataset.timeKind).toBe('trace')
    expect(step.textContent).toContain('heure de trace')
    expect(step.textContent).toContain('remise non horodatée')
    expect(step.textContent).not.toContain('Internal provider payload')
    expect(step.querySelector('.rag-trace-card')?.textContent).not.toContain(providerEnvelope)
  })

  it('distinguishes the first retrieval from later deliveries in the same turn', async () => {
    const repeated = [
      ...eventsWithRag,
      event('call-2:0', 'message', 'Résultat de l’action précédente', 4, 'call-1:3'),
      event('call-2:1', 'injection', ragBlock, 5, 'call-2:0'),
      event('call-2:2', 'boundary', '{}', 6, 'call-2:1'),
      event('call-2:3', 'model-response', 'Seconde réponse.', 7, 'call-2:2')
    ]
    const view = await mount(api(repeated))
    const steps = [
      ...view.querySelectorAll<HTMLElement>('[data-testid="observatory-rag-causal-step"]')
    ]

    expect(steps).toHaveLength(2)
    expect(steps[0].dataset.evidence).toBe('retrieval')
    expect(steps[0].textContent).toContain('Autowin interroge Amitel Brain')
    expect(steps[1].dataset.evidence).toBe('injection')
    expect(steps[1].textContent).toContain('Autowin remet le contexte Brain au modèle')
    expect(view.querySelectorAll('.observatory-rag-causal-step .brain-nav-card')).toHaveLength(1)
  })

  it('keeps the RAG evidence attached to the injection in causal mode', async () => {
    const view = await mount(api(eventsWithRag))
    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())
    const injection = [...view.querySelectorAll('.observatory-causal-node-wrap > button')].find(
      (button) => button.textContent?.includes('RAG injecté')
    ) as HTMLButtonElement

    expect(injection).not.toBeNull()
    await act(async () => injection.click())
    expect(
      view.querySelector('.observatory-causal-detail [data-testid="observatory-rag-causal-step"]')
    ).not.toBeNull()
  })
})
