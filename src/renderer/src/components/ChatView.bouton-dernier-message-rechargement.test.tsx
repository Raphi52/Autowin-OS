// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'
import { CLE_POSITION_LECTURE } from './position-lecture'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/**
 * Suite du defaut du 2026-10-23 (conv-1128, `ChatView.descente-envoi-rechargement.test.tsx`) :
 * le bouton « ↓ Dernier message » descend au bas du fil, mais un rechargement du fil qui suit
 * peut le REMONTER a l'endroit ou le lecteur lisait.
 *
 * Mecanisme : le clic n'effacait pas la position de lecture retenue. Elle ne partait que si un
 * evenement `scroll` arrivait au bas PENDANT que le drapeau « geste du lecteur » etait leve. Or
 * ce drapeau retombe des que l'app bouge le fil elle-meme — ici, la reprise de lecture faite par
 * un premier rechargement. Le clic suivant descend alors sans rien effacer, et le rechargement
 * d'apres (`loadConv`) relit l'ancienne position et y ramene le fil.
 *
 * Le test simule un navigateur : chaque changement de `scrollTop` emet un vrai `scroll` a la
 * frame suivante — sans cela, le test serait rouge pour une mauvaise raison.
 */
describe('ChatView — le bouton « ↓ Dernier message » tient le bas apres un rechargement', () => {
  let harness: ChatHarness | undefined

  beforeAll(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reste en bas quand le fil est recharge apres un clic sur le bouton', async () => {
    const conv = conversation('A', [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'reponse' },
      { role: 'user', content: 'relance' },
      { role: 'assistant', content: 'suite' }
    ])
    // Plusieurs composants s'abonnent aux evenements de l'app : on les sert TOUS.
    const abonnes: Array<(event: Record<string, unknown>) => void> = []
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conv]),
        conversation: vi.fn().mockResolvedValue(conv),
        onAppEvent: vi.fn((listener: (event: Record<string, unknown>) => void) => {
          abonnes.push(listener)
          return vi.fn()
        })
      })
    )
    await harness.click('.conv-pick')
    expect(abonnes.length).toBeGreaterThan(0)

    const scroll = harness.container.querySelector('.chat-scroll') as HTMLElement
    expect(scroll).toBeTruthy()
    // happy-dom ne calcule aucune mise en page : on FABRIQUE un fil long (4 messages de 1000 px).
    Object.defineProperty(scroll, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 5000, configurable: true })
    let haut = 0
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => haut,
      set: (valeur: number) => {
        haut = Math.max(0, Math.min(valeur, 4500))
        // Comme un navigateur : le `scroll` part a la frame suivante, pas pendant l'affectation.
        window.setTimeout(() => scroll.dispatchEvent(new Event('scroll')), 0)
      }
    })
    const rectangleNatif = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      if (!this.classList.contains('msg')) return rectangleNatif.call(this)
      const rang = [...scroll.querySelectorAll('.msg')].indexOf(this)
      return new DOMRect(0, rang * 1000 - haut, 600, 1000)
    })
    scroll.scrollTo = ((options: ScrollToOptions) => {
      scroll.scrollTop = options.top ?? 0
    }) as HTMLElement['scrollTo']
    const attendre = async (ms: number): Promise<void> => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms))
      })
    }
    const recharger = async (): Promise<void> => {
      await act(async () => {
        for (const abonne of abonnes) abonne({ type: 'refresh', scope: 'chat', convId: 'A' })
      })
      // Le rechargement ne se peint qu'a la sortie du bloc precedent : on attend APRES lui.
      await attendre(400)
    }
    // La descente d'OUVERTURE vit encore plus d'une seconde (voir ChatView.descente-envoi.test.tsx).
    await attendre(1200)
    expect(scroll.scrollTop).toBe(4500)

    // LE LECTEUR REMONTE, A LA MOLETTE : sa position de lecture est retenue.
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
      scroll.scrollTop = 1000
    })
    await attendre(50)
    expect(localStorage.getItem(CLE_POSITION_LECTURE) ?? '').toContain('"A"')

    // Un premier rechargement (fil retitre, mis a jour) le laisse a sa lecture : c'est voulu.
    await recharger()
    expect(scroll.scrollTop).toBe(1000)

    // IL CLIQUE « ↓ Dernier message » : le fil descend au bas.
    const bouton = harness.container.querySelector<HTMLButtonElement>('.chat-jump-latest')
    expect(bouton?.textContent).toContain('Dernier message')
    await act(async () => bouton!.click())
    await attendre(200)
    expect(scroll.scrollTop).toBe(4500)

    // Un rechargement suivant ne doit PAS le ramener a l'ancienne lecture.
    await recharger()
    expect(scroll.scrollTop).toBe(4500)
  })
})
