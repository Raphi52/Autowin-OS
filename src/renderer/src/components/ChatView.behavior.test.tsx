// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatView } from './ChatView'

// L'attente entre deux reprises après surcharge (30 s en vrai) est neutralisée : ces tests
// vérifient la DÉCISION et le GESTE, pas la patience.
vi.mock('../../../shared/reprise-surcharge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  attendreAvantReprise: () => Promise.resolve()
}))

const markdownRenderCount = vi.hoisted(() => ({ value: 0 }))
// 2026-09-12 : ce mock REMPLACAIT tout le module, donc splitFinalSummary disparaissait,
// et cloture-en-dernier.ts -- qui l'importe d'ici -- plantait a l'appel, faisant tomber
// 11 tests sans aucun rapport. On part desormais du module REEL et on ne remplace QUE
// les deux exports que ce fichier veut controler.
vi.mock('./Markdown', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
      '[data-testid="conv-menu-set-workdir"]'
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

  /**
   * Defaut vecu le 2026-09-05 : la liste etait DERIVEE des conversations rangees. Reclasser la
   * DERNIERE conversation d'un dossier le faisait donc disparaitre du menu -- il fallait
   * re-parcourir le disque pour le retrouver. Le dossier doit SURVIVRE au reclassement.
   */
  it('garde un dossier dans la liste apres avoir reclasse sa derniere conversation', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue(undefined)
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([{ ...conversation('A'), projectPath: 'C:\\RIGApplication' }])
      .mockResolvedValue([{ ...conversation('A'), projectPath: 'C:\\AutowinOS' }])
    // La memoire des dossiers survit entre les tests (meme jsdom) : on repart a blanc.
    window.localStorage.removeItem('autowin.conv-folders.connus')
    await mount(api({ conversations, conversationsSetProject }))

    const ouvrirMenuDossiers = async (): Promise<void> => {
      const convA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find((b) =>
        b.textContent?.includes('Conversation A')
      )
      await act(async () =>
        convA?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
      )
      await act(async () =>
        document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-set-workdir"]')!.click()
      )
    }
    const dossiersAffiches = (): string[] =>
      [...document.querySelectorAll<HTMLButtonElement>('[data-testid="conv-project-choice"]')].map(
        (bouton) => bouton.dataset.projectPath!
      )

    await ouvrirMenuDossiers()
    expect(dossiersAffiches()).toContain('C:\\RIGApplication')

    // On range la conversation AILLEURS : plus aucune conversation ne porte RIGApplication.
    const cible = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-testid="conv-project-choice"]')
    ].find((b) => b.dataset.projectPath === 'C:\\RIGApplication')
    await act(async () => {
      cible!.click()
      await Promise.resolve()
    })

    await ouvrirMenuDossiers()
    expect(
      dossiersAffiches(),
      'le dossier a disparu du menu des qu aucune conversation ne le portait plus'
    ).toContain('C:\\RIGApplication')
  })

  it('retire un dossier de la liste par sa croix, sans ranger la conversation dedans', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi
        .fn()
        .mockResolvedValue([{ ...conversation('A'), projectPath: 'C:\\Amitel\\Projet Alpha' }]),
      conversationsSetProject
    })
    window.localStorage.removeItem('autowin.conv-folders.connus')
    await mount(mockApi)

    const convA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find((b) =>
      b.textContent?.includes('Conversation A')
    )
    await act(async () =>
      convA?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    )
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-set-workdir"]')!.click()
    )

    const croix = document.querySelector<HTMLButtonElement>('[data-testid="conv-project-forget"]')
    expect(croix, 'aucune croix pour retirer un dossier de la liste').not.toBeNull()
    await act(async () => {
      croix!.click()
      await Promise.resolve()
    })

    expect(document.querySelectorAll('[data-testid="conv-project-choice"]').length).toBe(0)
    // La croix RETIRE de la liste, elle ne RANGE pas : aucun classement ne doit partir.
    expect(conversationsSetProject).not.toHaveBeenCalled()
  })

  /**
   * DES LIBELLES S'ETAIENT INSTALLES DANS LA LISTE DES DOSSIERS (conv-81, 2026-09-16).
   *
   * La liste memorise tout ce qui a servi a classer, et classer ecrivait dans le meme champ que le
   * dossier de travail : « Perso » ou « Clients/Amitel » se retrouvaient donc proposes comme
   * dossiers de travail. Les choisir renvoyait le tour dans le depot d'Autowin. Le nettoyage se
   * fait a la LECTURE, pas par une migration : la liste vit dans le stockage local du navigateur, et
   * un filtre au chargement vide l'existant ET refuse le suivant.
   * fix-ok: conv-81 — ces tests fixent la cause mesurée : la liste des dossiers connus était amorcée depuis projectPath, qui contenait aussi des libellés de catégorie ; ils ne doivent plus y entrer, ni à la lecture ni à l'écriture.
   */
  it('retire de la liste des dossiers les libelles de categorie, et n’en reprend aucun', async () => {
    window.localStorage.setItem(
      'autowin.conv-folders.connus',
      JSON.stringify(['C:\\Amitel\\Projet Alpha', 'Perso', 'Clients/Amitel', '\\\\srv\\part\\P'])
    )
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([{ ...conversation('A'), categorie: 'Factures' }])
      })
    )

    const convA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find((b) =>
      b.textContent?.includes('Conversation A')
    )
    await act(async () =>
      convA?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    )
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-set-workdir"]')!.click()
    )

    const proposes = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-testid="conv-project-choice"]')
    ].map((bouton) => bouton.dataset.projectPath!)
    expect(proposes).toEqual(['\\\\srv\\part\\P', 'C:\\Amitel\\Projet Alpha'])
    // Le stockage est REECRIT propre : sinon les libelles reviendraient au prochain lancement.
    expect(JSON.parse(window.localStorage.getItem('autowin.conv-folders.connus')!)).toEqual([
      'C:\\Amitel\\Projet Alpha',
      '\\\\srv\\part\\P'
    ])
    // La categorie de la conversation ne s'invite pas non plus dans la liste par l'amorcage.
    expect(proposes).not.toContain('Factures')
  })

  /**
   * LA PASTILLE DE LA BARRE DU HAUT DIT LE DOSSIER DE TRAVAIL, PAS LA CATEGORIE (conv-81).
   *
   * C'est le symptome que l'utilisateur voyait : « j'ai des CWD qui s'appellent comme des
   * categories ». Classer un fil sous « Factures » ecrivait « Factures » dans le champ qui pilote
   * le dossier de travail, et la pastille l'affichait comme tel — alors que le tour partait dans le
   * depot d'Autowin.
   */
  it('affiche le dossier de travail reel dans la pastille, jamais le nom de la categorie', async () => {
    window.localStorage.removeItem('autowin.conv-folders.connus')
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([
          {
            ...conversation('A'),
            categorie: 'Factures',
            projectPath: 'D:\\GIT\\RigApplication'
          }
        ]),
        defaultWorkspace: vi.fn().mockResolvedValue('C:\\Amitel\\Autowin OS')
      })
    )

    const convA = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find((b) =>
      b.textContent?.includes('Conversation A')
    )
    await act(async () => convA!.click())

    const pastille = container!.querySelector<HTMLButtonElement>('[data-testid="chat-project-dot"]')
    expect(pastille?.textContent).toContain('RigApplication')
    expect(pastille?.textContent).not.toContain('Factures')
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
    expect(container!.querySelector('[data-testid="composer-stop"]')?.textContent).toContain('Stop')

    await click('[data-testid="composer-stop"]')
    await act(async () => {
      turn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })

    expect(mockApi.cancelPilotChat).toHaveBeenCalledTimes(1)
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    // La file n'a plus d'affichage : Stop la REND AU COMPOSER, sinon le message serait invisible ET
    // jamais envoye (le Stop gele le drain). L'utilisateur le voit et decide.
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'message a garder en file'
    )
    // Le composer porte a nouveau du texte : le bouton propose donc de l'ENVOYER. « Reprendre »
    // (relance du tour coupe) ne s'affiche que si l'utilisateur vide d'abord ce qu'on lui a rendu.
    expect(container!.querySelector('.composer-send')?.textContent).toContain('Envoyer')
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
     * Ce que ce test garde, et qui n'a JAMAIS cesse d'etre la vraie garantie : LE MESSAGE SURVIT.
     * Depuis le retrait de l'affichage de la file, il revient dans le composer.
     */
    expect(container!.querySelector('[data-testid="composer-stop"]')).toBeNull()
    await act(async () => {
      turn.resolve({ ok: true, cancelled: true })
      await flushAnimationFrames()
    })

    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'message a garder en file'
    )
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

    // Le tour fantome est libere, et le message est TOUJOURS la — Stop l'a rendu au composer.
    expect(container!.querySelector('[data-testid="composer-stop"]')).toBeNull()
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'message a envoyer'
    )

    // La porte de sortie : depuis le composer, il part normalement.
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
    // La file n'a plus d'affichage (panneau retire le 2026-09-17) : la preuve qu'un message y est
    // bien ENTRE, c'est qu'il part tout seul des que le tour retombe.
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    await act(async () => {
      turn.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect((mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'a mettre en file' })
      ])
    )
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

    // Repli en file : le message reste recuperable (le recu dit que l'injection a echoue), et il
    // part tout seul a la fin du tour — la file n'ayant plus d'affichage, c'est LA preuve.
    expect(container!.textContent).toContain('a ne pas perdre')
    await act(async () => {
      turn.resolve({ ok: true })
      await flushAnimationFrames()
    })
    expect((mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'a ne pas perdre' })
      ])
    )
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

  // Renomme : l'ancien scenario passait par le bouton « Interrompre et envoyer tout », retire avec
  // l'affichage de la file. L'ordre du drain, lui, se mesure a la fin NATURELLE du tour.
  it('drains queued messages in order when the active turn ends', async () => {
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

    expect(mockApi.cancelPilotChat).not.toHaveBeenCalled()

    await act(async () => {
      firstTurn.resolve({ ok: true })
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

  /**
   * CLIGNOTEMENT A LA BASCULE (rapporte le 2026-09-02, « parfois »). Ouvrir une autre conversation
   * remplace tout le contenu du fil : le navigateur emet un `scroll` mesure sur l'ANCIENNE position,
   * avant toute descente. Ce defilement fantome etait lu comme un recul du lecteur et allumait
   * « ↓ Dernier message » le temps d'une frame. Le lecteur n'a rien touche : rien ne doit s'allumer.
   */
  it('n allume pas le saut vers le bas sur le defilement fantome d une bascule de conversation', async () => {
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')])
    })
    await mount(mockApi)
    const picks = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')]
    await act(async () => picks[0].click())

    const scroll = container!.querySelector('.chat-scroll') as HTMLDivElement
    scroll.scrollTo = vi.fn()
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 900 }
    })

    // Bascule vers l'autre conversation : le fil est remplace, le navigateur emet un `scroll`
    // AUCUN geste de lecture ne l'accompagne.
    await act(async () => picks[1].click())
    await act(async () => {
      ;(scroll as unknown as { scrollTop: number }).scrollTop = 0
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(container!.querySelector('.chat-jump-latest')).toBeNull()
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
    // La molette fait partie du geste : c'est elle qui distingue une lecture d'un defilement emis par
    // l'app (remplacement du fil a la bascule de conversation).
    await act(async () => {
      scroll.dispatchEvent(new Event('wheel', { bubbles: true }))
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

      // L'utilisateur remonte pendant que la frame du message est encore en attente : geste de
      // molette compris, sans quoi ce defilement serait indiscernable de celui emis par l'app.
      await act(async () => {
        scroll.dispatchEvent(new Event('wheel', { bubbles: true }))
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
    // `/btw` : l'injection part, elle echouera LOIN de A et le message retombera en file.
    await type('/btw reste en file')
    await click('.composer-send')

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
    // …sans qu'aucun bouton n'ait ete clique : la file n'a plus d'affichage du tout.
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

  /**
   * BTW AVAIT UN LIBELLE SANS EFFET DURABLE (audit adverse du 2026-07-29) : `mode: 'btw'` n'etait lu
   * que par l'affichage, et le message tape APRES le clic se rangeait derriere l'entree marquee BTW —
   * le « remettre a la fin » etait donc defait par la frappe suivante. Le BOUTON a depuis ete retire
   * (il ne servait a rien) : le report passe par la commande `/btw` du composer. Choix conserve —
   * rendre le report REEL (une entree BTW reste la derniere), plutot que de router le drain vers
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
    await type('/btw differe')
    await click('.composer-send')
    await type('urgent')
    await click('.composer-send')

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

      // Le recu dit l'echec, et le message n'est pas perdu : il part au drain de fin de tour.
      expect(container!.querySelector('.directive-receipt .msg-body')?.textContent).toBe('keep me')
      expect(container!.querySelector('.directive-receipt-status')?.textContent).toContain('Échec')
      await act(async () => {
        pilot.resolve({ ok: true })
        await flushAnimationFrames()
      })
      expect((mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[1][0]).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'keep me' })])
      )
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
  it('expose quatre onglets dans le panneau — Graph, Runs, Logs, Files — et ouvre sur le graphe', async () => {
    const mockApi = api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) })
    await mount(mockApi)
    await click('.conv-pick')
    await click('button[title="Détails de l’exécution"]')

    const pane = container!.querySelector('.runs-pane')
    expect(pane).toBeTruthy()
    expect(pane!.querySelector('[role="tablist"]')).toBeTruthy()
    expect(
      Array.from(pane!.querySelectorAll('button[role="tab"]')).map((b) => b.textContent?.trim())
      // 2026-09-12 : l'onglet « Files » (diff des fichiers modifies + arborescence editable) rejoint
      // les trois historiques. Le fil etait rouge ici depuis son arrivee dans `WorkflowsPanel`.
    ).toEqual(['Graph', 'Runs', 'Logs', 'Files', 'Trace'])
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
        // Un vrai sous-agent porte TOUJOURS son run et sa tentative : c'est ce couple qui fait
        // de lui un bloc « agent » dans le graphe (request-execution-tree-model.ts).
        execution: { runId: 'run-A', attemptId: '1' },
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

    // DESCENDRE SUR UN BLOC NON-AGENT RESTE SUR LE GRAPHE (conv-259, 2026-09-04) : son panneau de
    // détail s'ouvre sous l'arbre, seule vue qui détaille injection, appel d'outil ou clôture.
    // L'auto-bascule vers Runs ne vaut plus QUE pour un bloc d'agent — ce cas-là est prouvé par
    // `WorkflowsPanel.test.tsx` (« descendre sur un nœud agent bascule sur Runs »), avec un vrai
    // nœud d'agent ; la trace minimale utilisée ici n'en produit pas.
    const noeud = container!.querySelector<HTMLButtonElement>(
      '[data-execution-node][data-execution-kind]'
    )!
    expect(noeud).not.toBeNull()
    await act(async () => noeud.click())
    const ongletActif = container!.querySelector('.workflow-section-tab.is-active')
    expect(ongletActif?.textContent?.trim()).toBe('Graph')
    expect(container!.querySelector('[data-execution-node]')).not.toBeNull()
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
    // Le panneau ne s'ouvre PLUS tout seul au demarrage d'une orchestration : il est deja FERME,
    // seul le clic sur l'indicateur doit l'ouvrir.
    expect(container!.querySelector('.runs-pane')).toBeNull()
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

    expect(
      container!.querySelector('button[title="Détails de l’exécution"]')?.textContent
    ).toContain('1 green')
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

  /**
   * REGLE POSEE LE 2026-09-03 (conv-171), sur demande explicite de l'utilisateur : « un message
   * reste toujours dans le fil ou je l'ecris quand la bascule d'ecran ne peut pas s'appliquer ».
   *
   * Ce test exigeait AUPARAVANT l'inverse : le message partait dans le fil neuf `C` pendant que
   * l'utilisateur regardait `B`. C'est le defaut vecu — « je crois que la conv s'est pas cree et
   * que ca a laisse le message ici ». Le fil `C` ne recevait parfois jamais son contenu et
   * disparaissait, le texte ne survivant que dans le journal de secours des saisies.
   *
   * L'exigence est donc INVERSEE, pas desserree : le message doit partir dans `A`, le fil neuf
   * cree pour rien doit etre retire, et l'ecran ne doit pas bouger de `B`.
   */
  it('garde le message dans A quand le routage arrive trop tard pour basculer', async () => {
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
      conversationsRemove: vi.fn().mockResolvedValue(true),
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
    // Le message reste dans le fil OU IL A ETE ECRIT, pas dans le fil neuf que personne ne regarde.
    expect(pilotChat.mock.calls[0][1]).toBe('A')
    // Et le fil neuf cree pour rien est retire, sinon la liste se tapisse de fils vides.
    expect(mockApi.conversationsRemove).toHaveBeenCalledWith('C')
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

  /**
   * SURCHARGE DU MODÈLE (529) — demande utilisateur du 2026-09-03 : « quand le modèle renvoie une
   * erreur 529, forke la conversation et reprends (max 3 tentatives) ». Le fournisseur a refusé,
   * la demande est intacte : Autowin la rejoue dans une copie, au plus trois fois, et le dit.
   */
  const ERREUR_529 = 'API Claude surchargée (529) — abandon après 10/10 tentatives'
  const conversationAvecHistorique = (): Record<string, unknown> => ({
    ...conversation('A'),
    messages: [
      { role: 'user', content: 'u1', ts: 1, messageId: 'm1' },
      {
        role: 'assistant',
        content: 'a1',
        ts: 1,
        messageId: 'm2',
        turnId: 't1',
        status: 'completed',
        parts: [{ kind: 'text', text: 'a1' }]
      }
    ]
  })
  const copieDeA = (id = 'A-fork'): Record<string, unknown> => ({
    id,
    title: 'A (fork)',
    category: 'codex',
    provider: 'codex',
    updatedAt: 2,
    messages: [{ role: 'user', content: 'u1', ts: 1, messageId: 'f1' }]
  })

  async function laisserLaRepriseSeFaire(tours = 6): Promise<void> {
    for (let i = 0; i < tours; i += 1) await act(async () => flushAnimationFrames())
  }

  it('529 : forke la conversation et rejoue la demande dans la copie', async () => {
    const pilotChat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, cancelled: false, error: ERREUR_529 })
      .mockResolvedValue({ ok: true })
    const conversationsFork = vi.fn().mockResolvedValue(copieDeA())
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([conversationAvecHistorique()])
      .mockResolvedValue([conversationAvecHistorique(), copieDeA()])
    await mount(api({ conversations, conversationsFork, pilotChat }))
    await click('.conv-pick')
    await type('ma demande')
    await click('.composer-send')
    await laisserLaRepriseSeFaire()

    // La copie part du dernier message DÉJÀ enregistré, donc avant la demande qui a échoué.
    expect(conversationsFork).toHaveBeenCalledWith('A', 'm2')
    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[1]?.[1]).toBe('A-fork')
    expect(pilotChat.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'ma demande' })])
    )
  })

  it('529 en boucle : 3 reprises au maximum, puis le renoncement est dit', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: false, cancelled: false, error: ERREUR_529 })
    const conversationsFork = vi.fn().mockResolvedValue(copieDeA())
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([conversationAvecHistorique()])
      .mockResolvedValue([conversationAvecHistorique(), copieDeA()])
    await mount(api({ conversations, conversationsFork, pilotChat }))
    await click('.conv-pick')
    await type('ma demande')
    await click('.composer-send')
    await laisserLaRepriseSeFaire(12)

    // 1 envoi + 3 reprises, jamais une quatrième.
    expect(pilotChat).toHaveBeenCalledTimes(4)
    expect(conversationsFork).toHaveBeenCalledTimes(3)
    expect(container!.textContent ?? '').toContain('3 reprises automatiques ont échoué')
  })

  it('un échec ordinaire ne forke rien', async () => {
    const pilotChat = vi
      .fn()
      .mockResolvedValue({ ok: false, cancelled: false, error: 'Exit code: 1' })
    const conversationsFork = vi.fn().mockResolvedValue(copieDeA())
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversationAvecHistorique()]),
        conversationsFork,
        pilotChat
      })
    )
    await click('.conv-pick')
    await type('ma demande')
    await click('.composer-send')
    await laisserLaRepriseSeFaire()

    expect(conversationsFork).not.toHaveBeenCalled()
    expect(pilotChat).toHaveBeenCalledTimes(1)
  })

  it('un arrêt voulu par l’utilisateur ne forke rien, même libellé 529', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true, cancelled: true, error: ERREUR_529 })
    const conversationsFork = vi.fn().mockResolvedValue(copieDeA())
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversationAvecHistorique()]),
        conversationsFork,
        pilotChat
      })
    )
    await click('.conv-pick')
    await type('ma demande')
    await click('.composer-send')
    await laisserLaRepriseSeFaire()

    expect(conversationsFork).not.toHaveBeenCalled()
    expect(pilotChat).toHaveBeenCalledTimes(1)
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
    // Le selecteur vise l'ETIQUETTE, pas la classe : depuis l'arrivee du bouton « Copier »
    // (2026-09-12) trois boutons partagent `.msg-turn-icon`, et le premier du DOM est la copie.
    const loupe = container!.querySelector(
      '.msg-turn-icon[aria-label="Inspecter ce tour"]'
    ) as HTMLButtonElement
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
