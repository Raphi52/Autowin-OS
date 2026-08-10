// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatView } from './ChatView'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const RUN = {
  subject: 'workflow-bench-regression',
  session: 'attaché',
  path: 'runs/workflow-bench-regression/RUN.md',
  mtime: 1,
  summary: { status: 'bloqué', dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
}

const conversation = (id: string): Record<string, unknown> => ({
  id,
  title: `Conversation ${id}`,
  category: 'codex',
  provider: 'codex',
  messages: [],
  updatedAt: 1
})

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn().mockResolvedValue([conversation('A')]),
    conversationRuns: vi.fn().mockResolvedValue([RUN]),
    listRuns: vi.fn().mockResolvedValue([RUN]),
    deleteConversationRun: vi.fn().mockResolvedValue({ ok: true, kind: 'deleted' }),
    deleteRun: vi.fn().mockResolvedValue({ ok: true }),
    runTrace: vi.fn().mockResolvedValue(null),
    readNodeFile: vi.fn(async (path: string) => ({ path, content: '' })),
    topology: vi.fn().mockResolvedValue({
      orchestrator: { provider: 'codex', modelId: 'gpt', reasoningEffort: 'auto' }
    }),
    models: vi.fn().mockResolvedValue([{ id: 'gpt', provider: 'codex', model: 'gpt' }]),
    roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'codex', model: 'gpt' } }),
    onAppEvent: vi.fn(() => vi.fn()),
    onPilotEvent: vi.fn(() => vi.fn()),
    setActiveConversation: vi.fn(),
    conversationsCreate: vi.fn(),
    routeConversationMessage: vi.fn(async (conversationId: string) => ({
      sourceConversationId: conversationId,
      conversationId,
      routed: false,
      decision: { route: 'current', confidence: 1, reason: 'related' }
    })),
    pilotChat: vi.fn().mockResolvedValue({ ok: true }),
    markResponseDisplayed: vi.fn().mockResolvedValue(undefined),
    cancelPilotChat: vi.fn().mockResolvedValue(undefined),
    injectDirective: vi.fn().mockResolvedValue({ ok: true }),
    cancelOrchestration: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('ChatView — mentions de contexte @run / @fichier', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)
    })
  })

  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  async function mount(mockApi: Record<string, unknown>): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, {}))
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  async function type(value: string): Promise<void> {
    const textarea = container?.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function click(selector: string): Promise<void> {
    const element = container?.querySelector(selector) as HTMLElement
    await act(async () => element.click())
  }

  it('propose les runs déjà chargés quand on tape @work, et insère la référence résolue', async () => {
    const mockApi = api()
    await mount(mockApi)
    await click('.conv-pick')

    expect(container!.querySelector('[data-testid="mention-palette"]')).toBeNull()

    await type('débloque @work')
    const items = container!.querySelectorAll('[data-testid="mention-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('workflow-bench-regression')

    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      items[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(textarea.value).toBe('débloque @run:workflow-bench-regression ')
    // La palette se referme après acceptation.
    expect(container!.querySelector('[data-testid="mention-palette"]')).toBeNull()
  })

  it('envoie un prompt PORTANT le contexte résolu, alors que le fil garde le texte tapé', async () => {
    const mockApi = api()
    await mount(mockApi)
    await click('.conv-pick')
    await type('débloque @run:workflow-bench-regression')
    await click('.composer-send')

    const payload = (mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string
      content: string
    }>
    const sent = payload[payload.length - 1]
    expect(sent.role).toBe('user')
    expect(sent.content).toContain('[contexte désigné]')
    expect(sent.content).toContain('- run workflow-bench-regression (bloqué)')
    // Le message AFFICHÉ reste celui que l'utilisateur a tapé.
    expect(container!.querySelector('.msg.user')?.textContent).not.toContain('[contexte désigné]')
  })

  it('n’ouvre aucune palette sur un texte sans mention', async () => {
    await mount(api())
    await click('.conv-pick')
    await type('aucune mention ici')
    expect(container!.querySelector('[data-testid="mention-palette"]')).toBeNull()
  })
})
