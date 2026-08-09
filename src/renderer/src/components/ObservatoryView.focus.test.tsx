// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

function trace(turnId: string, content: string, sequence: number): HarnessTraceEvent {
  return {
    id: `${turnId}-event`,
    conversationId: 'conv-1',
    turnId,
    timestamp: `2026-07-20T07:00:0${sequence}.000Z`,
    sequence,
    type: 'model-response',
    status: 'completed',
    channel: 'assistant',
    actor: { id: 'agent', kind: 'model', label: 'Agent' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads: [{ kind: 'text', content }],
    observation: { boundary: 'renderer', fidelity: 'exact' }
  }
}

function api(events: HarnessTraceEvent[], promptCalls: unknown[] = []) {
  return {
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Conversation ciblée', provider: 'codex', updatedAt: 1 }
      ]),
    promptCalls: vi.fn().mockResolvedValue(promptCalls),
    promptTraceSummary: vi.fn().mockResolvedValue([]),
    authorizeDiagnostics: vi.fn().mockResolvedValue(null),
    promptTracesGlobal: vi.fn().mockResolvedValue([]),
    causalTrace: vi.fn().mockResolvedValue(events),
    shadowRouteRecommendation: vi.fn().mockResolvedValue({ kind: 'insufficient-data' })
  }
}

