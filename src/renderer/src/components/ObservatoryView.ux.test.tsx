// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'

/**
 * Ergonomie du rail et des états vides d'Observatory.
 *
 * Chaque test décrit un défaut MESURÉ de la vue (rail non filtrable, export qui fuit hors de la
 * conversation, clic image muet, état vide indifférencié, chargement invisible, mode causal sans
 * sortie, comparaison A/B non découvrable) — pas une préférence de style.
 */

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function trace(id: string, conversationId: string): HarnessTraceEvent {
  return {
    id,
    conversationId,
    turnId: `${conversationId}-turn`,
    timestamp: '2026-08-11T10:00:00.000Z',
    sequence: 1,
    type: 'message',
    status: 'completed',
    channel: 'assistant',
    actor: { id: 'agent', kind: 'model', label: 'Agent' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads: [{ kind: 'text', content: `contenu ${id}` }],
    observation: { boundary: 'renderer', fidelity: 'exact' },
    provider: { id: 'codex', model: 'codex-model' },
    metrics: { durationMs: 10 }
  }
}

function baseApi(overrides: Record<string, unknown> = {}) {
  return {
    conversations: vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
    ]),
    promptCalls: vi.fn(async () => []),
    promptTraceSummary: vi.fn(async () => []),
    authorizeDiagnostics: vi.fn(async () => null),
    promptTracesGlobal: vi.fn(async () => []),
    causalTrace: vi.fn(async () => [trace('evt-1', 'conv-1')]),
    brainTraces: vi.fn(async () => []),
    conversationActivity: vi.fn(async () => []),
    activitySessions: vi.fn(async () => []),
    ...overrides
  }
}

