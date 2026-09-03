// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/**
 * MÊME COMPTEUR HORS-MODÈLE que `ChatView.frappe-cout.test.tsx`, braqué sur la barre de
 * recherche du fil : chercher ne doit PAS re-rendre les N messages à chaque caractère, sinon on
 * rouvre le gel réparé en conv-1464. Le test ne juge pas un ressenti, il compte des appels.
 */
const compteur = { scans: 0 }
vi.mock('./chat-message-keys', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./chat-message-keys')>()
  return {
    ...reel,
    askDejaRepondu: (...args: Parameters<typeof reel.askDejaRepondu>) => {
      compteur.scans += 1
      return reel.askDejaRepondu(...args)
    },
    lastUserPromptBefore: (...args: Parameters<typeof reel.lastUserPromptBefore>) => {
      compteur.scans += 1
      return reel.lastUserPromptBefore(...args)
    }
  }
})

const { ChatView } = await import('./ChatView')

const FIL = Array.from({ length: 80 }, (_, i) =>
  i % 2 === 0
    ? { role: 'user', content: `question terrain ${i}` }
    : { role: 'assistant', content: `réponse ${i}`, done: true, status: 'completed', parts: [] }
)

const conversation = {
  id: 'A',
  title: 'Conversation A',
  category: 'codex',
  provider: 'codex',
  messages: FIL,
  updatedAt: 1
}

function api(): Record<string, unknown> {
  return {
    conversations: vi.fn().mockResolvedValue([conversation]),
    conversation: vi.fn().mockResolvedValue(conversation),
    capabilityControls: vi.fn().mockResolvedValue([]),
    conversationRuns: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
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
    pilotChat: vi.fn().mockResolvedValue({ ok: true }),
    markResponseDisplayed: vi.fn().mockResolvedValue(undefined),
    cancelPilotChat: vi.fn().mockResolvedValue(undefined),
    injectDirective: vi.fn().mockResolvedValue({ ok: true }),
    cancelOrchestration: vi.fn().mockResolvedValue(undefined)
  }
}

describe('ChatView — coût d’une frappe dans la recherche du fil', () => {
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

  it('ne re-balaie PAS le fil à chaque caractère cherché, et trouve quand même', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: api() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, {}))
      await Promise.resolve()
      await Promise.resolve()
    })
    const pick = container.querySelector('.conv-pick') as HTMLElement
    await act(async () => pick.click())
    expect(container.querySelectorAll('.msg').length).toBeGreaterThan(50)

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
      )
    })
    const champ = container.querySelector('[data-testid="chat-find-input"]') as HTMLInputElement
    expect(champ).not.toBeNull()

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    compteur.scans = 0
    for (const valeur of ['t', 'te', 'ter', 'terr', 'terrain']) {
      await act(async () => {
        setter?.call(champ, valeur)
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    // 5 caractères × 80 messages = 400 appels si le fil est re-rendu. Zéro s'il ne l'est pas.
    expect(compteur.scans).toBe(0)

    // FALSIFIEUR : une barre qui ne cherche rien passerait aussi le compteur à zéro.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    expect(container.querySelector('[data-testid="chat-find-count"]')?.textContent).toBe('1/40')
  })
})
