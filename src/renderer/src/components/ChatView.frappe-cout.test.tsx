// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/**
 * COMPTEUR HORS-MODÈLE du coût d'une frappe. `aUneReponseApres` et `lastUserPromptBefore`
 * balaient le fil pour CHAQUE message : si le fil est re-rendu à chaque caractère, on paie
 * O(n²) par touche — c'est le freeze mesuré (conv-1464). Le test ne juge pas un ressenti, il
 * compte des appels réels.
 */
const compteur = { scans: 0 }
vi.mock('./chat-message-keys', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./chat-message-keys')>()
  return {
    ...reel,
    aUneReponseApres: (...args: Parameters<typeof reel.aUneReponseApres>) => {
      compteur.scans += 1
      return reel.aUneReponseApres(...args)
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
    ? { role: 'user', content: `question ${i}` }
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
    cancelOrchestration: vi.fn().mockResolvedValue(undefined)
  }
}

describe('ChatView — coût d’une frappe dans le composer', () => {
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

  it('ne re-balaie PAS le fil à chaque caractère tapé', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: api() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, {}))
      await Promise.resolve()
      await Promise.resolve()
    })
    // Sélection de la conversation → fil chargé (le rendu initial PEUT balayer, c'est son droit).
    const pick = container.querySelector('.conv-pick') as HTMLElement
    await act(async () => pick.click())
    expect(container.querySelectorAll('.msg').length).toBeGreaterThan(50)

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    compteur.scans = 0
    for (const valeur of ['b', 'bo', 'bon', 'bonj', 'bonjo']) {
      await act(async () => {
        setter?.call(textarea, valeur)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(textarea.value).toBe('bonjo')
    // 5 caractères × 80 messages × 1 scan = 400 appels si le fil est re-rendu. Zéro si non.
    expect(compteur.scans).toBe(0)
  })
  /**
   * FALSIFIEUR de la correction. Le fil est mémoïsé : si ses dépendances étaient mal choisies
   * (`[]`, ou un `messages` remplacé par une ref stable), le compteur resterait à 0 et le premier
   * test passerait quand même — mais le fil serait GELÉ. Cette entrée-là doit alors échouer :
   * un message envoyé DOIT apparaître à l'écran.
   */
  it('affiche quand même le nouveau message envoyé (le memo ne gèle pas le fil)', async () => {
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
    const avant = container.querySelectorAll('.msg.user').length

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(textarea, 'un message tout neuf')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => (container!.querySelector('.composer-send') as HTMLElement).click())

    expect(container.querySelectorAll('.msg.user').length).toBe(avant + 1)
    expect(container.textContent).toContain('un message tout neuf')
  })
})
