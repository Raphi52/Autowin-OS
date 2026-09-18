// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/**
 * COMPTEUR HORS-MODÈLE du coût d'une frappe. `askDejaRepondu` et `lastUserPromptBefore`
 * balaient le fil pour CHAQUE message : si le fil est re-rendu à chaque caractère, on paie
 * O(n²) par touche — c'est le freeze mesuré (conv-1464). Le test ne juge pas un ressenti, il
 * compte des appels réels.
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

/** Le fil se complète par tranches : on laisse passer les tâches jusqu'à ce qu'il soit entier. */
async function attendreFilComplet(conteneur: HTMLElement, attendu: number): Promise<void> {
  for (let i = 0; i < 100 && conteneur.querySelectorAll('.msg').length < attendu; i += 1) {
    await act(async () => new Promise((fin) => setTimeout(fin, 5)))
  }
  expect(conteneur.querySelectorAll('.msg').length).toBe(attendu)
}

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
    await attendreFilComplet(container, FIL.length)

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
   * GEL À L'OUVERTURE D'UN LONG FIL — cause des gels `vue-chat` (p95 ≈ 10 s, 859 gels, conv-526 en
   * tête avec 87). Mesuré le 2026-09-18 : rendre les 164 messages de conv-526 d'UN SEUL COUP coûte
   * 3,3 s de rendu React. Le premier rendu ne doit porter que la FIN du fil ; le reste arrive par
   * tranches, dans des tâches séparées qui rendent la main à l'affichage entre deux.
   */
  it("n'affiche pas tout un long fil en un seul rendu, puis le complète", async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: api() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, {}))
      await Promise.resolve()
      await Promise.resolve()
    })
    // `act` regroupe en UN rendu les tranches planifiées pendant qu'il attend : il masquerait
    // exactement ce qu'on mesure. Ici React planifie ses rendus comme dans l'application.
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const pick = container.querySelector('.conv-pick') as HTMLElement
    pick.click()
    let premierAffichage = container.querySelectorAll('.msg').length
    for (let i = 0; i < 400 && container.querySelectorAll('.msg').length < FIL.length; i += 1) {
      await new Promise((fin) => setTimeout(fin, 0))
      premierAffichage ||= container.querySelectorAll('.msg').length
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    // La fin du fil est là tout de suite : c'est ce que l'utilisateur regarde.
    expect(container.textContent).toContain('question 78')
    await attendreFilComplet(container, FIL.length)
    expect(container.textContent).toContain('question 0')
    // Le premier affichage ne porte PAS le fil entier (avant : les 80 d'un coup).
    expect(premierAffichage).toBeGreaterThan(0)
    expect(premierAffichage).toBeLessThan(FIL.length)
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
    await attendreFilComplet(container, FIL.length)
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
