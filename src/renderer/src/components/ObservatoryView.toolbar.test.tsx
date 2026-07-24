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

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function trace(
  id: string,
  conversationId: string,
  type: HarnessTraceEvent['type'],
  provider: string,
  options: { parentId?: string; durationMs?: number; content?: string } = {}
): HarnessTraceEvent {
  return {
    id,
    conversationId,
    turnId: `${conversationId}-turn`,
    parentId: options.parentId,
    timestamp: `2026-07-23T20:00:0${id.length}.000Z`,
    sequence: id.length,
    type,
    status: type === 'error' ? 'failed' : 'completed',
    channel: 'assistant',
    actor: { id: 'agent', kind: 'model', label: 'Agent' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads: [{ kind: 'text', content: options.content ?? id }],
    observation: { boundary: 'renderer', fidelity: 'exact' },
    provider: { id: provider, model: `${provider}-model` },
    metrics: { durationMs: options.durationMs ?? 10 }
  }
}

const convOne = [
  trace('root-main', 'conv-1', 'message', 'codex', { durationMs: 100 }),
  trace('tool', 'conv-1', 'tool-call', 'codex', {
    parentId: 'root-main',
    durationMs: 60
  }),
  trace('tool-result', 'conv-1', 'tool-result', 'codex', {
    parentId: 'tool',
    durationMs: 20
  }),
  trace('error-root', 'conv-1', 'error', 'claude', { durationMs: 5 })
]
const convTwo = [trace('other', 'conv-2', 'model-response', 'kimi', { content: 'conversation B' })]
const convWithAnomaly = [
  ...convOne,
  trace('injection-a', 'conv-1', 'injection', 'codex', { content: 'instruction répétée' }),
  trace('injection-b', 'conv-1', 'injection', 'codex', { content: 'instruction répétée' })
]

function api() {
  return {
    conversations: vi.fn().mockResolvedValue([
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 },
      { id: 'conv-2', title: 'Conversation B', provider: 'kimi', updatedAt: 1 }
    ]),
    promptCalls: vi.fn().mockResolvedValue([]),
    promptTraceSummary: vi.fn().mockResolvedValue([]),
    authorizeDiagnostics: vi.fn().mockResolvedValue(null),
    promptTracesGlobal: vi.fn().mockResolvedValue([]),
    causalTrace: vi.fn((conversationId: string) =>
      Promise.resolve(conversationId === 'conv-1' ? convOne : convTwo)
    )
  }
}

