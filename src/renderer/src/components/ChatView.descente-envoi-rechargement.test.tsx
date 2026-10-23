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
 * Defaut vecu le 2026-10-23 (conv-1128) : « quand j'envoie le message ca doit me scroll down la
 * conv ». Mesure sur l'app reelle (instance cachee, code en cours) : la vue DESCEND bien a l'envoi,
 * puis ~1 s plus tard elle REMONTE a l'endroit ou le lecteur lisait avant d'envoyer.
 *
 * Cause : remonter a la molette retient la position de lecture (`position-lecture.ts`). L'envoi
 * annulait la reprise EN ATTENTE (`positionARestaurerRef`) mais laissait la position RETENUE sur le
 * disque. Juste apres l'envoi, le processus principal emet un `refresh` du fil (il le retitre a
 * chaque message) : `loadConv` relit la position retenue et y ramene le fil.
 *
 * Ce test rejoue la sequence : lecteur remonte a la molette, envoi, puis `refresh` du fil affiche.
 */
describe('ChatView — un rechargement juste apres l envoi ne remonte pas le fil', () => {
  let harness: ChatHarness | undefined

  beforeAll(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reste en bas quand le fil affiche est recharge apres l envoi', async () => {
    const conv = conversation('A', [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'reponse' }
    ])
    // Plusieurs composants s'abonnent aux evenements de l'app : on les sert TOUS.
    const abonnes: Array<(event: Record<string, unknown>) => void> = []
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conv]),
        conversation: vi.fn().mockResolvedValue(conv),
        // Le tour reste EN COURS, comme dans l'app quand le `refresh` arrive : un tour fini tout de
        // suite lancerait la descente de fin de tour, qui masquait le defaut dans ce test.
        pilotChat: vi.fn(() => new Promise(() => {})),
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
    // happy-dom ne calcule aucune mise en page : on FABRIQUE un fil long.
    Object.defineProperty(scroll, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 5000, configurable: true })
    let haut = 0
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => haut,
      set: (valeur: number) => {
        haut = Math.max(0, Math.min(valeur, 4500))
      }
    })
    // Chaque message occupe 1000 px : sans cela, happy-dom place tous les messages au haut de la
    // vue, et la position retenue (ancree sur un message) retomberait toujours sur la position
    // courante — le test passait meme sans correctif.
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
    // La descente d'OUVERTURE vit encore plus d'une seconde (voir ChatView.descente-envoi.test.tsx).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200))
    })

    // LE LECTEUR REMONTE, A LA MOLETTE : sa position de lecture est retenue.
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
      scroll.scrollTop = 1000
      scroll.dispatchEvent(new Event('scroll'))
    })
    expect(localStorage.getItem(CLE_POSITION_LECTURE) ?? '').toContain('"A"')

    await harness.type('un message court')
    const envoyer = [...harness.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (bouton) => bouton.textContent?.trim() === 'Envoyer'
    )
    expect(envoyer).toBeTruthy()
    await act(async () => envoyer!.click())
    // Mesure sur l'app reelle : le `refresh` arrive ~1 s apres l'envoi, descente deja posee.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200))
    })
    expect(scroll.scrollTop).toBe(4500)

    // Le `refresh` du fil affiche, emis par le processus principal juste apres l'envoi.
    await act(async () => {
      for (const abonne of abonnes) abonne({ type: 'refresh', scope: 'chat', convId: 'A' })
    })
    // Le rechargement ne se peint qu'a la sortie du bloc precedent : on attend APRES lui.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })

    // ON MESURE OU LE FIL S'ARRETE : en bas, sur le message envoye.
    expect(scroll.scrollTop).toBe(4500)
  })
})