describe('Observatory rail & états vides', () => {
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

  async function mount(mockApi: Record<string, unknown>) {
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

  it('borne le rail des conversations et le rend filtrable', async () => {
    const conversations = Array.from({ length: 900 }, (_, index) => ({
      id: `conv-${index}`,
      title: index === 777 ? 'Cible unique zeta' : `Conversation ${index}`,
      provider: index % 2 === 0 ? 'codex' : 'claude',
      updatedAt: 900 - index
    }))
    const view = await mount(baseApi({ conversations: vi.fn(async () => conversations) }))

    const rendered = view.querySelectorAll('.observatory-conversations button')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThanOrEqual(40)

    const filter = view.querySelector(
      '[data-testid="observatory-conversation-filter"]'
    ) as HTMLInputElement
    expect(filter).not.toBeNull()
    await act(async () => setInputValue(filter, 'zeta'))
    const filtered = [...view.querySelectorAll('.observatory-conversations button')]
    expect(filtered).toHaveLength(1)
    expect(filtered[0].textContent).toContain('Cible unique zeta')

    await act(async () => setInputValue(filter, 'claude'))
    const byProvider = view.querySelectorAll('.observatory-conversations button')
    expect(byProvider.length).toBeGreaterThan(1)
    expect(byProvider.length).toBeLessThanOrEqual(40)
  })

  it("n'exporte aucune trace native étrangère à la conversation", async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:observatory'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const nativeTrace = (apiRequestId: string, conversationId: string) => ({
      apiRequestId,
      conversationId,
      turnId: `${conversationId}-turn`,
      timestamp: '2026-08-11T09:00:00.000Z',
      provider: 'openai-codex',
      model: 'gpt',
      boundary: 'native.pre_api_request' as const,
      source: 'plugin-hook' as const,
      fidelity: 'exact-redacted' as const,
      messageCount: 1,
      toolCount: 0,
      request: { body: { messages: [{ content: `payload ${apiRequestId}` }] } }
    })
    const view = await mount(
      baseApi({
        authorizeDiagnostics: vi.fn(async () => ({ token: 'ok' })),
        promptTracesGlobal: vi.fn(async () => [
          nativeTrace('api-mine', 'conv-1'),
          nativeTrace('api-foreign', 'conv-other')
        ])
      })
    )

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

    expect(blobs).toHaveLength(2)
    for (const blob of blobs) {
      const exported = JSON.parse(await blob.text())
      const ids = (exported.nativeRag as Array<{ apiRequestId: string }>).map(
        (item) => item.apiRequestId
      )
      expect(ids).toEqual(['api-mine'])
      expect(JSON.stringify(exported)).not.toContain('api-foreign')
    }
  })

  it('signale un échec de capture de transcript au lieu d’un clic muet', async () => {
    const view = await mount(
      baseApi({
        activitySessions: vi.fn(async () => [
          { id: 's1', project: 'Autowin', path: 'session.jsonl', sizeMb: 1, mtime: 1 }
        ]),
        activitySession: vi.fn(async () => ({
          meta: { id: 's1', project: 'Autowin' },
          turns: [{ kind: 'assistant', text: 'preuve transcript' }],
          images: [{ path: 'proof.png', exists: true }],
          totalToolCalls: 1
        })),
        activityImage: vi.fn(async () => {
          throw new Error('capture supprimée')
        })
      })
    )

    const session = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Autowin')
    ) as HTMLButtonElement
    await act(async () => {
      session.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const image = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Voir image')
    ) as HTMLButtonElement
    await act(async () => {
      image.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const alert = view.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('activityImage')
    expect(alert?.textContent).toContain('capture supprimée')
  })

  it('distingue les trois causes d’un flux vide', async () => {
    const withoutConversation = await mount(baseApi({ conversations: vi.fn(async () => []) }))
    expect(
      withoutConversation.querySelector('[data-testid="observatory-empty-no-conversation"]')
    ).not.toBeNull()
    await act(async () => root?.unmount())
    container?.remove()
    root = null

    const withoutTrace = await mount(baseApi({ causalTrace: vi.fn(async () => []) }))
    expect(withoutTrace.querySelector('[data-testid="observatory-empty-no-trace"]')).not.toBeNull()
    await act(async () => root?.unmount())
    container?.remove()
    root = null

    const view = await mount(baseApi())
    const search = view.querySelector('[data-testid="timeline-controls"] input') as HTMLInputElement
    await act(async () => setInputValue(search, 'zzz-introuvable'))
    const filtered = view.querySelector('[data-testid="observatory-empty-filtered"]')
    expect(filtered).not.toBeNull()
    const reset = filtered?.querySelector('button') as HTMLButtonElement
    await act(async () => reset.click())
    expect(view.querySelector('[data-testid="observatory-empty-filtered"]')).toBeNull()
    expect(view.querySelectorAll('.observatory-event').length).toBeGreaterThan(0)
  })

  it('expose un chargement par section du rail', async () => {
    let releaseCalls!: (value: unknown[]) => void
    let releaseSessions!: (value: unknown[]) => void
    let releaseActivity!: (value: unknown[]) => void
    const view = await mount(
      baseApi({
        promptCalls: vi.fn(
          () =>
            new Promise((resolve) => {
              releaseCalls = resolve
            })
        ),
        activitySessions: vi.fn(
          () =>
            new Promise((resolve) => {
              releaseSessions = resolve
            })
        ),
        conversationActivity: vi.fn(
          () =>
            new Promise((resolve) => {
              releaseActivity = resolve
            })
        )
      })
    )

    expect(view.querySelector('.observatory-calls')?.getAttribute('aria-busy')).toBe('true')
    expect(
      view.querySelector('[data-testid="activity-transcripts"]')?.getAttribute('aria-busy')
    ).toBe('true')
    expect(
      view.querySelector('[data-testid="conversation-activity"]')?.getAttribute('aria-busy')
    ).toBe('true')

    await act(async () => {
      releaseCalls([])
      releaseSessions([])
      releaseActivity([])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(view.querySelector('.observatory-calls')?.getAttribute('aria-busy')).toBe('false')
    expect(
      view.querySelector('[data-testid="activity-transcripts"]')?.getAttribute('aria-busy')
    ).toBe('false')
    expect(
      view.querySelector('[data-testid="conversation-activity"]')?.getAttribute('aria-busy')
    ).toBe('false')
  })

  it('compte et réinitialise le filtre du chemin critique', async () => {
    const view = await mount(
      baseApi({
        causalTrace: vi.fn(async () => [
          trace('evt-1', 'conv-1'),
          trace('evt-2', 'conv-1'),
          trace('evt-3', 'conv-1')
        ])
      })
    )
    const causal = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Chemin critique'
    ) as HTMLButtonElement
    await act(async () => causal.click())

    const reset = view.querySelector(
      '[data-testid="observatory-causal-reset"]'
    ) as HTMLButtonElement
    expect(reset).not.toBeNull()
    expect(reset.disabled).toBe(true)
    const allNodes = view.querySelectorAll('.observatory-causal-node-wrap').length
    expect(allNodes).toBe(3)

    const signals = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Signaux'
    ) as HTMLButtonElement
    await act(async () => signals.click())
    expect(view.querySelector('[data-testid="causal-controls"]')?.textContent).toContain('· 1')
    expect(reset.disabled).toBe(false)
    expect(view.querySelectorAll('.observatory-causal-node-wrap').length).toBeLessThan(allNodes)

    await act(async () => reset.click())
    expect(view.querySelectorAll('.observatory-causal-node-wrap').length).toBe(allNodes)
    expect(
      (view.querySelector('[data-testid="observatory-causal-reset"]') as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('annonce la sélection de comparaison A/B', async () => {
    const view = await mount(
      baseApi({
        causalTrace: vi.fn(async () => [trace('evt-1', 'conv-1'), trace('evt-2', 'conv-1')])
      })
    )
    const status = view.querySelector('[data-testid="observatory-compare-status"]')
    expect(status?.textContent).toContain('0/2')
    expect(status?.textContent?.toLowerCase()).toContain('shift')

    const events = [...view.querySelectorAll('.observatory-event')]
    await act(async () =>
      events[0].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    )
    expect(view.querySelector('[data-testid="observatory-compare-status"]')?.textContent).toContain(
      '1/2'
    )
  })
})