describe('Observatory turn focus', () => {
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
  })

  async function mount(
    mockApi: ReturnType<typeof api>,
    conversationId = 'conv-1',
    turnId = 'turn-2'
  ) {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(ObservatoryView, {
          active: true,
          focus: { conversationId, turnId, requestId: 1 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  it('applies the requested turn after the asynchronous timeline load and resets to the conversation', async () => {
    const container = await mount(
      api([trace('turn-1', 'ancien tour', 1), trace('turn-2', 'tour ciblé', 2)])
    )

    expect(container.textContent).toContain('Tour ciblé · turn-2')
    expect(container.textContent).toContain('tour ciblé')
    expect(container.textContent).not.toContain('ancien tour')

    const reset = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Toute la conversation'
    ) as HTMLButtonElement
    await act(async () => reset.click())
    expect(container.textContent).toContain('tour ciblé')
    expect(container.textContent).toContain('ancien tour')
  })

  it('renders Markdown in an expanded text payload', async () => {
    const view = await mount(
      api([
        trace(
          'turn-2',
          '## Besoin\n\n**Important**\n\n- premier\n\n<script data-injected>danger</script>',
          1
        )
      ])
    )
    const eventButton = view.querySelector('.observatory-event') as HTMLButtonElement

    await act(async () => eventButton.click())

    const payload = view.querySelector('.observatory-payload')
    expect(payload?.querySelector('h2')?.textContent).toBe('Besoin')
    expect(payload?.querySelector('strong')?.textContent).toBe('Important')
    expect(payload?.querySelector('li')?.textContent).toBe('premier')
    expect(payload?.querySelector('script')).toBeNull()
  })

  it('keeps valid JSON payloads in the structured viewer', async () => {
    const view = await mount(api([trace('turn-2', 'ÉTAT: {"ready":true}', 1)]))
    const eventButton = view.querySelector('.observatory-event') as HTMLButtonElement

    await act(async () => eventButton.click())

    expect(view.querySelector('.observatory-payload .human-json')).not.toBeNull()
    expect(view.querySelector('.observatory-payload--markdown')).toBeNull()
  })

  it('shows no unrelated details when the requested conversation or turn is missing', async () => {
    const missingConversationApi = api([trace('turn-2', 'ne doit pas apparaître', 1)])
    const first = await mount(missingConversationApi, 'deleted-conversation', 'turn-2')
    expect(first.textContent).toContain('Conversation ciblée introuvable')
    expect(first.textContent).not.toContain('ne doit pas apparaître')
    expect(missingConversationApi.causalTrace).not.toHaveBeenCalled()

    await act(async () => root?.unmount())
    first.remove()
    root = null
    container = null

    const second = await mount(api([trace('turn-1', 'autre tour', 1)]), 'conv-1', 'deleted-turn')
    expect(second.textContent).toContain('Tour deleted-turn introuvable')
    expect(second.textContent).not.toContain('autre tour')
  })

  it('keeps targeted prompt-call proof when the causal trace is missing', async () => {
    const call = {
      id: 'call-2',
      ts: '2026-07-20T07:00:02.000Z',
      conversationId: 'conv-1',
      turnId: 'turn-2',
      provider: 'codex',
      boundary: 'provider',
      limitation: 'trace causale absente',
      messages: [],
      options: {},
      response: 'preuve provider disponible'
    }
    const view = await mount(api([], [call]))
    expect(view.textContent).toContain('trace causale partielle')
    expect(view.textContent).not.toContain('Tour turn-2 introuvable')
    expect(view.textContent).toContain('codex')
  })

  it('queries shadow routing with the execution phase rather than the actor role', async () => {
    const call = {
      id: 'call-shadow',
      ts: '2026-07-20T07:00:02.000Z',
      conversationId: 'conv-1',
      turnId: 'turn-2',
      iteration: 0,
      actor: 'subagent',
      phase: 'build',
      provider: 'codex',
      model: 'gpt-5.6-codex',
      transport: 'fetch',
      boundary: 'provider',
      limitation: 'opaque',
      messages: [],
      options: {},
      response: 'preuve provider disponible'
    }
    const mockApi = api([], [call])
    const view = await mount(mockApi)
    const observedCall = [...view.querySelectorAll('.observatory-calls button')].find((button) =>
      button.textContent?.includes('gpt-5.6-codex')
    ) as HTMLButtonElement

    await act(async () => observedCall.click())
    const compare = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Comparer en shadow'
    ) as HTMLButtonElement
    await act(async () => {
      compare.click()
      await Promise.resolve()
    })

    expect(mockApi.shadowRouteRecommendation).toHaveBeenCalledWith('build', {
      provider: 'codex',
      model: 'gpt-5.6-codex'
    })
  })

  it('ignore une recommandation shadow résolue après la sélection d’un autre appel', async () => {
    const pending = deferred<{ kind: 'insufficient-data'; phase: string }>()
    const calls = ['call-A', 'call-B'].map((id, index) => ({
      id,
      ts: `2026-07-20T07:00:0${index + 2}.000Z`,
      conversationId: 'conv-1',
      turnId: 'turn-2',
      iteration: index,
      actor: 'subagent',
      phase: 'build',
      provider: 'codex',
      model: id,
      transport: 'fetch',
      boundary: 'provider',
      limitation: 'opaque',
      messages: [],
      options: {},
      response: id
    }))
    const mockApi = api([], calls)
    mockApi.shadowRouteRecommendation.mockReturnValueOnce(pending.promise)
    const view = await mount(mockApi)
    const callA = [...view.querySelectorAll('.observatory-calls button')].find((button) =>
      button.textContent?.includes('call-A')
    ) as HTMLButtonElement
    const callB = [...view.querySelectorAll('.observatory-calls button')].find((button) =>
      button.textContent?.includes('call-B')
    ) as HTMLButtonElement

    await act(async () => callA.click())
    const compare = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Comparer en shadow'
    ) as HTMLButtonElement
    await act(async () => compare.click())
    await act(async () => callB.click())
    await act(async () => {
      pending.resolve({ kind: 'insufficient-data', phase: 'appel A' })
      await pending.promise
      await Promise.resolve()
    })

    expect(view.querySelector('[data-testid="shadow-route-recommendation"]')).toBeNull()
    expect(view.textContent).not.toContain('appel A')
  })

  it('clears the targeted filter when another conversation is selected manually', async () => {
    const mockApi = api([trace('turn-2', 'tour A', 1)])
    mockApi.conversations.mockResolvedValue([
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 },
      { id: 'conv-2', title: 'Conversation B', provider: 'claude', updatedAt: 1 }
    ])
    mockApi.causalTrace.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'conv-1'
          ? [trace('turn-2', 'tour A', 1)]
          : [{ ...trace('turn-B', 'tour B', 1), conversationId: 'conv-2' }]
      )
    )
    const view = await mount(mockApi)
    const conversationB = [...view.querySelectorAll('.observatory-conversations button')].find(
      (button) => button.textContent?.includes('Conversation B')
    ) as HTMLButtonElement
    await act(async () => {
      conversationB.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(view.textContent).not.toContain('Tour ciblé')
    expect(view.textContent).toContain('tour B')
  })

  it('does not republish a stale causal response after focus becomes missing', async () => {
    const pending = deferred<HarnessTraceEvent[]>()
    const mockApi = api([])
    mockApi.causalTrace.mockReturnValue(pending.promise)
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(ObservatoryView, {
          active: true,
          focus: { conversationId: 'conv-1', turnId: 'turn-A', requestId: 1 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mockApi.conversations.mockResolvedValue([])
    await act(async () => {
      root?.render(
        createElement(ObservatoryView, {
          active: true,
          focus: { conversationId: 'missing', turnId: 'turn-X', requestId: 2 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => pending.resolve([trace('turn-A', 'stale A', 1)]))
    expect(container.textContent).toContain('Conversation ciblée introuvable')
    expect(container.textContent).not.toContain('stale A')
  })

  it('clears old evidence immediately when a new focus catalog lookup fails', async () => {
    const mockApi = api([trace('turn-A', 'ancienne preuve A', 1)])
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(ObservatoryView, {
          active: true,
          focus: { conversationId: 'conv-1', turnId: 'turn-A', requestId: 1 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('ancienne preuve A')

    mockApi.conversations.mockRejectedValue(new Error('catalogue hors ligne'))
    await act(async () => {
      root?.render(
        createElement(ObservatoryView, {
          active: true,
          focus: { conversationId: 'conv-new', turnId: 'turn-new', requestId: 2 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('ancienne preuve A')
    expect(container.textContent).toContain('Conversation ciblée indisponible')
    expect(container.textContent).toContain('conversations : catalogue hors ligne')
  })

  it('preserves the Observatory view, open event, and scroll position across tab changes', async () => {
    const mockApi = api([trace('turn-2', 'preuve persistante', 1)])
    const view = await mount(mockApi)
    const causalMode = [...view.querySelectorAll('.observatory-view-switch button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement

    await act(async () => causalMode.click())
    const event = view.querySelector('.observatory-causal-node-wrap > button') as HTMLButtonElement
    await act(async () => event.click())
    const stream = view.querySelector('[data-testid="observatory-stream"]') as HTMLElement
    stream.scrollTop = 240

    await act(async () => {
      root?.render(createElement(ObservatoryView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      root?.render(createElement(ObservatoryView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(causalMode.classList.contains('is-active')).toBe(true)
    expect(view.querySelector('.observatory-causal-detail')).not.toBeNull()
    expect(stream.scrollTop).toBe(240)
  })
})
