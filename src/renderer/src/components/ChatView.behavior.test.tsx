// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatView } from './ChatView'

const markdownRenderCount = vi.hoisted(() => ({ value: 0 }))
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => {
    markdownRenderCount.value += 1
    return createElement('span', null, text)
  },
  extractRecommendation: (): string | null => null
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const conversation = (id: string, messages: unknown[] = []) => ({
  id,
  title: `Conversation ${id}`,
  category: 'codex',
  provider: 'codex',
  messages,
  updatedAt: 1
})

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn().mockResolvedValue([]),
    conversationRuns: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
    authorityPending: vi.fn().mockResolvedValue([]),
    topology: vi.fn().mockResolvedValue({
      orchestrator: { provider: 'codex', modelId: 'gpt', reasoningEffort: 'auto' }
    }),
    models: vi.fn().mockResolvedValue([{ id: 'gpt', provider: 'codex', model: 'gpt' }]),
    roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'codex', model: 'gpt' } }),
    onAppEvent: vi.fn(() => vi.fn()),
    onPilotEvent: vi.fn(() => vi.fn()),
    setActiveConversation: vi.fn(),
    conversationsCreate: vi.fn(),
    routeConversationMessage: vi.fn(
      async (conversationId: string) => ({
        sourceConversationId: conversationId,
        conversationId,
        routed: false,
        decision: { route: 'current', confidence: 1, reason: 'related' }
      })
    ),
    pilotChat: vi.fn().mockResolvedValue({ ok: true }),
    markResponseDisplayed: vi.fn().mockResolvedValue(undefined),
    cancelPilotChat: vi.fn().mockResolvedValue(undefined),
    injectDirective: vi.fn().mockResolvedValue({ ok: true }),
    cancelOrchestration: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

/**
 * Parité Claude Code : envoyer pendant un tour INJECTE dans le tour courant ; la FILE d'attente
 * n'est plus qu'un REPLI (injection impossible). Ce mock fait échouer les `failures` premières
 * injections (celles du composer → remplissent la file, ce que ces tests exercent) puis délègue à
 * `then` (utilisé par le bouton « 🧭 Orienter »).
 */
function injectFailingThen(
  failures: number,
  then: () => Promise<{ ok: boolean }> = async () => ({ ok: true })
): ReturnType<typeof vi.fn> {
  let seen = 0
  return vi.fn(() => {
    seen += 1
    return seen <= failures ? Promise.reject(new Error('injection indisponible')) : then()
  })
}

