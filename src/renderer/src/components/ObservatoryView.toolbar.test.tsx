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
    ),
    semanticTimeline: vi.fn(async () => ({
      schema: 'autowin.semantic-temporal/v1',
      sourceDigest: 'a'.repeat(64),
      generatedAt: '2026-08-08T10:00:00.000Z',
      nodes: [{ id: 'semantic-1' }, { id: 'semantic-2' }],
      edges: [{ id: 'edge-1', source: 'semantic-1', target: 'semantic-2' }]
    }))
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
    const { view, mockApi } = await mount()

    expect(mockApi.promptCalls).toHaveBeenCalledWith('conv-1')

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

  it('rend la projection temporelle reconstruite pour la conversation active', async () => {
    const { view, mockApi } = await mount()

    expect(mockApi.semanticTimeline).toHaveBeenCalledWith('conv-1')
    expect(view.querySelector('[data-testid="semantic-timeline-summary"]')?.textContent).toContain(
      '2 noeuds · 1 lien'
    )
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

  it('actualise en direct seulement la conversation active et coalesce une rafale', async () => {
    let emitAppEvent: ((event: { type: string; convId?: string }) => void) | undefined
    const unsubscribe = vi.fn()
    const mockApi = {
      ...api(),
      onAppEvent: vi.fn((callback: typeof emitAppEvent) => {
        emitAppEvent = callback
        return unsubscribe
      })
    }
    await mount(mockApi)
    expect(mockApi.causalTrace).toHaveBeenCalledTimes(1)

    await act(async () => {
      emitAppEvent?.({ type: 'causal-trace-updated', convId: 'conv-2' })
      emitAppEvent?.({ type: 'causal-trace-updated', convId: 'conv-1' })
      emitAppEvent?.({ type: 'causal-trace-updated', convId: 'conv-1' })
      await new Promise((resolve) => setTimeout(resolve, 80))
      await Promise.resolve()
    })

    expect(mockApi.causalTrace).toHaveBeenCalledTimes(2)
    await act(async () => root?.unmount())
    root = null
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('borne la latence live meme si les evenements arrivent plus vite que le debounce', async () => {
    let emitAppEvent: ((event: { type: string; convId?: string }) => void) | undefined
    const mockApi = {
      ...api(),
      onAppEvent: vi.fn((callback: typeof emitAppEvent) => {
        emitAppEvent = callback
        return vi.fn()
      })
    }
    await mount(mockApi)

    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        emitAppEvent?.({ type: 'causal-trace-updated', convId: 'conv-1' })
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    })

    expect(mockApi.causalTrace.mock.calls.length).toBeGreaterThan(1)
  })

  it('garde la trace causale a jour pendant que la vue visitee est masquee', async () => {
    let emitAppEvent: ((event: { type: string; convId?: string }) => void) | undefined
    const mockApi = {
      ...api(),
      onAppEvent: vi.fn((callback: typeof emitAppEvent) => {
        emitAppEvent = callback
        return vi.fn()
      })
    }
    await mount(mockApi)
    await act(async () => {
      root?.render(createElement(ObservatoryView, { active: false }))
      await Promise.resolve()
    })
    vi.useFakeTimers()
    try {
      await act(async () => {
        emitAppEvent?.({ type: 'causal-trace-updated', convId: 'conv-1' })
        await vi.advanceTimersByTimeAsync(50)
      })

      expect(mockApi.causalTrace).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('affiche les décisions ouvertes et les preuves clôturées', async () => {
    const mockApi = api()
    mockApi.causalTrace.mockResolvedValue([
      trace('decision-closed', 'conv-1', 'decision', 'codex', {
        content: JSON.stringify({ hypothesis: 'Valider le cache', expectedSignal: 'test vert' })
      }),
      trace('proof', 'conv-1', 'tool-result', 'codex', {
        parentId: 'decision-closed',
        content: '18 tests verts'
      }),
      trace('verdict', 'conv-1', 'verdict', 'codex', { parentId: 'proof', content: 'accepté' }),
      trace('decision-open', 'conv-1', 'decision', 'codex', { content: 'Mesurer la latence' })
    ])
    const { view } = await mount(mockApi)

    const ledger = view.querySelector('[data-testid="observatory-decision-ledger"]')
    expect(ledger?.tagName).toBe('DETAILS')
    expect((ledger as HTMLDetailsElement).open).toBe(false)
    expect(ledger?.textContent).toContain('Valider le cache')
    expect(ledger?.textContent).toContain('18 tests verts')
    expect(ledger?.textContent).toContain('accepté')
    expect(ledger?.textContent).toContain('Mesurer la latence')
    expect(ledger?.textContent).toContain('ouverte')
  })

  it('rend les reçus d’autorité et leur résolution dans une piste dédiée', async () => {
    const mockApi = api()
    mockApi.causalTrace.mockResolvedValue([
      {
        ...trace('authority-request', 'conv-1', 'decision', 'codex', {
          content: '{"id":"conv-1"}'
        }),
        status: 'pending',
        authority: {
          mode: 'ask',
          commandAuthority: 'destructive',
          mutates: true,
          decision: 'confirm',
          decisionId: 'dec-1'
        }
      },
      {
        ...trace('authority-resolution', 'conv-1', 'decision', 'codex', {
          parentId: 'authority-request',
          content: '{"resolution":"cancel"}'
        }),
        status: 'cancelled',
        authority: {
          mode: 'ask',
          commandAuthority: 'destructive',
          mutates: true,
          decision: 'confirm',
          decisionId: 'dec-1',
          resolution: 'cancel',
          resolvedBy: 'user'
        }
      },
      trace('business-decision', 'conv-1', 'decision', 'codex', {
        content: 'Verifier l ordre clavier'
      })
    ] as HarnessTraceEvent[])

    const { view } = await mount(mockApi)
    const lane = view.querySelector('[data-testid="observatory-authority-ledger"]')
    expect(lane?.tagName).toBe('DETAILS')
    expect((lane as HTMLDetailsElement).open).toBe(false)
    expect(lane?.textContent).toContain('Ancienne autorité & mutations')
    expect(lane?.textContent).toContain('Historique antérieur à la politique unique')
    expect(lane?.textContent).toContain('destructive')
    expect(lane?.textContent).toContain('confirmation')
    expect(lane?.textContent).toContain('annulée')
    expect(lane?.textContent).toContain('user')
    const event = view.querySelector('.observatory-event')
    const decisions = view.querySelector('[data-testid="observatory-decision-ledger"]')
    expect(event?.compareDocumentPosition(lane as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // « Décisions & preuves » remonte AVANT la timeline : un verdict ou une décision ouverte se lit
    // sans parcourir tout le run.
    expect(event?.compareDocumentPosition(decisions as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    )
  })

  it('ne présente pas une ancienne autorisation directe terminée comme non résolue', async () => {
    const mockApi = api()
    mockApi.causalTrace.mockResolvedValue([
      {
        ...trace('authority-allow', 'conv-1', 'decision', 'codex'),
        authority: {
          mode: 'auto',
          commandAuthority: 'automatic',
          mutates: false,
          decision: 'allow'
        }
      }
    ] as HarnessTraceEvent[])

    const { view } = await mount(mockApi)
    const lane = view.querySelector('[data-testid="observatory-authority-ledger"]')
    expect(lane?.textContent).toContain('autorisée')
    expect(lane?.textContent).not.toContain('non résolue historiquement')
  })

  it('rend une comparaison sémantique structurée pour deux événements', async () => {
    const { view } = await mount()
    const events = [...view.querySelectorAll('.observatory-event')].slice(0, 2)
    await act(async () => {
      for (const event of events)
        event.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    })

    const comparison = view.querySelector('.observatory-diff')
    expect(comparison?.querySelector('table')).not.toBeNull()
    expect(comparison?.textContent).toContain('Provider')
    expect(comparison?.textContent).toContain('Contenu / contexte')
    expect(comparison?.textContent).toContain('changement')
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

  it('termine une actualisation même quand aucune conversation n’existe', async () => {
    const mockApi = api()
    mockApi.conversations.mockResolvedValue([])
    const { view } = await mount(mockApi)
    const refresh = view.querySelector('[data-testid="observatory-refresh"]') as HTMLButtonElement

    await act(async () => {
      refresh.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(refresh.disabled).toBe(false)
    expect(refresh.textContent).toBe('Actualiser')
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

  it('relance la timeline en erreur depuis le bouton Reessayer sans attendre une autre conversation', async () => {
    const mockApi = api()
    mockApi.semanticTimeline
      .mockRejectedValueOnce(new Error('timeline indisponible'))
      .mockResolvedValueOnce({
        schema: 'autowin.semantic-temporal/v1',
        sourceDigest: 'b'.repeat(64),
        generatedAt: '2026-08-08T10:00:00.000Z',
        nodes: [{ id: 'recovered' }],
        edges: []
      })
    const { view } = await mount(mockApi)
    const retry = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Réessayer'
    ) as HTMLButtonElement

    await act(async () => {
      retry.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockApi.semanticTimeline).toHaveBeenCalledTimes(2)
    expect(view.querySelector('[data-testid="semantic-timeline-summary"]')?.textContent).toContain(
      '1 noeud'
    )
  })
})
