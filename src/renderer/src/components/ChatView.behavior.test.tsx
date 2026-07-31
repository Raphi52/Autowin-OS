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
    deleteConversationRun: vi.fn().mockResolvedValue({ ok: true, kind: 'deleted' }),
    deleteRun: vi.fn().mockResolvedValue({ ok: true }),
    runTrace: vi.fn().mockResolvedValue(null),
    readNodeFile: vi.fn(async (path: string) => ({ path, content: 'status: green' })),
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
    vi.unstubAllGlobals()
  })

  async function mount(
    mockApi: Record<string, unknown>,
    props: Record<string, unknown> = {}
  ): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, props))
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
    const source = conversation('A', [{ role: 'user', content: 'Refais le graphe Git', ts: 1 }])
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

  it('affiche dans le fil le message orienté avec son état sending puis sent', async () => {
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
    await type('garde cette contrainte')
    await click('.composer-send')
    await click('.directive-queue-steer')

    const receipt = container!.querySelector('.directive-receipt')
    expect(receipt?.querySelector('.msg-body')?.textContent).toBe('garde cette contrainte')
    expect(receipt?.querySelector('.directive-receipt-status')?.textContent).toContain(
      'Orientation'
    )

    await act(async () => {
      injection.resolve({ ok: true })
      await Promise.resolve()
    })
    expect(
      container!.querySelector('.directive-receipt .directive-receipt-status')?.textContent
    ).toContain('Orienté')

    await act(async () => pilot.resolve({ ok: true }))
  })

  it('ramène immédiatement dans le viewport le reçu orienté quand le fil était remonté', async () => {
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
    await type('rends ceci visible')
    await click('.composer-send')

    const scroll = container!.querySelector('.chat-scroll') as HTMLDivElement
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    })
    const scrollTo = vi.fn()
    scroll.scrollTo = scrollTo
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))

    await click('.directive-queue-steer')
    await act(async () => flushAnimationFrames())

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
    await act(async () => injection.resolve({ ok: true }))
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('conserve tous les reçus orientés de la session sans évincer les plus anciens', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: vi.fn().mockResolvedValue({ ok: true })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')

    for (let index = 0; index < 21; index += 1) {
      await type(`directive-${index}`)
      await click('.composer-send')
      await click('.directive-queue-steer')
    }

    const receipts = container!.querySelectorAll('.directive-receipt')
    expect(receipts).toHaveLength(21)
    expect(receipts[0].querySelector('.msg-body')?.textContent).toBe('directive-0')
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('place le reçu entre la réponse déjà vue et la continuation qui suit l’orientation', async () => {
    const pilot = deferred<{ ok: boolean }>()
    let pilotHandler: ((event: unknown) => void) | undefined
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: vi.fn().mockResolvedValue({ ok: true }),
      onPilotEvent: vi.fn((callback: (event: unknown) => void) => {
        pilotHandler = callback
        return vi.fn()
      })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await act(async () =>
      pilotHandler?.({
        conversationId: 'A',
        turnId: 'turn-chronologie',
        kind: 'delta',
        streamId: '0:0',
        text: 'avant-orientation'
      })
    )
    await type('contrainte chronologique')
    await click('.composer-send')
    await click('.directive-queue-steer')
    await act(async () =>
      pilotHandler?.({
        conversationId: 'A',
        turnId: 'turn-chronologie',
        kind: 'delta',
        streamId: '0:0',
        text: ' après-orientation'
      })
    )

    const receipt = container!.querySelector('.directive-receipt') as HTMLElement
    const bodies = [...container!.querySelectorAll<HTMLElement>('.msg.assistant .msg-body')]
    const before = bodies.find((body) => body.textContent?.includes('avant-orientation'))!
    const after = bodies.find((body) => body.textContent?.includes('après-orientation'))!
    expect(before).not.toBe(after)
    expect(before.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(receipt.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    expect(mockApi.cancelPilotChat).not.toHaveBeenCalled()
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('garde le reçu avant le flux de remplacement après un stream-reset', async () => {
    const pilot = deferred<{ ok: boolean }>()
    let pilotHandler: ((event: unknown) => void) | undefined
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: vi.fn().mockResolvedValue({ ok: true }),
      onPilotEvent: vi.fn((callback: (event: unknown) => void) => {
        pilotHandler = callback
        return vi.fn()
      })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await act(async () =>
      pilotHandler?.({
        conversationId: 'A',
        turnId: 'turn-reset',
        kind: 'delta',
        streamId: 'ancien-flux',
        text: 'réponse obsolète'
      })
    )
    await type('nouvelle contrainte')
    await click('.composer-send')
    await click('.directive-queue-steer')
    await act(async () => {
      pilotHandler?.({
        conversationId: 'A',
        turnId: 'turn-reset',
        kind: 'stream-reset',
        streamId: 'ancien-flux'
      })
      pilotHandler?.({
        conversationId: 'A',
        turnId: 'turn-reset',
        kind: 'delta',
        streamId: 'nouveau-flux',
        text: 'réponse recalculée'
      })
    })

    const receipt = container!.querySelector('.directive-receipt') as HTMLElement
    const replacement = [
      ...container!.querySelectorAll<HTMLElement>('.msg.assistant .msg-body')
    ].find((body) => !body.closest('.directive-receipt') && body.textContent?.includes('réponse'))!
    expect(container!.textContent).not.toContain('réponse obsolète')
    expect(
      receipt.compareDocumentPosition(replacement) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    expect(mockApi.cancelPilotChat).not.toHaveBeenCalled()
    await act(async () => pilot.resolve({ ok: true }))
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
  // Renomme : « affiche son attente » n'etait pas verifiable (le retrait de la file est optimiste, le
  // bouton part avec l'item) et aucun second clic n'etait emis. Ce test emet desormais le double clic.
  it('un double clic sur « Orienter » n’injecte la directive qu’une seule fois', async () => {
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

    const steer = container!.querySelector('.directive-queue-steer') as HTMLButtonElement
    expect(steer.disabled).toBe(false)

    // VRAI double clic : les deux clics partent dans le MEME act, donc sur le bouton encore monte et
    // avant tout re-rendu — c'est le seul moment ou l'utilisateur peut recliquer. Le second doit etre
    // absorbe (l'item a deja quitte la file de facon synchrone), sinon la directive part deux fois.
    await act(async () => {
      steer.click()
      steer.click()
    })
    await act(async () => {
      injection.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect((mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    await act(async () => pilot.resolve({ ok: true }))
  })

  /**
   * ETAT « file survivante HORS TOUR », reproduit pour de vrai (l'ancienne version de ce test se
   * contentait d'une file VIDE par auto-drain : le selecteur rendait null par ABSENCE D'ITEM, pas
   * grace a la garde `busy` — il passait a l'identique sans le correctif).
   * Mise en scene : l'orientation retire l'item de facon OPTIMISTE, le tour se termine (l'auto-drain
   * ne voit donc RIEN a drainer), PUIS l'injection echoue et REMET le message en file. On est alors
   * hors tour avec un item PRESENT : exactement l'etat ou le bouton d'interruption etait un clic mort
   * (il armait « interruption en cours », que seule une transition busy->false efface).
   */
  async function survivingQueueOutOfTurn(): Promise<Record<string, unknown>> {
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
    await type('en file')
    await click('.composer-send')
    await click('.directive-queue-steer')
    await act(async () => {
      pilot.resolve({ ok: true })
      await flushAnimationFrames()
    })
    await act(async () => {
      injection.reject(new Error('injection indisponible'))
      await flushAnimationFrames()
    })
    // L'item est BIEN LA, hors tour : le reste des assertions porte donc sur un rendu non vide.
    expect(container!.querySelector('.directive-queue-text')?.textContent).toBe('en file')
    return mockApi
  }

  it('hors tour actif, un message TOUJOURS EN FILE n’expose aucun bouton d’interruption', async () => {
    await survivingQueueOutOfTurn()
    expect(container!.querySelector('.directive-queue-item .directive-queue-send')).toBeNull()
    expect(container!.querySelector('.directive-queue-send-all')).toBeNull()
    // Meme raison pour « Orienter » et « BTW » : hors tour il n'y a rien a orienter ni a differer.
    expect(container!.querySelector('.directive-queue-steer')).toBeNull()
    expect(container!.querySelector('.directive-queue-btw')).toBeNull()
  })

  /**
   * Renomme : l'ancien titre (« n'appelle pas cancelPilotChat quand il n'y a rien a interrompre »)
   * mentait — AUCUN bouton n'etait clique, l'appel ne pouvait pas avoir lieu, vrai avant comme apres
   * le correctif. Ce qui est reellement verifiable, et vaut la peine : (a) l'auto-drain n'interrompt
   * jamais le tour, (b) hors tour, les SEULS boutons encore offerts sur un item survivant ne
   * declenchent aucune interruption. La garde interne de `interruptAndFlushQueue`
   * (`busyConversationsRef`) n'est PAS atteignable depuis l'UI tant que la garde de rendu tient :
   * les deux lisent la meme source. Elle reste une ceinture, non couverte par ce test.
   */
  it('ni le drain automatique ni les boutons restants hors tour n’interrompent un tour', async () => {
    const mockApi = await survivingQueueOutOfTurn()
    const buttons = [
      ...container!.querySelectorAll<HTMLButtonElement>('.directive-queue-item button')
    ]
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) await act(async () => button.click())
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
   * UNE FILE QUI REAPPARAIT PENDANT L'ABSENCE. Cas le plus vicieux : l'orientation retire l'item de
   * facon optimiste, on part sur B, le tour de A finit LA-BAS (sa transition busy->false ne concerne
   * plus A), puis l'injection echoue et REMET le message dans la file de A — une file desormais
   * remplie alors qu'aucun tour ne tourne et qu'on ne regarde meme pas A.
   * Au retour sur A, deux choses doivent etre vraies ensemble : le drain repart TOUT SEUL (c'est la
   * dependance `activeId` de l'effet), et aucun bouton mort ne subsiste (garde `busy` au rendu).
   * L'ancienne version remplissait la file par le composer : depuis le drain sur `activeId`, la file
   * etait deja vidée au retour et les assertions portaient sur une file INEXISTANTE.
   */
  it('une file qui reapparait pendant l’absence repart seule au retour, sans bouton mort', async () => {
    const turnA = deferred<{ ok: boolean }>()
    const drained = deferred<{ ok: boolean }>()
    const injection = deferred<{ ok: boolean }>()
    const pilotChat = vi
      .fn()
      .mockImplementationOnce(() => turnA.promise)
      .mockImplementationOnce(() => drained.promise)
      .mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      pilotChat,
      injectDirective: vi.fn(() => injection.promise)
    })
    await mount(mockApi)
    const picks = (): NodeListOf<Element> => container!.querySelectorAll('.conv-pick')
    await act(async () => (picks()[0] as HTMLElement).click())
    await type('tour actif')
    await click('.composer-send')
    await type('reste en file')
    await click('.composer-send')
    await click('.directive-queue-steer')
    expect(container!.querySelector('.directive-queue')).toBeNull() // retrait optimiste

    await act(async () => (picks()[1] as HTMLElement).click())
    await act(async () => {
      turnA.resolve({ ok: true })
      await flushAnimationFrames()
    })
    // L'injection echoue LOIN de A : le message revient dans une file hors tour, invisible.
    await act(async () => {
      injection.reject(new Error('injection indisponible'))
      await flushAnimationFrames()
    })
    await act(async () => (picks()[0] as HTMLElement).click())
    await act(async () => flushAnimationFrames())

    // Le drain est reparti de lui-meme (dependance `activeId`)…
    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[1][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'reste en file' })])
    )
    // …et il ne reste aucun bouton mort (c'est ce couple qui figeait la file sur « ⏳ Interruption… »).
    expect(container!.querySelector('.directive-queue')).toBeNull()
    expect(container!.querySelector('.directive-queue-item .directive-queue-send')).toBeNull()
    expect(container!.querySelector('.directive-queue-send-all')).toBeNull()
    await act(async () => drained.resolve({ ok: true }))
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

  /**
   * PERTE DE DONNEES trouvee par l'audit adverse du 2026-07-29 : le drain appelait `send()`, qui
   * consomme le brouillon du composer — texte ET pieces jointes — puis le VIDE. Un utilisateur qui
   * tapait un message suivant pendant qu'un tour tournait le voyait disparaitre a la fin du tour, sans
   * l'avoir envoye, et ses pieces jointes en attente partaient accrochees au message de la FILE.
   */
  it('le drain n’EFFACE PAS le brouillon en cours de frappe', async () => {
    const turn = deferred<{ ok: boolean }>()
    const drained = deferred<{ ok: boolean }>()
    const pilotChat = vi
      .fn()
      .mockImplementationOnce(() => turn.promise)
      .mockImplementationOnce(() => drained.promise)
      .mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('message en file')
    await click('.composer-send')

    // L'utilisateur tape la SUITE sans l'envoyer, pendant que le tour tourne.
    await type('BROUILLON JAMAIS ENVOYE')
    const textarea = (): HTMLTextAreaElement =>
      container!.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea().value).toBe('BROUILLON JAMAIS ENVOYE')

    // Fin du tour → le drain part.
    await act(async () => {
      turn.resolve({ ok: true })
      await flushAnimationFrames()
    })

    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'message en file' })
      ])
    )
    // LE point : le brouillon a survecu au drain.
    expect(textarea().value).toBe('BROUILLON JAMAIS ENVOYE')
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
      Array.from(
        container!.querySelectorAll('.directive-queue-text'),
        (element) => element.textContent
      )
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

  /**
   * BTW AVAIT UN LIBELLE SANS EFFET DURABLE (audit adverse du 2026-07-29) : `mode: 'btw'` n'etait lu
   * que par l'affichage, et le message tape APRES le clic se rangeait derriere l'entree marquee BTW —
   * le « remettre a la fin » etait donc defait par la frappe suivante. Choix retenu : garder le bouton
   * et rendre le report REEL (une entree BTW reste la derniere), plutot que de router le drain vers
   * `injectDirective` — le drain part precisement sur la fin du tour, donc l'injection viserait un tour
   * DEJA TERMINE et perdrait le message. Ce test mesure l'ordre d'ENVOI, pas le rendu.
   */
  it('un message marqué BTW part APRES un message tapé ensuite', async () => {
    const turn = deferred<{ ok: boolean }>()
    const first = deferred<{ ok: boolean }>()
    const pilotChat = vi
      .fn()
      .mockImplementationOnce(() => turn.promise)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour actif')
    await click('.composer-send')
    await type('differe')
    await click('.composer-send')
    await click('.directive-queue-btw')
    await type('urgent')
    await click('.composer-send')

    // Ordre AFFICHE : l'entree BTW est passee derriere le message tape ensuite.
    expect(
      Array.from(
        container!.querySelectorAll('.directive-queue-text'),
        (element) => element.textContent
      )
    ).toEqual(['urgent', 'differe'])

    // Ordre ENVOYE : « urgent » d'abord, « differe » en dernier.
    await act(async () => {
      turn.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect(pilotChat.mock.calls[1][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'urgent' })])
    )
    await act(async () => {
      first.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect(pilotChat.mock.calls[2][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'differe' })])
    )
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
      expect(container!.querySelector('.directive-receipt .msg-body')?.textContent).toBe('keep me')
      expect(container!.querySelector('.directive-receipt-status')?.textContent).toContain('Échec')
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

    // Anti-doublon : les contrôles d'état (badge « en cours » + Stop) n'existent QU'UNE fois
    // dans la carte live — la paire flottante à droite du texte de tâche a été supprimée.
    const liveCard = container!.querySelector('.live-run')!
    expect(liveCard.querySelectorAll('button[title="Stopper le sous-agent en cours"]').length).toBe(
      1
    )
    expect(
      [...liveCard.querySelectorAll('.badge')].filter((b) => b.textContent?.trim() === 'en cours')
        .length
    ).toBe(1)
  })

  it('expose les QUATRE sections de Workflows, dont le graphe, et toujours pas d’onglet Activité', async () => {
    const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
    await mount(mockApi)
    await click('.conv-pick')
    await click('button[title="Workflows (RUN.md)"]')

    const pane = container!.querySelector('.runs-pane')
    expect(pane).toBeTruthy()
    const tablist = pane!.querySelector('.workflow-section-tabs[role="tablist"]')
    const tabButtons = [...(tablist?.querySelectorAll('button[role="tab"]') ?? [])]
    const tabs = tabButtons.map((button) => button.textContent?.trim())
    // L'onglet unique « Runs » melangeait le fil des sous-agents et la liste des RUN.md : il est
    // remplace par DEUX sections distinctes, a la demande explicite de l'utilisateur.
    expect(tabs).toContain('Sous-agents')
    expect(tabs).toContain('Run')
    expect(tabs).toContain('Graphe')
    expect(tabs).toContain('Source control')
    expect(tabs).not.toContain('Runs')
    expect(tabs).not.toContain('Activité')
    expect(tabButtons).toHaveLength(4)
    expect(tabButtons.every((button) => button.querySelector('svg.workflow-section-icon'))).toBe(
      true
    )
    expect(tabButtons.every((button) => button.querySelector('.workflow-section-separator'))).toBe(
      true
    )
    expect(
      tabButtons.filter((button) => button.getAttribute('aria-selected') === 'true')
    ).toHaveLength(1)
    expect(pane!.className).not.toContain('wide')
  })

  it('confirme puis supprime le RUN sélectionné et rafraîchit la liste', async () => {
    const run = {
      subject: 'ancien-run',
      session: 'A',
      path: 'A/ancien-run-workspace/RUN.md',
      mtime: 1,
      summary: {
        status: 'green',
        dodTotal: 1,
        dodChecked: 1,
        journalEvents: 1,
        defauts: 0
      }
    }
    let currentRuns = [run]
    const conversationRuns = vi.fn(async () => currentRuns)
    const deleteConversationRun = vi.fn(async () => {
      currentRuns = []
      return { ok: true, kind: 'deleted' }
    })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      conversationRuns,
      deleteConversationRun
    })
    await mount(mockApi)
    await click('.conv-pick')
    await click('button[title="Workflows (RUN.md)"]')
    const runTab = [...container!.querySelectorAll('.workflow-section-tabs button')].find(
      (button) => button.textContent?.trim() === 'Run'
    ) as HTMLButtonElement
    await act(async () => runTab.click())

    const deleteButton = container!.querySelector(
      'button[aria-label="Supprimer le run ancien-run"]'
    ) as HTMLButtonElement
    expect(deleteButton).toBeTruthy()
    await click('.run-row')
    expect(container!.querySelector('.run-detail-box')).toBeTruthy()
    await act(async () => deleteButton.click())
    expect(container!.querySelector('[role="dialog"]')?.textContent).toContain('ancien-run')

    await click('.run-delete-cancel')
    expect(deleteConversationRun).not.toHaveBeenCalled()

    await act(async () => deleteButton.click())
    await click('.run-delete-confirm')

    expect(deleteConversationRun).toHaveBeenCalledOnce()
    expect(deleteConversationRun).toHaveBeenCalledWith('A', run.path)
    expect(container!.querySelector('.run-row')).toBeNull()
    expect(container!.querySelector('.run-detail-box')).toBeNull()
  })

  it('affiche et exécute aussi la suppression dans le scope tous', async () => {
    const run = {
      subject: 'run-global',
      session: 'session-globale',
      path: 'session-globale/run-global-workspace/RUN.md',
      mtime: 1,
      summary: {
        status: 'green',
        dodTotal: 1,
        dodChecked: 1,
        journalEvents: 1,
        defauts: 0
      }
    }
    let globalRuns = [run]
    const listRuns = vi.fn(async () => globalRuns)
    const deleteRun = vi.fn(async () => {
      globalRuns = []
      return { ok: true }
    })
    const deleteConversationRun = vi.fn()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      listRuns,
      deleteRun,
      deleteConversationRun
    })
    await mount(mockApi)
    await click('.conv-pick')
    await click('button[title="Workflows (RUN.md)"]')
    const runTab = [...container!.querySelectorAll('.workflow-section-tabs button')].find(
      (button) => button.textContent?.trim() === 'Run'
    ) as HTMLButtonElement
    await act(async () => runTab.click())
    const allScope = [...container!.querySelectorAll('.runs-pane button')].find(
      (button) => button.textContent?.trim() === 'tous'
    ) as HTMLButtonElement
    await act(async () => {
      allScope.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const deleteButton = container!.querySelector(
      'button[aria-label="Supprimer le run run-global"]'
    ) as HTMLButtonElement
    expect(deleteButton).toBeTruthy()
    await act(async () => deleteButton.click())
    await click('.run-delete-confirm')

    expect(deleteRun).toHaveBeenCalledOnce()
    expect(deleteRun).toHaveBeenCalledWith(run.path)
    expect(deleteConversationRun).not.toHaveBeenCalled()
    expect(container!.querySelector('.run-row')).toBeNull()
  })

  it('le fil des sous-agents se REMPLIT depuis la trace persistée, sans run en mémoire', async () => {
    // Le défaut : « Aucune orchestration dans cette conversation » sur une conversation qui en avait
    // pourtant lancé — le fil ne vivait qu'en mémoire, alors que le graphe, lui, restait rempli.
    const causalTrace = vi.fn().mockResolvedValue([
      {
        id: 'event-req',
        conversationId: 'A',
        turnId: 'turn-A',
        timestamp: '2026-07-30T12:00:00.000Z',
        sequence: 1,
        type: 'message',
        status: 'completed',
        channel: 'chat',
        actor: { id: 'user', kind: 'user', label: 'Utilisateur' },
        payloads: [{ kind: 'message', content: 'ajoute un module' }],
        observation: { boundary: 'orchestrator', fidelity: 'exact' }
      },
      {
        id: 'event-agent',
        conversationId: 'A',
        turnId: 'turn-A',
        timestamp: '2026-07-30T12:00:05.000Z',
        sequence: 2,
        type: 'model-response',
        status: 'completed',
        channel: 'model',
        actor: { id: 'builder', kind: 'agent', label: 'Builder' },
        payloads: [{ kind: 'model-response', content: 'travail fait' }],
        observation: { boundary: 'orchestrator', fidelity: 'exact' }
      }
    ])
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A')]), causalTrace }))
    await click('.conv-pick')
    await click('button[title="Workflows (RUN.md)"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container!.textContent).not.toContain('Aucune orchestration dans cette conversation')
    expect(container!.querySelector('.live-run')).not.toBeNull()
  })

  // CONTRAT ÉLARGI (2026-07-31) : la trace causale alimente désormais DEUX sections — le graphe et le
  // fil des sous-agents, qui sans elle affichait « Aucune orchestration » sur une conversation qui en
  // avait pourtant lancé. Elle reste PARESSEUSE : rien n'est lu tant que le panneau Workflows est fermé.
  it('ne lit la trace causale qu’à l’ouverture du panneau, jamais au montage du chat', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      {
        id: 'event-A',
        conversationId: 'A',
        turnId: 'turn-A',
        timestamp: '2026-07-30T12:00:00.000Z',
        sequence: 1,
        type: 'tool-call',
        status: 'completed',
        channel: 'tool',
        actor: { id: 'builder', kind: 'agent', label: 'Builder' },
        payloads: [{ kind: 'tool-call', content: 'secret' }],
        observation: { boundary: 'orchestrator', fidelity: 'exact' }
      }
    ])
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      causalTrace
    })
    await mount(mockApi)
    await click('.conv-pick')
    // Montage + sélection de conversation : rien n'est lu tant que le panneau reste fermé.
    expect(causalTrace).not.toHaveBeenCalled()

    await click('button[title="Workflows (RUN.md)"]')
    const graphTab = [...container!.querySelectorAll('.workflow-section-tabs button')].find(
      (button) => button.textContent?.trim() === 'Graphe'
    ) as HTMLButtonElement
    await act(async () => {
      graphTab.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(causalTrace).toHaveBeenCalledWith('A')
    expect(
      container!.querySelector('.workflow-execution-graph')?.getAttribute('data-conversation-id')
    ).toBe('A')
    expect(container!.querySelector('[data-execution-node="event-A"]')).not.toBeNull()
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
    await click('.runs-pane .workflow-panel-close')
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

  it('sends a targeted prefill through that conversation without creating another one', async () => {
    const routeConversationMessage = vi.fn(async (conversationId: string) => ({
      sourceConversationId: conversationId,
      conversationId,
      routed: false,
      decision: { route: 'current' as const, confidence: 1, reason: 'related' }
    }))
    const conversationsCreate = vi.fn().mockResolvedValue(conversation('C'))
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      routeConversationMessage,
      conversationsCreate,
      pilotChat
    })
    await mount(mockApi)
    await click('.conv-pick')

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('autowin:prefill-conversation', {
          detail: { conversationId: 'B', prompt: 'Traite B', send: true }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(routeConversationMessage).toHaveBeenCalledWith('B', 'Traite B', [])
    expect(pilotChat).toHaveBeenCalledWith(expect.any(Array), 'B')
    expect(conversationsCreate).not.toHaveBeenCalled()
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
      .mockResolvedValue([{ id: 'codex/gpt-5.6-terra', provider: 'codex', model: 'gpt-5.6-terra' }])
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

  it('renders a sent image as an artifact card and opens it in a dismissible lightbox', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const fullImage = 'data:image/png;base64,b3JpZ2luYWw='
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
            thumbnail: 'data:image/jpeg;base64,bWluaWF0dXJl',
            turnId: 'turn-user-image',
            artifact: {
              id: 'user-image-1',
              name: 'preuve.png',
              mimeType: 'image/png',
              kind: 'image',
              size: 42,
              createdAt: 1,
              path: 'chat-artifacts/proof.png',
              source: { provider: 'user' }
            }
          }
        ]
      }
    ]
    const readChatArtifact = vi.fn().mockResolvedValue({
      ok: true,
      encoding: 'base64',
      content: 'b3JpZ2luYWw='
    })
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A', history)]),
        readChatArtifact
      })
    )
    await click('.conv-pick')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const sentImage = container!.querySelector('.msg.user .artifact-preview')
    expect(sentImage).toBeTruthy()
    expect(sentImage?.querySelector('.artifact-preview__header strong')?.textContent).toBe(
      'image envoyée'
    )
    expect(sentImage?.querySelector('.artifact-preview__footer')?.textContent).toContain('Envoyée')
    expect(sentImage?.querySelector('.artifact-preview__footer')?.textContent).toContain(
      'image/png'
    )
    expect(container!.querySelector('.msg.user .attachment-chip')).toBeNull()
    expect(sentImage?.querySelector('img')?.getAttribute('src')).toBe(fullImage)
    expect(readChatArtifact).toHaveBeenCalledWith('A', 'turn-user-image', 'user-image-1')

    await click('.msg.user .artifact-preview__image')
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Aperçu de preuve.png"]')
    ).toBeTruthy()
    expect(document.body.querySelector('.image-lightbox img')?.getAttribute('src')).toBe(fullImage)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()

    await click('.msg.user .artifact-preview__image')
    await act(async () => {
      ;(document.body.querySelector('.image-lightbox-close') as HTMLButtonElement).click()
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()

    await click('.msg.user .artifact-preview__image')
    await act(async () => {
      ;(document.body.querySelector('.image-lightbox') as HTMLElement).click()
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()
  })

  it('does not disguise a thumbnail as the original when durable storage failed', async () => {
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
            thumbnail: 'data:image/jpeg;base64,bWluaWF0dXJl',
            turnId: 'turn-user-image',
            originalUnavailable: true
          }
        ]
      }
    ]
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) }))
    await click('.conv-pick')

    const sentImage = container!.querySelector('.msg.user .artifact-preview')
    expect(sentImage).toBeTruthy()
    expect(sentImage?.querySelector('.artifact-preview__blocked')?.textContent).toBe(
      'Image originale non conservée · stockage indisponible'
    )
    expect(sentImage?.querySelector('img')).toBeNull()
    expect(container!.querySelector('.msg.user .attachment-chip')).toBeNull()
  })

  it('renders a persisted model artifact as an inline chat preview', async () => {
    const history = [
      {
        role: 'assistant',
        content: '[artefact capture.png]',
        ts: 1,
        turnId: 'turn-artifact',
        status: 'completed',
        parts: [
          {
            kind: 'artifact',
            artifact: {
              id: 'artifact-capture',
              name: 'capture.png',
              mimeType: 'image/png',
              kind: 'image',
              size: 3,
              createdAt: 1,
              encoding: 'base64',
              content: 'YWJj',
              source: { provider: 'codex', model: 'gpt-test' }
            }
          }
        ]
      }
    ]
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) }))
    await click('.conv-pick')

    expect(container!.querySelector('[data-artifact-kind="image"]')).not.toBeNull()
    expect(container!.querySelector('img.artifact-preview__image')).not.toBeNull()
    expect(container!.textContent).toContain('gpt-test')
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

  // Forker cree desormais une conversation A PART : plus de branches internes, donc plus de
  // parametre de branche active ni de barre d'onglets.
  const branched = (): Record<string, unknown> => ({
    id: 'A',
    title: 'A',
    category: 'codex',
    provider: 'codex',
    updatedAt: 1,
    messages: [
      { role: 'user', content: 'u1', ts: 1, messageId: 'm1' },
      {
        role: 'assistant',
        content: 'a1',
        ts: 1,
        messageId: 'm2',
        parentMessageId: 'm1',
        turnId: 't1',
        status: 'completed',
        parts: [{ kind: 'text', text: 'a1' }]
      },
      { role: 'user', content: 'u2', ts: 2, messageId: 'm3', parentMessageId: 'm2' }
    ]
  })

  it('forke depuis un tour assistant persistant en appelant conversationsFork', async () => {
    const fork = vi.fn().mockResolvedValue(undefined)
    const conv = branched()
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

  it('la loupe d’un message COPIÉ vise la conversation qui possède le tour', async () => {
    // Le journal d'un tour est range par conversation : chercher sous le fork ne trouvait rien et
    // renvoyait vers un run etranger. Le message copie porte donc son proprietaire.
    const inspect = vi.fn()
    const copie = {
      id: 'A-fork',
      title: 'A (fork)',
      category: 'codex',
      provider: 'codex',
      updatedAt: 2,
      messages: [
        {
          role: 'assistant',
          content: 'a1',
          ts: 1,
          messageId: 'f2',
          turnId: 't1',
          turnConversationId: 'A',
          status: 'completed',
          parts: [{ kind: 'text', text: 'a1' }]
        }
      ]
    }
    await mount(api({ conversations: vi.fn().mockResolvedValue([copie]) }), {
      onInspectTurn: inspect
    })
    await click('.conv-pick')
    const loupe = container!.querySelector('.msg-turn-icon') as HTMLButtonElement
    expect(loupe).toBeTruthy()
    await act(async () => loupe.click())

    expect(inspect).toHaveBeenCalledWith({ conversationId: 'A', turnId: 't1' })
  })

  it('forker OUVRE la conversation créée — on continue dans la copie', async () => {
    // Le geste attendu (celui de Claude) : le fork est une conversation à part, et c'est elle qu'on
    // ouvre. Avant, il fallait une barre d'onglets pour atteindre une branche interne invisible.
    const copie = {
      id: 'A-fork',
      title: 'A (fork)',
      category: 'codex',
      provider: 'codex',
      updatedAt: 2,
      messages: [{ role: 'user', content: 'u1', ts: 1, messageId: 'f1' }]
    }
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([branched()])
      .mockResolvedValue([branched(), copie])
    await mount(api({ conversations, conversationsFork: vi.fn().mockResolvedValue(copie) }))
    await click('.conv-pick')
    const assistantRow = container!.querySelector('.msg.assistant') as HTMLElement
    const forkBtn = [...assistantRow.querySelectorAll('button')].find((b) =>
      /branche/i.test(b.getAttribute('aria-label') ?? '')
    )
    await act(async () => (forkBtn as HTMLButtonElement).click())

    // Le fil affiche la copie (u1 seul), pas l'original (qui contient aussi u2).
    const body = container!.querySelector('.chat-scroll')!.textContent ?? ''
    expect(body).toContain('u1')
    expect(body).not.toContain('u2')
  })

  it('offre le bouton forker aussi sur un message utilisateur (avec messageId)', async () => {
    const fork = vi.fn().mockResolvedValue(undefined)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([branched()]),
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
})