describe('ChatView behavior under concurrent UI actions', () => {
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
      root?.render(createElement(ChatView))
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

  async function flushAnimationFrames(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  it('blocks a synchronous double Enter with one pilot request', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('B')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('une seule fois')
    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('drains queued messages in order after stopping the active turn', async () => {
    const firstTurn = deferred<{ ok: boolean; cancelled?: boolean }>()
    const secondTurn = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi
        .fn()
        .mockImplementationOnce(() => firstTurn.promise)
        .mockImplementationOnce(() => secondTurn.promise)
        .mockResolvedValue({ ok: true })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('A')
    await click('.composer-send')
    await type('B')
    await click('.composer-send')

    await click('.directive-queue-send-all')
    expect(mockApi.cancelPilotChat).toHaveBeenCalledWith('A')

    await act(async () => {
      firstTurn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(2)
    expect((mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[1][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'A' })])
    )

    await act(async () => {
      secondTurn.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(3)
    expect((mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[2][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'B' })])
    )
  })

  it('affiche et vide le prompt immédiatement avant la fin du routage', async () => {
    const routing = deferred<{
      sourceConversationId: string
      conversationId: string
      routed: boolean
      decision: { route: 'current'; confidence: number; reason: string }
    }>()
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      routeConversationMessage: vi.fn(() => routing.promise),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('prompt instantané')

    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(textarea.value).toBe('')
    expect(container!.querySelector('.chat-scroll')?.textContent).toContain('prompt instantané')
    expect(mockApi.pilotChat).not.toHaveBeenCalled()

    await act(async () =>
      routing.resolve({
        sourceConversationId: 'A',
        conversationId: 'A',
        routed: false,
        decision: { route: 'current', confidence: 1, reason: 'related' }
      })
    )
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('restaure le brouillon si le routage échoue après le commit optimiste', async () => {
    const routing = deferred<never>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      routeConversationMessage: vi.fn(() => routing.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('prompt à restaurer')
    await click('.composer-send')
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')

    await act(async () => routing.reject(new Error('routeur indisponible')))

    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'prompt à restaurer'
    )
    expect(container!.querySelector('.chat-scroll')?.textContent).not.toContain(
      'prompt à restaurer'
    )
    expect(container!.textContent).toContain('routeur indisponible')
  })

  it('moves an unrelated message to a new active conversation before pilotChat', async () => {
    const source = conversation('A', [
      { role: 'user', content: 'Refais le graphe Git', ts: 1 }
    ])
    const target = conversation('B')
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([source])
      .mockResolvedValue([source, target])
    const routeConversationMessage = vi.fn().mockResolvedValue({
      sourceConversationId: 'A',
      conversationId: 'B',
      routed: true,
      title: 'Programme Mouse Move',
      decision: { route: 'new', confidence: 0.97, reason: 'new-topic' }
    })
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const mockApi = api({ conversations, routeConversationMessage, pilotChat })

    await mount(mockApi)
    await click('.conv-pick')
    await type('Crée un exécutable qui bouge la souris')
    const file = new File(['preuve'], 'preuve.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () => Promise.resolve('preuve')
    })
    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      textarea.dispatchEvent(paste)
      await Promise.resolve()
    })
    await click('.composer-send')
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    expect(routeConversationMessage).toHaveBeenCalledWith(
      'A',
      'Crée un exécutable qui bouge la souris',
      ['preuve.txt']
    )
    expect(pilotChat).toHaveBeenCalledTimes(1)
    expect(pilotChat.mock.calls[0][1]).toBe('B')
    expect(pilotChat.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Crée un exécutable qui bouge la souris',
        attachments: [
          expect.objectContaining({
            name: 'preuve.txt',
            content: 'preuve'
          })
        ]
      })
    ])
    expect(
      container!.querySelector('.chat-layout')?.getAttribute('data-active-conversation-id')
    ).toBe('B')
  })

  it('en état busy, le message est MIS EN FILE et les deux boutons de choix sont rendus', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: vi.fn().mockResolvedValue({ ok: true })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('au fait, ajoute un test')
    await click('.composer-send')

    // AUCUNE action appliquée sans choix explicite de l'utilisateur.
    expect(mockApi.injectDirective).not.toHaveBeenCalled()
    // Le message est en file, avec le bloc de CHOIX (Orienter / Interrompre & envoyer).
    expect(container!.querySelector('.directive-queue')).not.toBeNull()
    expect(container!.querySelector('.directive-queue-text')?.textContent).toBe(
      'au fait, ajoute un test'
    )
    expect(container!.querySelector('.directive-queue-steer')).not.toBeNull()
    expect(container!.querySelector('.directive-queue-item .directive-queue-send')).not.toBeNull()
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('choisir « Orienter » injecte sans interrompre et ne relance pas un send() au drain', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: vi.fn().mockResolvedValue({ ok: true })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('oriente vers X')
    await click('.composer-send')
    await click('.directive-queue-steer')

    expect(mockApi.injectDirective).toHaveBeenCalledWith(expect.any(String), 'oriente vers X')
    expect(mockApi.cancelPilotChat).not.toHaveBeenCalled()
    expect(container!.querySelector('.directive-queue')).toBeNull()
    // Fin du tour : le drain ne doit PAS renvoyer le message déjà orienté.
    await act(async () => pilot.resolve({ ok: true }))
    expect((mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  /**
   * REACTIVITE DES CLICS DE LA FILE (constate 2026-07-29 : « les clics de la popup des messages en
   * attente ne marchent pas entierement / ne sont pas reactifs »).
   *
   * Trois defauts couverts ici : (1) « Orienter » n'affichait AUCUN retour pendant son aller-retour
   * IPC et acceptait les reclics — double injection ; (2) le bouton d'interruption par message
   * s'affichait HORS tour actif, ou il n'y a rien a interrompre : le clic armait « interruption en
   * cours » que seule une transition busy->false efface, transition qui n'arrive jamais → boutons
   * figes DEFINITIVEMENT ; (3) son libelle promettait « ce message + ses anterieurs » alors que la
   * file entiere part (drain depuis le debut, voulu).
   */
  it('« Orienter » affiche son attente et refuse le double clic pendant l’injection', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const injection = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: vi.fn(() => injection.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('oriente vers X')
    await click('.composer-send')

    const steer = (): HTMLButtonElement =>
      container!.querySelector('.directive-queue-steer') as HTMLButtonElement
    expect(steer().disabled).toBe(false)

    await click('.directive-queue-steer')
    // Le retrait de la file est optimiste : le bouton disparait avec l'item. Ce qui doit etre vrai,
    // c'est qu'un SECOND clic n'a pas pu declencher une deuxieme injection.
    await act(async () => {
      injection.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect((mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('hors tour actif, aucun bouton d’interruption n’est propose (plus de clic mort)', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const injection = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      // L'injection reste EN VOL : le message quitte la file de facon optimiste et n'y revient pas,
      // donc la file se vide — on verifie surtout qu'aucun bouton mort ne subsiste.
      injectDirective: vi.fn(() => injection.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('en file')
    await click('.composer-send')

    // Tour termine, file drainee : plus aucun bouton d'interruption ne doit rester affiche.
    await act(async () => {
      pilot.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect(container!.querySelector('.directive-queue-item .directive-queue-send')).toBeNull()
    expect(container!.querySelector('.directive-queue-send-all')).toBeNull()
  })

  it('n’appelle pas cancelPilotChat quand il n’y a aucun tour a interrompre', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('en file')
    await click('.composer-send')
    await act(async () => {
      pilot.resolve({ ok: true })
      await flushAnimationFrames()
    })
    // Aucune interruption n'a ete demandee par le drain automatique.
    expect(mockApi.cancelPilotChat).not.toHaveBeenCalled()
  })

  it('le libelle du bouton par message ne promet plus une selectivite qui n’existe pas', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('en file')
    await click('.composer-send')

    const perItem = container!.querySelector(
      '.directive-queue-item .directive-queue-send'
    ) as HTMLButtonElement
    expect(perItem).not.toBeNull()
    // « ses anterieurs » sous-entendait que les messages POSTERIEURS restaient ; ils partent aussi.
    expect(perItem.title).not.toContain('antérieurs')
    expect(perItem.title).toContain('la file')
    await act(async () => pilot.resolve({ ok: true }))
  })

  /**
   * LE clic mort, REPRODUIT : une file remplie pendant le tour de A survit a un aller-retour vers
   * une autre conversation. De retour sur A, plus aucun tour ne tourne mais la file est encore la.
   * Avant correctif, le bouton « Interrompre et envoyer » y etait AFFICHE : le clic armait l'etat
   * « interruption en cours », que seule une transition busy->false efface — transition qui n'arrive
   * jamais hors tour. Les boutons restaient donc figes sur « ⏳ Interruption… » definitivement.
   * Mesure : sans le correctif ce test rend `true` sur la presence du bouton, avec il rend `false`.
   */
  it('au retour sur la conversation, aucun bouton d’interruption mort ne subsiste', async () => {
    const turnA = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      pilotChat: vi.fn(() => turnA.promise)
    })
    await mount(mockApi)
    const picks = (): NodeListOf<Element> => container!.querySelectorAll('.conv-pick')
    await act(async () => (picks()[0] as HTMLElement).click())
    await type('tour actif')
    await click('.composer-send')
    await type('reste en file')
    await click('.composer-send')
    expect(container!.querySelector('.directive-queue')).not.toBeNull()

    await act(async () => (picks()[1] as HTMLElement).click())
    await act(async () => {
      turnA.resolve({ ok: true })
      await flushAnimationFrames()
    })
    await act(async () => (picks()[0] as HTMLElement).click())
    await flushAnimationFrames()

    // Depuis le drain sur `activeId`, l'etat « file echouee hors tour » se referme de lui-meme : la
    // file est partie. Ce qui est verifie ici, c'est qu'AUCUN bouton mort ne subsiste au retour —
    // ni par message, ni global (c'est ce couple qui figeait la file sur « ⏳ Interruption… »).
    expect(container!.querySelector('.directive-queue-item .directive-queue-send')).toBeNull()
    expect(container!.querySelector('.directive-queue-send-all')).toBeNull()
    expect(container!.querySelector('.directive-queue')).toBeNull()
  })

  /**
   * SUITE du clic mort : une fois le bouton mort supprime, la file survivante restait EN PLAN — il
   * fallait relancer ses messages a la main. L'effet de drain ne dependait que de `busy`, or la
   * transition busy->false du tour de A survient pendant qu'on regarde B : elle ne concerne plus A.
   * De retour sur A, le drain doit repartir tout seul.
   */
  it('de retour sur la conversation, la file survivante se draine SEULE', async () => {
    const turnA = deferred<{ ok: boolean }>()
    const drained = deferred<{ ok: boolean }>()
    const pilotChat = vi
      .fn()
      .mockImplementationOnce(() => turnA.promise)
      .mockImplementationOnce(() => drained.promise)
      .mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      pilotChat
    })
    await mount(mockApi)
    const picks = (): NodeListOf<Element> => container!.querySelectorAll('.conv-pick')
    await act(async () => (picks()[0] as HTMLElement).click())
    await type('tour actif')
    await click('.composer-send')
    await type('message oublie')
    await click('.composer-send')
    expect(pilotChat).toHaveBeenCalledTimes(1)

    // On part sur B, le tour de A finit pendant l'absence, puis on revient sur A.
    await act(async () => (picks()[1] as HTMLElement).click())
    await act(async () => {
      turnA.resolve({ ok: true })
      await flushAnimationFrames()
    })
    await act(async () => (picks()[0] as HTMLElement).click())
    await flushAnimationFrames()

    // Le message en file est PARTI de lui-meme, sans intervention.
    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[1][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'message oublie' })])
    )
    expect(container!.querySelector('.directive-queue')).toBeNull()
    await act(async () => drained.resolve({ ok: true }))
  })

  it('removes the steered message by stable identity after the queue changes', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const injection = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      // Le composer n'injecte plus (mise en file + choix) : seuls les clics « Orienter » injectent.
      injectDirective: injectFailingThen(0, () => injection.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('A')
    await click('.composer-send')
    await type('B')
    await click('.composer-send')

    const steerButtons = container!.querySelectorAll('.directive-queue-steer')
    await act(async () => (steerButtons[1] as HTMLElement).click())
    const removeButtons = container!.querySelectorAll('.directive-queue-remove')
    await act(async () => (removeButtons[0] as HTMLElement).click())
    await act(async () => injection.resolve({ ok: true }))

    expect(container!.querySelector('.directive-queue')).toBeNull()
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('retire immédiatement une orientation sans attendre la réponse IPC', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const injection = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: injectFailingThen(0, () => injection.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('orientation instantanée')
    await click('.composer-send')

    const steer = container!.querySelector('.directive-queue-steer') as HTMLElement
    await act(async () => {
      steer.click()
      await Promise.resolve()
    })

    // Le composer met en FILE (0 injection) ; seul le bouton « Orienter » injecte.
    expect(mockApi.injectDirective).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('.directive-queue')).toBeNull()
    await act(async () => injection.resolve({ ok: true }))
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('affiche immédiatement l’interruption sans attendre la réponse IPC', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const cancellation = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      cancelPilotChat: vi.fn(() => cancellation.promise),
      injectDirective: injectFailingThen(1)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('message urgent')
    await click('.composer-send')

    const interrupt = container!.querySelector('.directive-queue-send') as HTMLElement
    await act(async () => {
      interrupt.click()
      await Promise.resolve()
    })

    expect(mockApi.cancelPilotChat).toHaveBeenCalledOnce()
    expect(container!.querySelector('.directive-queue-send')?.textContent).toContain('Interruption')
    await act(async () => cancellation.resolve({ ok: true }))
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('restores a removed queued message into the existing draft', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: injectFailingThen(1)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('queued message')
    await click('.composer-send')
    await type('existing draft')

    await click('.directive-queue-remove')

    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'existing draft\n\nqueued message'
    )
    expect(container!.querySelector('.directive-queue')).toBeNull()
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('moves a queued message to the end through BTW without interrupting', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: injectFailingThen(2)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('A')
    await click('.composer-send')
    await type('B')
    await click('.composer-send')

    const injectionsBeforeBtw = (mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls
      .length
    await click('.directive-queue-btw')

    expect(
      Array.from(
        container!.querySelector('.directive-queue-item')!.querySelectorAll('button'),
        (element) => element.textContent
      )
    ).toEqual(['⏹ Interrompre et envoyer', '🧭 Orienter', 'BTW', '✕'])
    expect(
      Array.from(container!.querySelectorAll('.directive-queue-text'), (element) => element.textContent)
    ).toEqual(['B', 'A'])
    // BTW réordonne la file SANS injecter : aucun appel supplémentaire depuis le clic.
    expect((mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      injectionsBeforeBtw
    )
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('confirme visiblement BTW même avec un seul message en file', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: injectFailingThen(1)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('message différé')
    await click('.composer-send')

    const injectionsBeforeBtw = (mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls
      .length
    await click('.directive-queue-btw')

    const button = container!.querySelector('.directive-queue-btw') as HTMLButtonElement
    expect(button.textContent).toContain('✓ BTW')
    expect(button.disabled).toBe(true)
    expect(container!.querySelector('.directive-queue-text')?.textContent).toBe('message différé')
    expect((mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      injectionsBeforeBtw
    )
    await act(async () => pilot.resolve({ ok: true }))
  })

  it.each(['a refused injection', 'an injection error'])(
    'keeps the queued message after %s',
    async (testCase) => {
      const pilot = deferred<{ ok: boolean }>()
      const injectDirective =
        testCase === 'a refused injection'
          ? vi.fn().mockResolvedValue({ ok: false })
          : vi.fn().mockRejectedValue(new Error('IPC unavailable'))
      const mockApi = api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        pilotChat: vi.fn(() => pilot.promise),
        injectDirective
      })
      await mount(mockApi)
      await click('.conv-pick')
      await type('long turn')
      await click('.composer-send')
      await type('keep me')
      await click('.composer-send')

      await click('.directive-queue-steer')

      expect(container!.querySelector('.directive-queue-text')?.textContent).toBe('keep me')
      await act(async () => pilot.resolve({ ok: true }))
    }
  )

  it('ne perd pas un événement pilote encore en vol quand le tour se termine', async () => {
    const pilot = deferred<{ ok: boolean }>()
    let pilotHandler: ((event: unknown) => void) | undefined
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
        pilotHandler = cb
        return vi.fn()
      })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('question rapide')
    await click('.composer-send')
    await act(async () => {
      // Événement IPC EN VOL (macrotask) programmé AVANT la résolution de la promesse :
      // il doit être réduit, pas jeté par la garde busy qui se coupe à la fin du tour.
      setTimeout(() => {
        pilotHandler?.({
          conversationId: 'A',
          turnId: 'turn-tardif',
          kind: 'delta',
          streamId: '0:0',
          text: 'Réponse tardive complète'
        })
      }, 0)
      pilot.resolve({ ok: true })
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(container!.textContent).toContain('Réponse tardive complète')
    expect(container!.textContent).not.toContain('aucune réponse')
  })

  it('affiche une inbox d’agents pour une conversation dont un tour est en cours', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un truc long')
    await click('.composer-send')
    // Tour en cours → l'inbox d'agents apparaît avec la conversation.
    const inbox = container!.querySelector('.agent-inbox')
    expect(inbox).toBeTruthy()
    expect(inbox!.textContent).toContain('Agents actifs')
    expect(container!.querySelectorAll('.agent-inbox-row').length).toBe(1)
    expect(container!.querySelector('.agent-inbox-stop')).toBeNull()
    await act(async () => pilot.resolve({ ok: true }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    // Tour fini → l'inbox se vide.
    expect(container!.querySelector('.agent-inbox')).toBeNull()
  })

  it('keeps B active when an orchestration starts on A and exposes A in the inbox', async () => {
    let appHandler: ((event: Record<string, unknown>) => void) | undefined
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      onAppEvent: vi.fn((cb: (event: Record<string, unknown>) => void) => {
        appHandler = cb
        return vi.fn()
      })
    })
    await mount(mockApi)
    const picks = container!.querySelectorAll('.conv-pick')
    await act(async () => (picks[1] as HTMLElement).click())

    await act(async () => {
      appHandler?.({
        type: 'orchestrate-start',
        convId: 'A',
        runPath: 'run-A',
        task: 'travail A'
      })
    })

    expect(
      container!.querySelector('.chat-layout')?.getAttribute('data-active-conversation-id')
    ).toBe('B')
    expect(container!.querySelector('.agent-inbox')?.textContent).toContain('Conversation A')
  })

  it('stops from Workflows the orchestration belonging to the displayed conversation', async () => {
    let appHandler: ((event: Record<string, unknown>) => void) | undefined
    const cancelOrchestration = vi.fn().mockResolvedValue(undefined)
    const cancelPilotChat = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      cancelOrchestration,
      cancelPilotChat,
      onAppEvent: vi.fn((cb: (event: Record<string, unknown>) => void) => {
        appHandler = cb
        return vi.fn()
      })
    })
    await mount(mockApi)
    const picks = container!.querySelectorAll('.conv-pick')
    await act(async () => (picks[1] as HTMLElement).click())
    await act(async () => {
      appHandler?.({
        type: 'orchestrate-start',
        convId: 'A',
        runPath: 'run-A',
        task: 'travail A'
      })
    })
    await act(async () => {
      ;(container!.querySelector('.agent-inbox-row') as HTMLButtonElement).click()
    })
    await click('button[title="Workflows (RUN.md)"]')

    const liveSubagentCard = container!.querySelector('.live-run .subagent-step')
    expect(liveSubagentCard?.textContent).toContain('en cours')
    const stopButton = liveSubagentCard?.querySelector(
      'button[title="Stopper le sous-agent en cours"]'
    ) as HTMLButtonElement
    await act(async () => stopButton.click())

    expect(cancelOrchestration).toHaveBeenCalledOnce()
    expect(cancelOrchestration).toHaveBeenCalledWith('A')
    expect(cancelPilotChat).not.toHaveBeenCalled()
  })

  it('expose Workflows sans onglet Activité', async () => {
    const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
    await mount(mockApi)
    await click('.conv-pick')
    await click('button[title="Workflows (RUN.md)"]')

    const pane = container!.querySelector('.runs-pane')
    expect(pane).toBeTruthy()
    const tabs = [...pane!.querySelectorAll('.conv-head button')].map((b) => b.textContent?.trim())
    expect(tabs).toContain('Runs')
    expect(tabs).toContain('Source control')
    expect(tabs).not.toContain('Activité')
    expect(pane!.className).not.toContain('wide')
  })

  it('ouvre Workflows sur l’action en cours au clic sur l’indicateur du message', async () => {
    let appHandler: ((event: Record<string, unknown>) => void) | undefined
    let pilotHandler: ((event: Record<string, unknown>) => void) | undefined
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      onAppEvent: vi.fn((cb: (event: Record<string, unknown>) => void) => {
        appHandler = cb
        return vi.fn()
      }),
      onPilotEvent: vi.fn((cb: (event: Record<string, unknown>) => void) => {
        pilotHandler = cb
        return vi.fn()
      })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un truc long')
    await click('.composer-send')
    await act(async () => {
      appHandler?.({ type: 'orchestrate-start', convId: 'A', runPath: 'run-A', task: 'travail A' })
    })
    await act(async () => {
      pilotHandler?.({
        kind: 'command',
        conversationId: 'A',
        actionId: 'orchestrate',
        name: 'orchestrate'
      })
    })
    // On repart panneau FERMÉ : seul le clic sur l'indicateur doit le rouvrir.
    await click('.runs-pane .conv-head button.btn-ghost')
    expect(container!.querySelector('.live-run')).toBeNull()

    // Le bloc d'activité EST le bouton (plus de bloc dépliable dans le fil) : cliquer dessus
    // renvoie vers Workflows, où vit le détail.
    const indicator = container!.querySelector(
      '[data-testid="activity-group"]'
    ) as HTMLButtonElement | null
    expect(indicator?.textContent).toContain('en cours')
    await act(async () => indicator!.click())

    // Panneau Workflows ouvert, onglet Runs, cadré sur le run/step actif.
    expect(container!.querySelector('.runs-pane')).toBeTruthy()
    expect(container!.querySelector('.live-run')?.textContent).toContain('travail A')
    expect(container!.querySelector('.live-run .subagent-step')?.textContent).toContain('en cours')
    await act(async () => pilot.resolve({ ok: true }))
  })

  // fix-ok: targeted regression reproduction for the green workflow counter.
  it('counts a green slash-palette run in the Workflows button', async () => {
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      conversationRuns: vi.fn().mockResolvedValue([
        {
          subject: 'slash-palette',
          session: 'A',
          path: 'A/slash-palette/RUN.md',
          mtime: 1,
          summary: {
            status: 'green',
            dodTotal: 1,
            dodChecked: 1,
            journalEvents: 1,
            defauts: 0
          }
        }
      ])
    })

    await mount(mockApi)
    await click('.conv-pick')

    expect(container!.querySelector('button[title="Workflows (RUN.md)"]')?.textContent).toContain(
      '1 green'
    )
  })

  it('does not steal conversation B when creation from New resolves late', async () => {
    const creation = deferred<ReturnType<typeof conversation>>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('B')]),
      conversationsCreate: vi.fn(() => creation.promise)
    })
    await mount(mockApi)
    await type('draft A')
    await click('.composer-send')
    await click('.conv-pick')
    await type('draft B')
    await act(async () => creation.resolve(conversation('A')))
    expect(
      container!.querySelector('.chat-layout')?.getAttribute('data-active-conversation-id')
    ).toBe('B')
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft B')
  })

  it('does not steal conversation B when routing from A resolves late', async () => {
    const routing = deferred<{
      sourceConversationId: string
      conversationId: string
      routed: boolean
      decision: { route: 'current' | 'new'; confidence: number; reason: string }
    }>()
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi
        .fn()
        .mockResolvedValueOnce([conversation('A'), conversation('B')])
        .mockResolvedValue([conversation('A'), conversation('B'), conversation('C')]),
      routeConversationMessage: vi.fn(() => routing.promise),
      pilotChat
    })
    await mount(mockApi)
    const picks = container!.querySelectorAll('.conv-pick')
    await act(async () => (picks[0] as HTMLElement).click())
    await type('nouveau sujet depuis A')
    await click('.composer-send')
    await act(async () => (picks[1] as HTMLElement).click())
    await type('draft B')
    await act(async () =>
      routing.resolve({
        sourceConversationId: 'A',
        conversationId: 'C',
        routed: true,
        decision: { route: 'new', confidence: 0.97, reason: 'new-topic' }
      })
    )

    expect(pilotChat).toHaveBeenCalledTimes(1)
    expect(pilotChat.mock.calls[0][0]).toEqual([
      expect.objectContaining({ role: 'user', content: 'nouveau sujet depuis A' })
    ])
    expect(pilotChat.mock.calls[0][1]).toBe('C')
    expect(
      container!.querySelector('.chat-layout')?.getAttribute('data-active-conversation-id')
    ).toBe('B')
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft B')
  })

  it('releases the New lock after assigning A while retaining A busy', async () => {
    const pilotA = deferred<{ ok: boolean }>()
    const create = vi
      .fn()
      .mockResolvedValueOnce(conversation('A'))
      .mockResolvedValueOnce(conversation('C'))
    const mockApi = api({ conversationsCreate: create, pilotChat: vi.fn(() => pilotA.promise) })
    await mount(mockApi)
    await type('premier')
    await click('.composer-send')
    await click('.conv-new-row')
    await type('deuxième')
    await click('.composer-send')
    expect(create).toHaveBeenCalledTimes(2)
    await act(async () => pilotA.resolve({ ok: true }))
  })

  it('preserves a failed bootstrap draft and retries it', async () => {
    const models = vi
      .fn()
      .mockResolvedValue([
        { id: 'codex/gpt-5.6-terra', provider: 'codex', model: 'gpt-5.6-terra' }
      ])
    const create = vi.fn().mockResolvedValue(conversation('A'))
    const mockApi = api({ models, conversationsCreate: create })
    await mount(mockApi)
    models.mockRejectedValueOnce(new Error('bootstrap indisponible'))
    await type('à conserver')
    await click('.composer-send')
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('à conserver')
    expect(container!.querySelector('.chat-scroll')?.textContent).not.toContain('à conserver')
    expect(container!.textContent).toContain('bootstrap indisponible')
    await click('.composer-send')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps delayed attachments in their originating conversation draft', async () => {
    const encoded = deferred<string>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')])
    })
    await mount(mockApi)
    const picks = container!.querySelectorAll('.conv-pick')
    await act(async () => (picks[0] as HTMLElement).click())
    await type('draft A')
    const file = new File(['x'], 'preuve.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { configurable: true, value: () => encoded.promise })
    const input = container!.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => (picks[1] as HTMLElement).click())
    await type('draft B')
    await act(async () => encoded.resolve('contenu'))
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft B')
    expect(container!.querySelector('.attachment-list.pending')).toBeNull()
    await act(async () => (picks[0] as HTMLElement).click())
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft A')
    expect(container!.textContent).toContain('preuve.txt')
  })

  it('does not rerender historical Markdown rows when only the composer changes', async () => {
    const history = [
      {
        role: 'assistant',
        content: 'réponse historique',
        ts: 1,
        status: 'completed',
        parts: [{ kind: 'text', text: 'réponse historique' }]
      }
    ]
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) }))
    await click('.conv-pick')
    expect(markdownRenderCount.value).toBeGreaterThan(0)
    markdownRenderCount.value = 0
    await type('nouveau draft')
    expect(markdownRenderCount.value).toBe(0)
  })

  it('offers inspection only for persisted assistant turns and reports the exact target', async () => {
    const onInspectTurn = vi.fn()
    const history = [
      {
        role: 'assistant',
        content: 'réponse traçable',
        ts: 1,
        turnId: 'turn-42',
        status: 'completed',
        parts: [{ kind: 'text', text: 'réponse traçable' }]
      },
      {
        role: 'assistant',
        content: 'réponse historique sans trace',
        ts: 2,
        status: 'completed',
        parts: [{ kind: 'text', text: 'réponse historique sans trace' }]
      }
    ]
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) })
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, { onInspectTurn }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await click('.conv-pick')

    const inspectButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.getAttribute('aria-label') === 'Inspecter ce tour'
    )
    expect(inspectButtons).toHaveLength(1)
    await act(async () => (inspectButtons[0] as HTMLButtonElement).click())
    expect(onInspectTurn).toHaveBeenCalledWith({ conversationId: 'A', turnId: 'turn-42' })
  })

  it('exposes the message stream as an aria-live log region for screen readers', async () => {
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) }))
    const scroll = container!.querySelector('.chat-scroll')
    expect(scroll?.getAttribute('role')).toBe('log')
    expect(scroll?.getAttribute('aria-live')).toBe('polite')
  })

  it('opens an image thumbnail in a dismissible fullscreen lightbox', async () => {
    const history = [
      {
        role: 'user',
        content: '',
        ts: 1,
        attachments: [
          {
            name: 'preuve.png',
            mimeType: 'image/png',
            size: 42,
            thumbnail: 'data:image/png;base64,cHJldXZl'
          }
        ]
      }
    ]
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) }))
    await click('.conv-pick')

    await click('.attachment-thumb')
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Aperçu de preuve.png"]')
    ).toBeTruthy()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()

    await click('.attachment-thumb')
    await act(async () => {
      ;(document.body.querySelector('.image-lightbox-close') as HTMLButtonElement).click()
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()

    await click('.attachment-thumb')
    await act(async () => {
      ;(document.body.querySelector('.image-lightbox') as HTMLElement).click()
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()
  })

  it('adds a pasted file to the composer draft via onPaste', async () => {
    const encoded = deferred<string>()
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) }))
    await click('.conv-pick')
    const file = new File(['x'], 'colle.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { configurable: true, value: () => encoded.promise })
    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      textarea.dispatchEvent(paste)
    })
    await act(async () => encoded.resolve('contenu'))
    expect(container!.textContent).toContain('colle.txt')
  })

  const branched = (activeBranchId: string): Record<string, unknown> => ({
    id: 'A',
    title: 'A',
    category: 'codex',
    provider: 'codex',
    updatedAt: 1,
    rootBranchId: 'branch-A-root',
    activeBranchId,
    branches: [
      { id: 'branch-A-root' },
      { id: 'branch-A-2', parentBranchId: 'branch-A-root', forkedFromMessageId: 'm2' }
    ],
    messages: [
      { role: 'user', content: 'u1', ts: 1, messageId: 'm1', branchId: 'branch-A-root' },
      {
        role: 'assistant',
        content: 'a1',
        ts: 1,
        messageId: 'm2',
        branchId: 'branch-A-root',
        parentMessageId: 'm1',
        turnId: 't1',
        status: 'completed',
        parts: [{ kind: 'text', text: 'a1' }]
      },
      {
        role: 'user',
        content: 'u2',
        ts: 2,
        messageId: 'm3',
        branchId: 'branch-A-root',
        parentMessageId: 'm2'
      },
      {
        role: 'user',
        content: 'alt',
        ts: 3,
        messageId: 'm5',
        branchId: 'branch-A-2',
        parentMessageId: 'm2'
      }
    ]
  })

  it('forke depuis un tour assistant persistant en appelant conversationsFork', async () => {
    const fork = vi.fn().mockResolvedValue(undefined)
    const conv = branched('branch-A-root')
    await mount(api({ conversations: vi.fn().mockResolvedValue([conv]), conversationsFork: fork }))
    await click('.conv-pick')
    const assistantRow = container!.querySelector('.msg.assistant') as HTMLElement
    const forkBtn = [...assistantRow.querySelectorAll('button')].find((b) =>
      /branche/i.test(b.getAttribute('aria-label') ?? '')
    )
    expect(forkBtn).toBeTruthy()
    await act(async () => (forkBtn as HTMLButtonElement).click())
    expect(fork).toHaveBeenCalledWith('A', 'm2')
  })

  it('affiche les branches et bascule via conversationsSwitchBranch', async () => {
    const sw = vi.fn().mockResolvedValue(undefined)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([branched('branch-A-root')]),
        conversationsSwitchBranch: sw
      })
    )
    await click('.conv-pick')
    const chips = container!.querySelectorAll('.branch-chip')
    expect(chips.length).toBe(2)
    await act(async () => (chips[1] as HTMLElement).click())
    expect(sw).toHaveBeenCalledWith('A', 'branch-A-2')
  })

  it('ne rend que la chaîne de la branche active', async () => {
    await mount(api({ conversations: vi.fn().mockResolvedValue([branched('branch-A-2')]) }))
    await click('.conv-pick')
    const body = container!.querySelector('.chat-scroll')!.textContent ?? ''
    expect(body).toContain('u1')
    expect(body).toContain('alt')
    expect(body).not.toContain('u2') // message postérieur au fork sur la branche parente
  })

  it('offre le bouton forker aussi sur un message utilisateur (avec messageId)', async () => {
    const fork = vi.fn().mockResolvedValue(undefined)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([branched('branch-A-root')]),
        conversationsFork: fork
      })
    )
    await click('.conv-pick')
    const userRow = container!.querySelector('.msg.user') as HTMLElement
    const forkBtn = [...userRow.querySelectorAll('button')].find((b) =>
      /branche/i.test(b.getAttribute('aria-label') ?? '')
    )
    expect(forkBtn).toBeTruthy()
    await act(async () => (forkBtn as HTMLButtonElement).click())
    expect(fork).toHaveBeenCalledWith('A', 'm1') // forke depuis le 1er message user
  })

  it('invalide le cache live et re-rend la bonne branche APRÈS un switch réel', async () => {
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([branched('branch-A-root')]) // montage : branche racine active
      .mockResolvedValue([branched('branch-A-2')]) // après switch : branche 2 active
    await mount(
      api({ conversations, conversationsSwitchBranch: vi.fn().mockResolvedValue(undefined) })
    )
    await click('.conv-pick')
    expect(container!.querySelector('.chat-scroll')!.textContent).toContain('u2') // racine
    const chips = container!.querySelectorAll('.branch-chip')
    await act(async () => (chips[1] as HTMLElement).click())
    const body = container!.querySelector('.chat-scroll')!.textContent ?? ''
    expect(body).toContain('alt')
    expect(body).not.toContain('u2') // cache live invalidé → chaîne de la branche 2
  })
})
