// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  attendreLaListe,
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'
import { oublierRendusRecents } from './rendu-long'

/**
 * GEL `renderer:vue-chat-liste` QUI NOMME SA CAUSE (2026-10-23). 18 gels réels pour 73 s
 * depuis le 20/10 (pire 12,9 s) disaient seulement « la liste a mis N ms » : ni combien de lignes
 * elle avait redessinées, ni quelle donnée avait changé. Le diagnostic /gel n'a donc pas pu trancher.
 * Chaque gel de la liste porte désormais `liste` : lignes redessinées, rendus, et déclencheurs.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LE DÉTAIL SAUTE : un rafraîchissement où un seul fil sur
 * 50 a changé. Le seuil est abaissé à 0 pour que CHAQUE rendu de la liste soit signalé : sans
 * détail, le signal de la liste part sans champ `liste`.
 */
vi.mock('../../../shared/gel-detector', async (original) => ({
  ...(await original<typeof import('../../../shared/gel-detector')>()),
  SEUIL_GEL_MS: 0
}))

/**
 * Compte les rendus de ChatView : chaque rendu appelle ce hook une fois. Sert à prouver qu'une tranche
 * de la liste ne relance pas tout le chat.
 */
const rendusDuChat = vi.hoisted(() => ({ nombre: 0 }))
vi.mock('./chat-view-liste', async (original) => {
  const reel = await original<typeof import('./chat-view-liste')>()
  const useListeDesConversations = (ctx: Parameters<typeof reel.useListeDesConversations>[0]) => {
    rendusDuChat.nombre += 1
    return reel.useListeDesConversations(ctx)
  }
  return { ...reel, useListeDesConversations }
})

type Liste = { lignes: number; rendus: number; passages: number; declencheurs: string[] }
type Signal = [number, string | undefined, { liste?: Liste } | undefined]

