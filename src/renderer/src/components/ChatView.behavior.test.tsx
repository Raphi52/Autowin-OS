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
    resumePilotChat: vi.fn().mockResolvedValue({ ok: true }),
    markResponseDisplayed: vi.fn().mockResolvedValue(undefined),
    cancelPilotChat: vi.fn().mockResolvedValue(undefined),
    // DEFAUT de ces tests : l'injection est INDISPONIBLE, donc un message tape pendant un tour
    // retombe sur le REPLI file d'attente — c'est ce repli que la majorite d'entre eux exercent.
    // Les tests qui veulent une injection reussie l'overrident explicitement.
    injectDirective: vi.fn().mockRejectedValue(new Error('injection indisponible')),
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

  /** Le fil des sous-agents et les RUN.md sont dans l'onglet Runs ; le panneau ouvre sur Graph. */
  async function ouvrirOngletRuns(): Promise<void> {
    const onglet = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === 'Runs')
    if (!onglet) throw new Error('onglet Runs introuvable')
    await act(async () => onglet.click())
  }

  async function flushAnimationFrames(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  it('propose les dossiers deja utilises au lieu du selecteur Windows', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi
        .fn()
        .mockResolvedValue([
          conversation('A'),
          { ...conversation('B'), projectPath: 'C:\\Amitel\\Projet Alpha' },
          { ...conversation('C'), projectPath: 'C:\\Amitel\\Projet Beta' }
        ]),
      conversationsSetProject
    })
    await mount(mockApi)

    const conversationA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find(
      (button) => button.textContent?.includes('Conversation A')
    )
    const trigger =
      conversationA?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')
    expect(trigger).not.toBeNull()
    await act(async () => trigger!.click())
    const action = document.querySelector<HTMLButtonElement>(
      '[data-testid="conv-menu-set-project"]'
    )
    expect(action).not.toBeNull()
    await act(async () => action!.click())

    expect(conversationsSetProject).not.toHaveBeenCalled()
    const choice = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-testid="conv-project-choice"]')
    ].find((button) => button.dataset.projectPath === 'C:\\Amitel\\Projet Alpha')
    expect(choice).toBeDefined()
    await act(async () => {
      choice!.click()
      await Promise.resolve()
    })
    expect(conversationsSetProject).toHaveBeenCalledWith('A', 'C:\\Amitel\\Projet Alpha')
    expect(conversationsSetProject).not.toHaveBeenCalledWith('A', undefined)
  })

  // Defaut vecu le 2026-08-18 : la liste du menu est DERIVEE des conversations deja rangees, donc
  // avec zero dossier le menu n'affichait que « Aucun dossier de conversations » — aucun moyen d'en
  // creer un, et donc aucun moyen d'en avoir un. Circulaire.
  it('permet de creer un nouveau dossier depuis le sous-menu, meme quand il n en existe aucun', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      conversationsSetProject
    })
    await mount(mockApi)

    const conversationA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find(
      (button) => button.textContent?.includes('Conversation A')
    )
    const trigger =
      conversationA?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')
    await act(async () => trigger!.click())
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-set-project"]')!.click()
    )

    // Aucun dossier existant : l action de creation doit malgre tout etre la.
    expect(document.querySelectorAll('[data-testid="conv-project-choice"]').length).toBe(0)
    const creer = document.querySelector<HTMLButtonElement>('[data-testid="conv-project-new"]')
    expect(
      creer,
      'l action « Nouveau dossier » manque : le menu vide est un cul-de-sac'
    ).not.toBeNull()
    await act(async () => creer!.click())

    const champ = document.querySelector<HTMLInputElement>('[data-testid="conv-project-new-input"]')
    expect(champ).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(champ, 'Clients/Amitel')
      champ!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      champ!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(conversationsSetProject).toHaveBeenCalledWith('A', 'Clients/Amitel')
    // Le selecteur Windows reste banni : jamais d appel sans chemin.
    expect(conversationsSetProject).not.toHaveBeenCalledWith('A', undefined)
    // Le menu se referme apres la creation.
    expect(document.querySelector('[data-testid="conv-project-new-input"]')).toBeNull()
  })

  it('ignore une saisie vide et ne cree aucun dossier', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      conversationsSetProject
    })
    await mount(mockApi)

    const conversationA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find(
      (button) => button.textContent?.includes('Conversation A')
    )
    await act(async () =>
      conversationA?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    )
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-set-project"]')!.click()
    )
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="conv-project-new"]')!.click()
    )

    const champ = document.querySelector<HTMLInputElement>('[data-testid="conv-project-new-input"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(champ, '   ')
      champ!.dispatchEvent(new Event('input', { bubbles: true }))
      champ!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(conversationsSetProject).not.toHaveBeenCalled()
  })

  it('fait basculer le controle principal de Stop a Reprendre sans rejouer le prompt', async () => {
    const turn = deferred<{ ok: boolean; cancelled?: boolean }>()
    const resumed = deferred<{ ok: boolean; cancelled: boolean; turnId: string }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => turn.promise),
      resumePilotChat: vi.fn(() => resumed.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un tour')
    await click('.composer-send')

    expect(container!.querySelector('[data-testid="composer-stop"]')).not.toBeNull()
    expect(container!.querySelector('[data-testid="composer-stop"]')?.textContent).toContain('Stop')
    await click('[data-testid="composer-stop"]')
    expect(mockApi.cancelPilotChat).toHaveBeenCalledWith('A')
    await act(async () => {
      turn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })
    expect(container!.querySelector('[data-testid="composer-send"]')?.textContent).toContain(
      'Reprendre'
    )
    await click('[data-testid="composer-send"]')
    expect(mockApi.resumePilotChat).toHaveBeenCalledWith('A')
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
  })

  it('Stop conserve la file sans relancer automatiquement un nouveau tour', async () => {
    const turn = deferred<{ ok: boolean; cancelled?: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => turn.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un tour')
    await click('.composer-send')
    await type('message a garder en file')
    await click('.composer-send')
    expect(container!.querySelector('.directive-queue')).not.toBeNull()
    expect(container!.querySelector('[data-testid="composer-stop"]')?.textContent).toContain('Stop')

    await click('[data-testid="composer-stop"]')
    await act(async () => {
      turn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })

    expect(mockApi.cancelPilotChat).toHaveBeenCalledTimes(1)
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('.directive-queue')).not.toBeNull()
    expect(container!.querySelector('.composer-send')?.textContent).toContain('Reprendre')
  })

  it('Stop conserve la file meme quand le main dit qu il n y avait rien a couper', async () => {
    const turn = deferred<{ ok: boolean; cancelled?: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => turn.promise),
      cancelPilotChat: vi.fn().mockResolvedValue({ ok: false })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un tour')
    await click('.composer-send')
    await type('message a garder en file')
    await click('.composer-send')
    await click('[data-testid="composer-stop"]')
    await act(async () => flushAnimationFrames())

    /**
     * `cancelPilotChat` rend `{ ok: false }` : ce n'est pas un echec d'annulation, c'est la PREUVE
     * — venue du processus qui detient la verite — qu'aucun tour ne tournait. Depuis le correctif
     * du tour fantome, le renderer LIBERE au lieu de rester gele : c'est un changement de contrat
     * assume, pas une regression. L'ancien test attendait le gel (bouton Stop toujours la).
     *
     * Ce que ce test garde, et qui n'a JAMAIS cesse d'etre la vraie garantie : la FILE SURVIT. Un
     * message mis en file par l'utilisateur ne doit pas disparaitre parce qu'il a clique Stop.
     */
    expect(container!.querySelector('[data-testid="composer-stop"]')).toBeNull()
    await act(async () => {
      turn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })

    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('.directive-queue')).not.toBeNull()
  })

  it('un message en file survit a un Stop fantome et peut encore etre envoye', async () => {
    /**
     * Ce test protegeait « le gel laisse par un Stop rate ». Ce gel n'existe plus : quand le main
     * repond `{ ok: false }`, il PROUVE qu'aucun tour ne tournait, et le renderer libere au lieu de
     * rester bloque (correctif du tour fantome, defaut vecu le 20/08 ou la conversation devenait
     * definitivement muette). Le scenario a donc change, mais pas l'enjeu.
     *
     * L'enjeu, lui, est intact et c'est le seul qui compte pour l'utilisateur : un message qu'il a
     * mis en file ne doit ni disparaitre ni devenir inatteignable. Hors tour actif, les boutons
     * d'INTERRUPTION disparaissent legitimement (il n'y a rien a interrompre) et le drain reste
     * volontairement suspendu apres un Stop — Stop ne transforme pas la file en relance automatique.
     * La voie qui reste est le retour au composer, et ce test verifie qu'elle mene bien a un envoi.
     */
    const turn = deferred<{ ok: boolean; cancelled?: boolean }>()
    const pilotChat = vi.fn((_messages: unknown[], _conversationId: string) => turn.promise)
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat,
      cancelPilotChat: vi.fn().mockResolvedValue({ ok: false })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un tour')
    await click('.composer-send')
    await type('message a envoyer')
    await click('.composer-send')
    await click('[data-testid="composer-stop"]')
    await act(async () => flushAnimationFrames())

    // Le tour fantome est libere, et le message est TOUJOURS la.
    expect(container!.querySelector('[data-testid="composer-stop"]')).toBeNull()
    expect(container!.querySelector('.directive-queue-text')?.textContent).toContain(
      'message a envoyer'
    )

    // La porte de sortie : le message revient au composer, puis part normalement.
    await click('.directive-queue-remove')
    await click('.composer-send')
    await act(async () => {
      turn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })

    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'message a envoyer' })
      ])
    )
  })

  it('n affiche AUCUN bouton stop hors tour — il n y a rien a arreter', async () => {
    const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
    await mount(mockApi)
    await click('.conv-pick')
    await type('du texte, mais aucun tour')
    expect(container!.querySelector('[data-testid="composer-stop"]')).toBeNull()
    expect(container!.querySelector('[data-testid="composer-send"]')?.textContent).toContain(
      'Envoyer'
    )
  })

  it('le bouton d envoi MET EN FILE pendant un tour, il n annule plus', async () => {
    // Separation des roles : un bouton, une action a la fois.
    const turn = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => turn.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance')
    await click('.composer-send')
    await type('a mettre en file')
    await click('.composer-send')
    expect(mockApi.cancelPilotChat).not.toHaveBeenCalled()
    expect(container!.querySelector('.directive-queue')).not.toBeNull()

    await act(async () => turn.resolve({ ok: true }))
  })

  it('/btw pendant un tour laisse une TRACE dans le fil (recu), au lieu de disparaitre', async () => {
    // `submitBtw` et `steerWithoutInterrupt` appellent la MEME IPC `injectDirective`, et seul le second
    // posait un recu. Le texte quittait donc le composer sans que rien n apparaisse — d ou « ca doit
    // m envoyer le message et me donner une reponse ». Divergence entre deux chemins du meme mecanisme.
    const turn = deferred<{ ok: boolean }>()
    const injectDirective = vi.fn().mockResolvedValue({ ok: true })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => turn.promise),
      injectDirective
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un tour')
    await click('.composer-send')

    await type('/btw pense aux tests')
    await click('.composer-send')
    await flushAnimationFrames()

    expect(injectDirective).toHaveBeenCalledWith('A', 'pense aux tests')
    const receipt = container!.querySelector('.directive-receipt')
    expect(receipt).not.toBeNull()
    expect(receipt!.textContent).toContain('pense aux tests')
    // Le recu porte son statut : c est ce qui repond « est-ce que ca a fait quelque chose ».
    expect(container!.querySelector('.directive-receipt-status')).not.toBeNull()

    await act(async () => turn.resolve({ ok: true }))
  })

  it('/btw dont l injection ECHOUE le dit, et ne perd pas le message', async () => {
    const turn = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => turn.promise),
      injectDirective: vi.fn().mockResolvedValue({ ok: false })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('lance un tour')
    await click('.composer-send')
    await type('/btw a ne pas perdre')
    await click('.composer-send')
    await flushAnimationFrames()

    // Repli en file : le message reste recuperable, et le recu dit que ca a echoue.
    expect(container!.querySelector('.directive-queue')).not.toBeNull()
    expect(container!.textContent).toContain('a ne pas perdre')

    await act(async () => turn.resolve({ ok: true }))
  })

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

  it('does not reload conversations or runs locally after a completed turn', async () => {
    const conversations = vi.fn().mockResolvedValue([conversation('A')])
    const conversationRuns = vi.fn().mockResolvedValue([])
    const mockApi = api({ conversations, conversationRuns })
    await mount(mockApi)
    await click('.conv-pick')
    await type('tour sans rechargement redondant')
    await click('.composer-send')
    await act(async () => flushAnimationFrames())

    expect(conversations).toHaveBeenCalledTimes(1)
    expect(conversationRuns).toHaveBeenCalledTimes(1)
  })

  it('relies on the conversation invalidation broadcast after creating a conversation', async () => {
    const conversations = vi.fn().mockResolvedValue([])
    const mockApi = api({
      conversations,
      conversationsCreate: vi.fn().mockResolvedValue(conversation('A'))
    })
    await mount(mockApi)
    await type('nouvelle conversation')
    await click('.composer-send')
    await act(async () => flushAnimationFrames())

    expect(conversations).toHaveBeenCalledTimes(1)
  })

  it('reloads runs once when orchestration completion also emits a workflow refresh', async () => {
    let appHandler: ((event: Record<string, unknown>) => void) | undefined
    const conversationRuns = vi.fn().mockResolvedValue([])
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      conversationRuns,
      onAppEvent: vi.fn((handler: (event: Record<string, unknown>) => void) => {
        appHandler = handler
        return vi.fn()
      })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await act(async () => {
      appHandler?.({ type: 'orchestrate-end', convId: 'A', status: 'green' })
      appHandler?.({ type: 'refresh', scope: 'workflows' })
      await Promise.resolve()
    })

    expect(conversationRuns).toHaveBeenCalledTimes(2)
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

  it('injection impossible pendant un tour ⇒ REPLI en file, avec les deux boutons de choix', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise)
      // `api()` rend l'injection indisponible → le message tape retombe en file (repli).
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('long turn')
    await click('.composer-send')
    await type('au fait, ajoute un test')
    await click('.composer-send')

    // L'orientation a bien ete TENTEE (parite claude.exe) ; c'est son echec qui remplit la file.
    expect(mockApi.injectDirective).toHaveBeenCalled()
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
      // 1re injection (composer) refusee → repli file ; la 2e (bouton Orienter) reussit.
      injectDirective: injectFailingThen(1)
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
    ).toContain('prochaine réponse')

    await act(async () => pilot.resolve({ ok: true }))
  })

  it('ramène immédiatement dans le viewport le reçu orienté quand le fil était remonté', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const injection = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      injectDirective: injectFailingThen(1, () => injection.promise)
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
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await click('.directive-queue-steer')
    await act(async () => flushAnimationFrames())

    // `behavior` corrigé le 2026-08-17 : l'intention de ce test est « ramener IMMÉDIATEMENT dans le
    // viewport », et le saut sec la sert mieux que l'animation. Le fil est ici à 900 px du bas pour une
    // fenêtre de 100 px — un `smooth` relancé à chaque frame de croissance n'avance jamais, défaut
    // mesuré le même jour (fil réel bloqué à `scrollTop` 0 avec 1688 px hors champ).
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' })
    await act(async () => injection.resolve({ ok: true }))
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('affiche le saut vers le dernier message dès que le fil est remonté, sans attendre une nouvelle activité', async () => {
    const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
    await mount(mockApi)
    await click('.conv-pick')
    await type('un message')
    await click('.composer-send')

    const scroll = container!.querySelector('.chat-scroll') as HTMLDivElement
    scroll.scrollTo = vi.fn()
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 900 }
    })

    // Au bas du fil : rien à proposer.
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(container!.querySelector('.chat-jump-latest')).toBeNull()

    // L'utilisateur remonte — aucune nouvelle activité n'arrive, le bouton doit apparaître quand même.
    await act(async () => {
      ;(scroll as unknown as { scrollTop: number }).scrollTop = 0
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(container!.querySelector('.chat-jump-latest')).not.toBeNull()

    // Redescendre le fait disparaître.
    await act(async () => {
      ;(scroll as unknown as { scrollTop: number }).scrollTop = 900
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(container!.querySelector('.chat-jump-latest')).toBeNull()
  })

  /**
   * FIN DE TOUR. Quand le tour se termine, la hauteur du fil change (bandeau « en cours » retire,
   * file d'attente videe, bloc de cloture peint) SANS que les messages changent : l'effet de
   * descente, branche sur `messages`, ne se rejouait pas. Le fil restait arrete au milieu de la
   * derniere reponse avec le bouton « ↓ Derniere reponse », alors que l'utilisateur n'avait rien
   * remonte (rapporte le 2026-09-01, conv-44, capture a l'appui).
   */
  it('redescend tout en bas quand le tour se termine', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('une question')
    await click('.composer-send')

    const scroll = container!.querySelector('.chat-scroll') as HTMLDivElement
    const scrollTo = vi.fn()
    scroll.scrollTo = scrollTo
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    })
    // On ne juge QUE la fin de tour : les descentes liees a l'envoi sont derriere nous.
    await act(async () => flushAnimationFrames())
    scrollTo.mockClear()

    await act(async () => {
      pilot.resolve({ ok: true })
      await Promise.resolve()
    })
    await act(async () => flushAnimationFrames())

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' })
  })

  it('un message arrivé juste avant un scroll vers le haut ne ramène pas l’utilisateur en bas', async () => {
    // La frame est mise sous contrôle : c'est le seul moyen de placer le scroll utilisateur ENTRE la
    // décision de suivre le fil et son exécution. Sous charge, cet écart existe pour de vrai — c'est
    // lui qui faisait clignoter ce comportement d'un run à l'autre.
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    try {
      const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
      await mount(mockApi)
      await click('.conv-pick')
      await type('un message')
      await click('.composer-send')

      const scroll = container!.querySelector('.chat-scroll') as HTMLDivElement
      scroll.scrollTo = vi.fn()
      Object.defineProperties(scroll, {
        scrollHeight: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 100 },
        scrollTop: { configurable: true, writable: true, value: 900 }
      })

      // L'utilisateur remonte pendant que la frame du message est encore en attente.
      await act(async () => {
        ;(scroll as unknown as { scrollTop: number }).scrollTop = 0
        scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
      })
      expect(container!.querySelector('.chat-jump-latest')).not.toBeNull()

      // La frame en retard s'exécute : elle doit relire l'intention, pas l'écraser.
      await act(async () => {
        for (const frame of frames.splice(0)) frame(0)
      })
      expect(container!.querySelector('.chat-jump-latest')).not.toBeNull()
      expect(scroll.scrollTo).not.toHaveBeenCalled()
    } finally {
      raf.mockRestore()
    }
  })

  /**
   * ENVOI = ON RESTE COLLE AU BAS. La descente automatique bouge `scrollTop` pendant que le fil
   * grandit : le navigateur livre alors des evenements `scroll` LOIN du bas, provoques par NOUS.
   * Les prendre pour un geste de lecture coupait le suivi des la premiere frame — le fil s'arretait
   * juste apres l'envoi et le bouton « ↓ Derniere reponse » s'allumait sans que le lecteur ait
   * touche a rien (rapporte le 2026-09-01). Le garde `doitSuivreLeBas` existait mais n'etait pas
   * branche sur le conteneur.
   */
  it('reste colle au bas apres un envoi malgre les evenements de sa propre descente', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')

    const scroll = container!.querySelector('.chat-scroll') as HTMLDivElement
    const scrollTo = vi.fn()
    scroll.scrollTo = scrollTo
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 4000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    })

    await type('une question')
    await click('.composer-send')
    await act(async () => flushAnimationFrames())

    // La descente est en vol : elle avance vers le bas sans l'avoir atteint. C'est ELLE qui emet
    // l'evenement, pas le lecteur.
    await act(async () => {
      ;(scroll as unknown as { scrollTop: number }).scrollTop = 1200
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(container!.querySelector('.chat-jump-latest')).toBeNull()

    // Le tour se termine : le suivi doit toujours etre actif, donc on redescend tout en bas.
    scrollTo.mockClear()
    await act(async () => {
      pilot.resolve({ ok: true })
      await Promise.resolve()
    })
    await act(async () => flushAnimationFrames())
    expect(scrollTo).toHaveBeenCalledWith({ top: 4000, behavior: 'auto' })
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
    await act(async () =>
      pilotHandler?.({
        conversationId: 'A',
        turnId: 'turn-chronologie',
        kind: 'delta',
        streamId: '0:0',
        text: ' après-orientation'
      })
    )
    // Le texte de streaming est batché sur une frame (ChatView.tsx: pilotBatcher) : sans attendre la
    // frame, le second delta n'est pas encore dans le DOM et la recherche du bloc « après » échoue.
    await act(async () => flushAnimationFrames())

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

    // Les deltas pilote sont BATCHES (flush sur frame) : le texte recalcule n'est donc PAS dans le
    // DOM a la sortie du `act` qui emet l'evenement. Sans cette attente, le corps de remplacement
    // etait parfois `undefined` et `compareDocumentPosition` jetait — un faux rouge de timing, pas
    // une regression de l'ordre affiche.
    const corpsAssistants = (): HTMLElement[] =>
      [...container!.querySelectorAll<HTMLElement>('.msg.assistant .msg-body')].filter(
        (body) => !body.closest('.directive-receipt') && body.textContent?.includes('réponse')
      )
    for (let essai = 0; essai < 20 && corpsAssistants().length === 0; essai += 1) {
      await act(async () => flushAnimationFrames())
    }
    const receipt = container!.querySelector('.directive-receipt') as HTMLElement
    const [replacement] = corpsAssistants()
    expect(replacement).toBeTruthy()
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
      injectDirective: injectFailingThen(1, () => injection.promise)
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
    // 1 = la tentative d'orientation du composer (refusee → repli file), 2 = l'UNIQUE injection
    // du bouton malgre le double clic. Un 3 signifierait la directive partie deux fois.
    expect((mockApi.injectDirective as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
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
      injectDirective: injectFailingThen(1, () => injection.promise)
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
      injectDirective: injectFailingThen(1, () => injection.promise)
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
      // Les 2 messages tapes PENDANT le tour (A, B) voient leur orientation refusee → ils
      // remplissent la file ; seuls les clics « Orienter » injectent ensuite avec succes.
      injectDirective: injectFailingThen(2, () => injection.promise)
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
      injectDirective: injectFailingThen(1, () => injection.promise)
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

    // 1 tentative refusee (composer → repli file) + 1 injection du bouton « Orienter ».
    expect(mockApi.injectDirective).toHaveBeenCalledTimes(2)
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
      // ↑/↓ = réordonnancement de la file, ajoutés devant les actions existantes.
    ).toEqual(['↑', '↓', '⏹ Interrompre et envoyer', '🧭 Orienter', 'BTW', '✕'])
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
      ;(container!.querySelectorAll('.conv-pick')[0] as HTMLElement).click()
    })
    await click('button[title="Détails de l’exécution"]')
    // Le fil des sous-agents vit dans l'onglet Runs depuis le 2026-09-01 (demande utilisateur) :
    // le panneau s'ouvre sur le graphe, il faut donc y aller.
    await ouvrirOngletRuns()

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

  /**
   * LE GRAPHE REMPLACE LES QUATRE SECTIONS.
   *
   * Ce test EXIGEAIT la barre d'onglets. Elle a disparu : les quatre sections étaient quatre
   * projections de la même exécution, qu'il fallait corréler de tête. Le graphe est désormais la
   * navigation, et le détail dessous découle du nœud choisi. L'assertion est retournée pour que la
   * barre ne puisse pas revenir en silence.
   */
  /**
   * TROIS ONGLETS — Graph / Runs / Logs — redemandes le 2026-09-01. Ce test remplace celui qui
   * INTERDISAIT toute barre d'onglets : l'interdiction datait de la periode ou le graphe etait la
   * seule navigation, et elle aurait bloque la separation demandee. Ce qui reste verifie : les
   * QUATRE anciennes projections ne reviennent pas, et le graphe est toujours l'accueil.
   */
  it('expose trois onglets dans le panneau — Graph, Runs, Logs — et ouvre sur le graphe', async () => {
    const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
    await mount(mockApi)
    await click('.conv-pick')
    await click('button[title="Détails de l’exécution"]')

    const pane = container!.querySelector('.runs-pane')
    expect(pane).toBeTruthy()
    expect(pane!.querySelector('[role="tablist"]')).toBeTruthy()
    expect(
      Array.from(pane!.querySelectorAll('button[role="tab"]')).map((b) => b.textContent?.trim())
    ).toEqual(['Graph', 'Runs', 'Logs'])
    // Le graphe est monté d'emblée, et son détail de sélection reste sous lui.
    expect(pane!.querySelector('.workflow-execution-graph')).toBeTruthy()
    expect(pane!.querySelector('[data-workflow-detail]')).toBeTruthy()
    // Les anciennes projections en onglets ne reviennent pas par la bande.
    expect(pane!.textContent).not.toContain('Activité')
    expect(pane!.textContent).not.toContain('Source control')
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
    await click('button[title="Détails de l’exécution"]')
    // Les RUN.md ont leur propre onglet depuis le 2026-09-01 : il faut l'ouvrir pour les lire.
    await click('button[role="tab"]:nth-of-type(2)')

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

  // Le test « suppression dans le scope tous » a ete RETIRE avec le selecteur de portee :
  // la barre de droite ne montre plus que la conversation courante, donc `deleteRun`
  // (suppression globale) n'y est plus atteignable. L'IPC existe toujours cote main.

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
    await click('button[title="Détails de l’exécution"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container!.textContent).not.toContain('Aucune orchestration dans cette conversation')
    // Le graphe est bien rempli par la trace : c'est LA garde du défaut d'origine.
    expect(container!.querySelector('[data-execution-node]')).not.toBeNull()
    // Depuis le 2026-09-01, l'accueil de l'onglet Graph ne garde que les fils EN COURS : ce tour
    // est TERMINÉ, donc son fil n'y est plus empilé — il s'ouvre en descendant sur son nœud.
    expect(container!.querySelector('.live-run')).toBeNull()

    const noeudAgent = container!.querySelector<HTMLButtonElement>(
      '[data-execution-node][data-execution-kind]'
    )!
    await act(async () => noeudAgent.click())
    // Le fil se lit dans l'onglet RUNS, à côté des RUN.md — demandé trois fois par l'utilisateur,
    // acté le 2026-09-01. Descendre sur un nœud du graphe y bascule tout seul : sans cela, le fil
    // s'empilait sous le graphe et on relisait la même exécution deux fois.
    const ongletActif = container!.querySelector('.workflow-section-tab.is-active')
    expect(ongletActif?.textContent?.trim()).toBe('Runs')
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

    await click('button[title="Détails de l’exécution"]')
    // Le graphe n’est plus derrière un onglet : ouvrir le panneau SUFFIT à le monter, donc à lire
    // la trace. La paresse tient désormais à l’ouverture du panneau, seule garde encore réelle.
    await act(async () => {
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

    // Depuis le 2026-08-31, le chevron de l'en-tete REPLIE les etapes ; l'acces a Workflows garde
    // son propre bouton ↗ dans la barre, pour ne pas perdre la trace complete.
    const indicator = container!.querySelector(
      '[data-testid="activity-group"]'
    ) as HTMLButtonElement | null
    expect(indicator?.textContent).toContain('en cours')
    const ouvrirRun = container!.querySelector(
      '[data-testid="activity-open-run"]'
    ) as HTMLButtonElement | null
    expect(ouvrirRun).toBeTruthy()
    await act(async () => ouvrirRun!.click())

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

    expect(container!.querySelector('button[title="Détails de l’exécution"]')?.textContent).toContain(
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

  /**
   * MOSAIQUE + message pre-ecrit. « Faire reparer » (bandeau de mise a jour), « Prompter dans
   * Autowin » (veille) et « Preparer le prompt » (tickets) passent TOUS par cet evenement. En
   * mosaique, le chat unique n'est pas rendu : remplir son champ n'affichait rien du tout, et les
   * boutons paraissaient morts (mesure le 2026-09-01, conv-44). La fenetre doit s'OUVRIR, avec le
   * message dedans, sans faire sortir l'utilisateur de sa mosaique.
   */
  it('ouvre une fenetre de mosaique portant le message pre-ecrit, sans quitter la mosaique', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', JSON.stringify(['A']))
    try {
      const mockApi = api({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
        conversation: vi.fn(async (id: string) => conversation(id))
      })
      await mount(mockApi)

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('autowin:prefill-conversation', {
            detail: { conversationId: 'B', prompt: 'Repare la mise a jour', send: false }
          })
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => flushAnimationFrames())

      // On est TOUJOURS en mosaique, et elle porte maintenant les deux fenetres.
      const fenetres = [...container!.querySelectorAll('.chat-mosaic-window')]
      expect(fenetres).toHaveLength(2)
      const champs = [...container!.querySelectorAll('.chat-mosaic-window textarea')].map(
        (champ) => (champ as HTMLTextAreaElement).value
      )
      expect(champs).toContain('Repare la mise a jour')
    } finally {
      window.localStorage.clear()
    }
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

  it.each(['click', 'enter'] as const)(
    'sends from an existing empty conversation B by %s while conversation A is still working',
    async (submission) => {
      const pilotA = deferred<{ ok: boolean }>()
      const pilotChat = vi
        .fn()
        .mockImplementationOnce(() => pilotA.promise)
        .mockResolvedValue({ ok: true })
      const mockApi = api({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
        pilotChat
      })
      await mount(mockApi)
      const picks = container!.querySelectorAll('.conv-pick')
      await act(async () => (picks[0] as HTMLElement).click())
      await type('travail long dans A')
      await click('.composer-send')

      await act(async () => (picks[1] as HTMLElement).click())
      await type('Conversation active — Preuve portée conversation A · 1785448165496')
      if (submission === 'click') {
        await click('.composer-send')
      } else {
        const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
        await act(async () => {
          textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
      }

      expect(pilotChat).toHaveBeenCalledTimes(2)
      expect(pilotChat.mock.calls[1][1]).toBe('B')
      expect(pilotChat.mock.calls[1][0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Conversation active — Preuve portée conversation A · 1785448165496'
          })
        ])
      )
      await act(async () => pilotA.resolve({ ok: true }))
    }
  )

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

  /**
   * MESUREUR DE RENDUS DU STREAMING (DoD du frame « fluidité »).
   *
   * Contrat prouvé ici : une rafale de deltas arrivés dans la MÊME frame ne coûte qu'UN rendu du
   * fil, pas un rendu par token. Entrée qui doit faire échouer ce test si la correction était
   * fausse : ces 30 deltas appliqués SANS batcher (patchLast direct par delta) → markdownRenderCount
   * monte à ~30 au lieu de rester ≤ 2. Le test échoue AUSSI si le batcher perd du texte :
   * l'assertion de contenu final couvre le faux-vert « ne rien rendre ».
   */
  it('ne rend le fil qu’une fois par frame pour une rafale de deltas de streaming', async () => {
    const pilot = deferred<{ ok: boolean }>()
    let pilotHandler: ((event: unknown) => void) | undefined
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      onPilotEvent: vi.fn((callback: (event: unknown) => void) => {
        pilotHandler = callback
        return vi.fn()
      })
    })
    // Frames PILOTÉES : sans cela, chaque delta tomberait dans sa propre frame et le batcher ne
    // serait pas mesuré. Les callbacks sont capturés puis rejoués en UNE fois.
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('mesure de rendus')
    await click('.composer-send')

    const RAFALE = 30
    markdownRenderCount.value = 0
    // Un delta PAR TÂCHE : c'est la réalité IPC. Groupés dans un seul act(), React les batcherait
    // lui-même et le test passerait même sans batcher applicatif (mutant vérifié).
    for (let index = 0; index < RAFALE; index += 1)
      await act(async () => {
        pilotHandler?.({
          conversationId: 'A',
          turnId: 'turn-mesure',
          kind: 'delta',
          streamId: '0:0',
          text: `t${index} `
        })
      })
    const pendantLaRafale = markdownRenderCount.value
    await act(async () => {
      const aRejouer = frames.splice(0, frames.length)
      for (const frame of aRejouer) frame(0)
    })

    expect(pendantLaRafale).toBe(0)
    expect(markdownRenderCount.value).toBeLessThanOrEqual(2)
    expect(container!.textContent).toContain('t0 ')
    expect(container!.textContent).toContain(`t${RAFALE - 1} `)
    await act(async () => pilot.resolve({ ok: true }))
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
    // Les visuels sont repliés par défaut : seul le bandeau est visible avant dépliage.
    expect(sentImage?.querySelector('img')).toBeNull()
    await click('.msg.user .artifact-preview__toggle')
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
    await click('.artifact-preview__toggle')
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
  /**
   * P1 statuts terminaux : un tour clos par annulation ou interruption laissait la bulle MUETTE
   * (au mieux « (aucune réponse) »). L'utilisateur ne savait ni ce qui s'était passé, ni comment
   * repartir. Les trois statuts terminaux doivent être lisibles, et `failed` rester INCHANGÉ.
   */
  describe('statuts terminaux du tour', () => {
    it('annulé : affiche le statut et centralise la reprise dans le composer', async () => {
      const turn = deferred<{ ok: boolean; cancelled?: boolean }>()
      const resumed = deferred<{ ok: boolean; cancelled: boolean; turnId: string }>()
      const pilotChat = vi.fn((_payload: Array<{ role: string; content: string }>) => turn.promise)
      const mockApi = api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        pilotChat,
        resumePilotChat: vi.fn(() => resumed.promise)
      })
      await mount(mockApi)
      await click('.conv-pick')
      await type('ma question')
      await click('.composer-send')
      await act(async () => {
        turn.resolve({ ok: false, cancelled: true })
        await flushAnimationFrames()
      })

      expect(container!.textContent).toContain('Réponse annulée')
      expect(container!.querySelector('.msg-terminal-action')).toBeNull()
      expect(container!.querySelector('.composer-send')?.textContent).toContain('Reprendre')
      await click('.composer-send')
      expect(mockApi.resumePilotChat).toHaveBeenCalledWith('A')
      expect(pilotChat).toHaveBeenCalledTimes(1)
    })

    it('interrompu : affiche le statut et centralise la reprise dans le composer', async () => {
      const turn = deferred<{ ok: boolean }>()
      const resumed = deferred<{ ok: boolean; cancelled: boolean; turnId: string }>()
      const mockApi = api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        pilotChat: vi.fn(() => turn.promise),
        resumePilotChat: vi.fn(() => resumed.promise)
      })
      await mount(mockApi)
      await click('.conv-pick')
      await type('ma tâche longue')
      await click('.composer-send')
      await act(async () => {
        turn.resolve({ ok: true })
        await flushAnimationFrames()
      })

      expect(container!.textContent).toContain('Réponse interrompue avant la fin')
      expect(container!.querySelector('.msg-terminal-action')).toBeNull()
      expect(container!.querySelector('.composer-send')?.textContent).toContain('Reprendre')
      await click('.composer-send')
      expect(mockApi.resumePilotChat).toHaveBeenCalledWith('A')
    })

    // CONTRAT MIS À JOUR : l'échec n'est plus une part texte `⚠️ …` inerte (indistinguable d'un
    // contenu du modèle) mais un bloc d'ALERTE structuré, qui porte lui-même la reprise.
    it('échoué : rend une alerte structurée (cause + message) porteuse de la reprise', async () => {
      const turn = deferred<{ ok: boolean; error?: string }>()
      const mockApi = api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        pilotChat: vi.fn(() => turn.promise)
      })
      await mount(mockApi)
      await click('.conv-pick')
      await type('ça va casser')
      await click('.composer-send')
      await act(async () => {
        turn.resolve({ ok: false, error: 'boom' })
        await flushAnimationFrames()
      })

      const alerte = container!.querySelector('.msg-error') as HTMLElement
      expect(alerte).toBeTruthy()
      expect(alerte.getAttribute('role')).toBe('alert')
      expect(alerte.textContent).toContain('Le tour a échoué')
      expect(alerte.textContent).toContain('boom')
      expect(container!.textContent).not.toContain('Réponse annulée')
      expect(container!.textContent).not.toContain('Réponse interrompue avant la fin')
      // Une seule barre d'actions : celle de l'alerte (le bloc terminal ne la duplique pas).
      expect(container!.querySelector('.msg-terminal-action')).toBeNull()
      expect(container!.querySelectorAll('.msg-error-action')).toHaveLength(2)
    })
  })
})