describe('Observatory contextual toolbar', () => {
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

  async function mount(mockApi = api()) {
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
    return { view: container, mockApi }
  }

  it('organise la barre en trois zones et rend les filtres rapides mesurables', async () => {
    const { view } = await mount()

    expect(view.querySelectorAll('.observatory-toolbar > [data-toolbar-zone]')).toHaveLength(3)
    expect(view.querySelector('[data-testid="observatory-result-count"]')?.textContent).toContain(
      '4 / 4'
    )

    const tools = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Outils'
    ) as HTMLButtonElement
    await act(async () => tools.click())

    expect(view.querySelectorAll('.observatory-event')).toHaveLength(2)
    expect(view.querySelector('[data-testid="observatory-result-count"]')?.textContent).toContain(
      '2 / 4'
    )

    const reset = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Réinitialiser'
    ) as HTMLButtonElement
    await act(async () => reset.click())
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(4)
  })

  it('rend la recherche et le filtre Type effectifs puis réinitialisables', async () => {
    const { view } = await mount()
    const search = view.querySelector(
      'input[placeholder="Rechercher acteur, modèle, contenu…"]'
    ) as HTMLInputElement
    await act(async () => {
      setInputValue(search, 'error-root')
    })
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(1)
    expect(view.querySelector('[data-testid="observatory-result-count"]')?.textContent).toContain(
      '1 / 4'
    )

    await act(async () => {
      setInputValue(search, '')
    })
    const type = view.querySelector('select[aria-label="Type"]') as HTMLSelectElement
    await act(async () => {
      type.value = 'tool-call'
      type.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(1)

    const reset = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Réinitialiser'
    ) as HTMLButtonElement
    await act(async () => reset.click())
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(4)
  })

  it('remplace les filtres chronologiques par des contrôles causaux effectifs', async () => {
    const { view } = await mount()
    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())

    expect(view.querySelector('[data-testid="timeline-controls"]')).toBeNull()
    expect(view.querySelector('[data-testid="causal-controls"]')).not.toBeNull()
    const before = view.querySelectorAll('.observatory-causal-node-wrap').length

    const criticalOnly = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Critique seul'
    ) as HTMLButtonElement
    await act(async () => criticalOnly.click())

    expect(view.querySelectorAll('.observatory-causal-node-wrap').length).toBeLessThan(before)
  })

  it('isole les anomalies avec le filtre causal Signaux', async () => {
    const { view } = await mount()
    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())
    const before = view.querySelectorAll('.observatory-causal-node-wrap').length
    const signals = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Signaux'
    ) as HTMLButtonElement
    await act(async () => signals.click())

    const visible = [...view.querySelectorAll('.observatory-causal-node-wrap > button')]
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(before)
    expect(
      visible.every(
        (node) =>
          node.classList.contains('is-bottleneck') ||
          node.textContent?.includes('error') ||
          node.querySelector('em') != null
      )
    ).toBe(true)
  })

  it('ouvre un signal prioritaire même après un filtre rapide incompatible', async () => {
    const mockApi = api()
    mockApi.causalTrace.mockResolvedValue(convWithAnomaly)
    const { view } = await mount(mockApi)
    const tools = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Outils'
    ) as HTMLButtonElement
    await act(async () => tools.click())
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(2)

    const signal = view.querySelector('.observatory-diagnostics button') as HTMLButtonElement
    await act(async () => signal.click())

    expect(view.querySelectorAll('.observatory-event')).toHaveLength(convWithAnomaly.length)
    expect(view.querySelector('.observatory-event.is-selected')).not.toBeNull()
    expect(view.textContent).toContain('instruction répétée')
  })

  it('ouvre un signal non critique même sous le filtre causal Critique seul', async () => {
    const mockApi = api()
    mockApi.causalTrace.mockResolvedValue(convWithAnomaly)
    const { view } = await mount(mockApi)
    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())
    const criticalOnly = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Critique seul'
    ) as HTMLButtonElement
    await act(async () => criticalOnly.click())

    const signal = view.querySelector('.observatory-diagnostics button') as HTMLButtonElement
    await act(async () => signal.click())

    const allLinks = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tous les liens'
    ) as HTMLButtonElement
    expect(allLinks.getAttribute('aria-pressed')).toBe('true')
    expect(view.querySelector('.observatory-causal-detail')).not.toBeNull()
    expect(view.querySelector('.observatory-causal-node-wrap .is-selected')).not.toBeNull()
  })

  it('réinitialise un filtre incompatible au changement de conversation', async () => {
    const { view } = await mount()
    const provider = view.querySelector('select[aria-label="Provider"]') as HTMLSelectElement
    await act(async () => {
      provider.value = 'claude'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(1)

    const conversationB = [...view.querySelectorAll('.observatory-conversations button')].find(
      (button) => button.textContent?.includes('Conversation B')
    ) as HTMLButtonElement
    await act(async () => {
      conversationB.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect((view.querySelector('select[aria-label="Provider"]') as HTMLSelectElement).value).toBe(
      'all'
    )
    expect(view.textContent).toContain('conversation B')
  })

  it('réinitialise aussi le périmètre causal au changement de conversation', async () => {
    const { view } = await mount()
    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())
    const signals = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Signaux'
    ) as HTMLButtonElement
    await act(async () => signals.click())
    expect(signals.getAttribute('aria-pressed')).toBe('true')

    const conversationB = [...view.querySelectorAll('.observatory-conversations button')].find(
      (button) => button.textContent?.includes('Conversation B')
    ) as HTMLButtonElement
    await act(async () => {
      conversationB.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const allLinks = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Tous les liens'
    ) as HTMLButtonElement
    expect(allLinks.getAttribute('aria-pressed')).toBe('true')
    expect(view.querySelectorAll('.observatory-causal-node-wrap')).toHaveLength(1)
  })

  it('réinitialise les filtres lors d’un changement de conversation par focus externe', async () => {
    const { view } = await mount()
    const provider = view.querySelector('select[aria-label="Provider"]') as HTMLSelectElement
    await act(async () => {
      provider.value = 'claude'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(1)

    await act(async () => {
      root?.render(
        createElement(ObservatoryView, {
          active: true,
          focus: { conversationId: 'conv-2', turnId: 'conv-2-turn', requestId: 1 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect((view.querySelector('select[aria-label="Provider"]') as HTMLSelectElement).value).toBe(
      'all'
    )
    expect(view.querySelectorAll('.observatory-event')).toHaveLength(1)
    expect(view.textContent).toContain('conversation B')
  })

  it('propose deux exports explicitement distincts', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:observatory'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { view } = await mount()

    const tools = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Outils'
    ) as HTMLButtonElement
    await act(async () => tools.click())

    const exportView = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Exporter la vue'
    ) as HTMLButtonElement
    const exportAll = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Exporter toute la trace'
    ) as HTMLButtonElement
    await act(async () => {
      exportView.click()
      exportAll.click()
    })

    const [visible, complete] = await Promise.all(blobs.map((blob) => blob.text()))
    expect(JSON.parse(visible)).toMatchObject({ scope: 'view' })
    expect(JSON.parse(complete)).toMatchObject({ scope: 'full' })
    expect(visible).not.toContain('error-root')
    expect(complete).toContain('error-root')
  })

  it('exporte uniquement les nœuds de la vue causale affichée', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:observatory'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { view } = await mount()

    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())
    const criticalOnly = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Critique seul'
    ) as HTMLButtonElement
    await act(async () => criticalOnly.click())
    const visibleNodeCount = view.querySelectorAll('.observatory-causal-node-wrap').length

    const exportView = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Exporter la vue'
    ) as HTMLButtonElement
    await act(async () => exportView.click())

    const exported = JSON.parse(await blobs[0].text())
    expect(exported.view).toEqual({
      mode: 'causal',
      quickFilter: 'all',
      causalScope: 'critical'
    })
    expect(exported.causalNodes).toHaveLength(visibleNodeCount)
    expect(
      exported.timeline.turns.flatMap((turn: { events: unknown[] }) => turn.events)
    ).toHaveLength(visibleNodeCount)
  })

  it('affiche un état occupé puis une fraîcheur après actualisation', async () => {
    const mockApi = api()
    const pending = deferred<HarnessTraceEvent[]>()
    const { view } = await mount(mockApi)
    mockApi.causalTrace.mockReturnValueOnce(pending.promise)
    const refresh = view.querySelector('[data-testid="observatory-refresh"]') as HTMLButtonElement

    await act(async () => refresh.click())
    expect(refresh.disabled).toBe(true)
    expect(refresh.textContent).toContain('Actualisation')

    await act(async () => {
      pending.resolve(convOne)
      await pending.promise
      await Promise.resolve()
    })
    expect(refresh.disabled).toBe(true)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320))
    })
    expect(refresh.disabled).toBe(false)
    expect(view.querySelector('[data-testid="observatory-freshness"]')?.textContent).toContain(
      'Actualisé'
    )
  })

  it('signale une fraîcheur partielle quand une source secondaire échoue', async () => {
    const mockApi = api()
    mockApi.promptCalls.mockRejectedValue(new Error('promptCalls indisponible'))
    const { view } = await mount(mockApi)

    const freshness = view.querySelector('[data-testid="observatory-freshness"]')
    expect(freshness?.getAttribute('data-refresh-status')).toBe('partial')
    expect(freshness?.textContent).toContain('Actualisation partielle')
    expect(view.querySelector('.observatory-source-errors')?.textContent).toContain(
      'promptCalls indisponible'
    )
  })
})
