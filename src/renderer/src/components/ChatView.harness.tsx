// Harnais partagé des tests de la vue Chat (montage réel de `ChatView` sur happy-dom).
// Extrait pour que chaque levier ait son fichier de test sans recopier 90 lignes de mocks IPC.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { ChatView } from './ChatView'

export const conversation = (id: string, messages: unknown[] = []): Record<string, unknown> => ({
  id,
  title: `Conversation ${id}`,
  category: 'codex',
  provider: 'codex',
  messages,
  updatedAt: 1
})

export function chatApi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn().mockResolvedValue([conversation('A')]),
    conversationRuns: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
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
    orchestrate: vi.fn().mockResolvedValue({ ok: true }),
    cancelOrchestration: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

export interface ChatHarness {
  container: HTMLDivElement
  type: (value: string) => Promise<void>
  click: (selector: string) => Promise<void>
  unmount: () => Promise<void>
  textarea: () => HTMLTextAreaElement
}

export function installRafShim(): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // rAF ET cAF doivent être shimés ENSEMBLE : un rAF rendu par setTimeout produit un id de
  // timer, qu'un cancelAnimationFrame natif ne connaît pas. Shimer seulement rAF rendait donc
  // TOUT cleanup d'animation frame inopérant sous test — un effet démonté continuait de tirer
  // (ack de notice envoyé après unmount, et attribué au montage suivant).
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (handle: number) => window.clearTimeout(handle)
  })
}

export async function mountChat(
  mockApi: Record<string, unknown>,
  props: Record<string, unknown> = {}
): Promise<ChatHarness> {
  Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
  const container = document.createElement('div')
  document.body.append(container)
  let root: Root | null = createRoot(container)
  await act(async () => {
    root?.render(createElement(ChatView, props))
    await Promise.resolve()
    await Promise.resolve()
  })
  const textarea = (): HTMLTextAreaElement =>
    container.querySelector('textarea') as HTMLTextAreaElement
  return {
    container,
    textarea,
    async type(value: string) {
      const el = textarea()
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    async click(selector: string) {
      const element = container.querySelector(selector) as HTMLElement
      if (!element) throw new Error(`sélecteur introuvable : ${selector}`)
      await act(async () => element.click())
    },
    async unmount() {
      if (root) await act(async () => root?.unmount())
      root = null
      container.remove()
    }
  }
}