async function laisserPasser(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

describe('ChatView — le gel de la liste nomme les lignes redessinées et leur déclencheur', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    vi.useRealTimers()
    await harness?.unmount()
    harness = undefined
    oublierRendusRecents()
  })

  async function monter(store: Array<Record<string, unknown>>): Promise<{
    signaux: Signal[]
    rafraichir: () => Promise<void>
  }> {
    const signaux: Signal[] = []
    let emettre!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi.fn(async () => structuredClone(store)),
        conversation: vi.fn(async (id: string) => store.find((c) => c.id === id)),
        onAppEvent: vi.fn((listener) => {
          emettre = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        }),
        signalerGelRenderer: vi.fn((...a: unknown[]) => signaux.push(a as Signal))
      })
    )
    await laisserPasser()
    return {
      signaux,
      rafraichir: async () => {
        await act(async () => emettre({ type: 'refresh', scope: 'conversations' }))
        await laisserPasser()
      }
    }
  }

  const fils = (): Array<Record<string, unknown>> =>
    Array.from({ length: 50 }, (_, i) => ({
      ...conversation(`c${i}`),
      messageCount: 1,
      updatedAt: 1_000 + i
    }))
  const signauxListe = (signaux: Signal[]): Signal[] =>
    signaux.filter(([, etiquette]) => etiquette === 'vue-chat-liste')

  it('un fil modifié au rafraîchissement ⇒ 1 ligne redessinée, déclenchée par les conversations', async () => {
    const store = fils()
    const { signaux, rafraichir } = await monter(store)
    expect(harness!.container.querySelectorAll('.conv-item').length).toBeGreaterThanOrEqual(50)

    store[7] = { ...store[7], title: 'Titre changé' }
    signaux.length = 0
    await rafraichir()

    const liste = signauxListe(signaux)
    expect(liste.length).toBeGreaterThan(0)
    // Chaque signal de la liste porte son détail, même quand il n'y a rien à accuser.
    for (const [, , detail] of liste) expect(detail?.liste).toBeDefined()
    const redessines = liste.filter(([, , d]) => (d?.liste?.lignes ?? 0) > 0)
    expect(redessines).toHaveLength(1)
    const detail = redessines[0]![2]!.liste!
    expect(detail.lignes).toBe(1)
    expect(detail.rendus).toBeGreaterThanOrEqual(1)
    expect(detail.rendus).toBeLessThanOrEqual(2)
    expect(detail.passages).toBe(1)
    expect(detail.declencheurs).toContain('conversations')
  })

  it('ouvrir un fil ⇒ le déclencheur nommé est le fil ouvert', async () => {
    const { signaux } = await monter(fils())
    signaux.length = 0
    await act(async () =>
      harness!.container.querySelectorAll<HTMLButtonElement>('.conv-pick')[3]!.click()
    )
    await laisserPasser()

    const avecFilOuvert = signauxListe(signaux).filter(([, , d]) =>
      d?.liste?.declencheurs.includes('fil-ouvert')
    )
    expect(avecFilOuvert.length).toBeGreaterThan(0)
    const lignes = avecFilOuvert.reduce((n, [, , d]) => n + (d?.liste?.lignes ?? 0), 0)
    expect(lignes).toBeGreaterThanOrEqual(1)
    expect(lignes).toBeLessThanOrEqual(4)
  })

  /** 1 349 fils : la base entière chargée d'un bloc, comme au démarrage de l'app. */
  const fils1349 = (): Array<Record<string, unknown>> =>
    Array.from({ length: 1349 }, (_, i) => ({
      ...conversation(`c${i}`),
      messageCount: 1,
      updatedAt: 1_000 + i
    }))

  /** La vue monte avec `store` chargé d'un bloc, comme au démarrage de l'app. */
  function montageDemarrage(
    store: Array<Record<string, unknown>>,
    signaux: Signal[]
  ): Record<string, unknown> {
    return chatApi({
      conversations: vi.fn(async () => structuredClone(store)),
      signalerGelRenderer: vi.fn((...a: unknown[]) => signaux.push(a as Signal))
    })
  }

  /**
   * Les lignes `.conv-item` posées au premier passage. Les minuteurs sont gelés par le test : la
   * liste n'avance pas d'une tranche pendant le comptage, le DOM est donc celui du premier passage.
   */
  async function lignesAuPremierPassage(container: HTMLElement): Promise<number> {
    for (let tour = 0; tour < 100; tour += 1) {
      const posees = container.querySelectorAll('.conv-item').length
      if (posees > 0) return posees
      await act(async () => {
        await new Promise((fin) => setImmediate(fin))
      })
    }
    return 0
  }

  /**
   * Simule une mise en page : la zone `.conv-list` mesure `zone` px, chaque `.conv-item` `ligne` px.
   * Rend la fonction qui remet les propriétés d'origine.
   */
  function mesurerLaZone(zone: number, ligne: number): () => void {
    // happy-dom définit `clientHeight` et `offsetHeight` sur HTMLElement : c'est là qu'il faut les remplacer.
    const avantZone = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const avantLigne = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('conv-list') ? zone : 0
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('conv-item') ? ligne : 0
      }
    })
    return () => {
      remettre(HTMLElement.prototype, 'clientHeight', avantZone)
      remettre(HTMLElement.prototype, 'offsetHeight', avantLigne)
    }
  }

  function remettre(cible: object, nom: string, descripteur: PropertyDescriptor | undefined): void {
    if (descripteur) Object.defineProperty(cible, nom, descripteur)
    else Reflect.deleteProperty(cible, nom)
  }

  /** Minuteurs gelés : la première tranche ne part qu'une fois le premier passage compté. */
  const geler = (): void => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  }

  /**
   * AU DÉMARRAGE, la liste reçoit 1 349 fils d'un coup et les monte tous dans UN seul passage de
   * rendu. ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION SAUTE : cette même liste chargée
   * d'un bloc. Sans mise en page mesurable (banc de test), le premier passage pose le plancher de 40
   * lignes, en tête : le fil le plus récent (`c1348`) y est, le plus ancien (`c0`) pas encore.
   * Compté dans le DOM, pas avec le compteur du gel (`lignes`) : il compte des fils distincts, et
   * « Récent » en reprend certains, si bien qu'une ligne à l'écran n'est pas un fil.
   */
  it('au démarrage, 1 349 fils ⇒ le premier passage pose 40 lignes à l’écran, en tête', async () => {
    geler()
    const signaux: Signal[] = []
    harness = await mountChat(montageDemarrage(fils1349(), signaux))
    const posees = await lignesAuPremierPassage(harness!.container)

    // Le signal porte la durée mesurée par le Profiler de la liste : c'est le chiffre du gel.
    const premier = signauxListe(signaux).find(([, , d]) => (d?.liste?.lignes ?? 0) > 0)
    expect(premier, 'la liste a dessiné des lignes').toBeDefined()
    const [ms, , detail] = premier!
    // fix-ok: cause mesurée — le compteur `lignes` compte des fils, pas les lignes posées : la borne se compte sur le DOM.
    expect(
      posees,
      `premier passage : ${posees} lignes à l’écran, ${detail!.liste!.lignes} fils distincts, ${Math.round(ms)} ms`
    ).toBe(40)
    expect(
      harness!.container.querySelector('.conv-item[data-conversation-id="c1348"]')
    ).not.toBeNull()
    expect(harness!.container.querySelector('.conv-item[data-conversation-id="c0"]')).toBeNull()
  }, 60_000)

  /**
   * LA ZONE VISIBLE COMPTE : une zone de 1 800 px, des lignes de 36 px, tiennent 50 lignes ; avec la
   * marge de 10, le premier passage en pose 60. ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : une mesure
   * retirée, et le premier passage retombe au plancher de 40.
   */
  it('au démarrage, une zone de 1 800 px ⇒ le premier passage pose ce qui y tient, plus la marge', async () => {
    geler()
    const remettreLaZone = mesurerLaZone(1800, 36)
    try {
      harness = await mountChat(montageDemarrage(fils1349(), []))
      expect(await lignesAuPremierPassage(harness!.container)).toBe(60)
    } finally {
      remettreLaZone()
    }
  }, 60_000)

  /**
   * JUMEAU de la mesure : une zone de 300 px (8 lignes) ne descend pas sous le plancher de 40.
   */
  it('au démarrage, une zone de 300 px ⇒ le plancher de 40 lignes tient', async () => {
    geler()
    const remettreLaZone = mesurerLaZone(300, 36)
    try {
      harness = await mountChat(montageDemarrage(fils1349(), []))
      expect(await lignesAuPremierPassage(harness!.container)).toBe(40)
    } finally {
      remettreLaZone()
    }
  }, 60_000)

  /**
   * JUMEAU de la borne ci-dessus : la fenêtre ne doit faire perdre aucun fil. Une fois la liste
   * entièrement dessinée, les 1 349 fils sont dans le DOM, le plus ancien compris.
   */
  it('une fois la liste dessinée, aucun des 1 349 fils ne manque', async () => {
    harness = await mountChat(montageDemarrage(fils1349(), []))
    await laisserPasser()
    await attendreLaListe(harness!.container, 'c0')

    const dessines = new Set(
      Array.from(
        harness!.container.querySelectorAll<HTMLElement>('.conv-item[data-conversation-id]'),
        (el) => el.dataset.conversationId
      )
    )
    expect(dessines.size).toBe(1349)
  }, 60_000)

  /**
   * LE DÉROULÉ NE RELANCE PAS LE CHAT. Compté du premier passage (les premières lignes sont là) jusqu'à
   * la liste entière. Avec l'état du déroulé dans ChatView, chaque tranche relançait tout le chat : un
   * rendu par tranche. Deux rendus de fond restent tolérés (un chargement de fil qui tombe pendant le
   * déroulé). ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : l'état du déroulé remis dans ChatView.
   */
  it('après le premier passage, les tranches ne relancent pas ChatView à chaque fois', async () => {
    let rendusAuPremierPasse: number | undefined
    const observateur = new MutationObserver(() => {
      if (
        rendusAuPremierPasse === undefined &&
        document.querySelectorAll('.conv-item').length > 0
      ) {
        rendusAuPremierPasse = rendusDuChat.nombre
      }
    })
    observateur.observe(document.body, { childList: true, subtree: true })
    const remettreLaZone = mesurerLaZone(400, 44)
    try {
      rendusDuChat.nombre = 0
      harness = await mountChat(montageDemarrage(fils1349(), []))
      expect(rendusAuPremierPasse, 'rendus du chat au premier passage').toBeDefined()
      await attendreLaListe(harness!.container, 'c0')
      expect(
        rendusDuChat.nombre - rendusAuPremierPasse!,
        'rendus du chat pendant le déroulé de la liste'
      ).toBeLessThanOrEqual(2)
    } finally {
      observateur.disconnect()
      remettreLaZone()
    }
  }, 60_000)

  /**
   * CHAQUE TRANCHE SE NOTE « hors-liste » : elle ne change aucune donnée de la liste, seulement le
   * nombre de lignes posées. Le gel d'une tranche doit donc nommer son déclencheur. ENTRÉE QUI DOIT
   * FAIRE ÉCHOUER CE TEST : une tranche qui ne note rien au journal de gel.
   */
  it('chaque tranche de la liste se note « hors-liste » dans le journal de gel', async () => {
    const signaux: Signal[] = []
    harness = await mountChat(montageDemarrage(fils1349(), signaux))
    await attendreLaListe(harness!.container, 'c0')
    await laisserPasser()

    const passages = signauxListe(signaux).filter(([, , d]) => (d?.liste?.lignes ?? 0) > 0)
    expect(passages.length, 'passages qui ont posé des lignes').toBeGreaterThan(2)
    // Le premier passage pose le début de la liste, à partir des données ; chaque tranche d'après, rien.
    for (const [, , detail] of passages.slice(1)) {
      expect(detail!.liste!.declencheurs).toEqual(['hors-liste'])
    }
  }, 60_000)
})
