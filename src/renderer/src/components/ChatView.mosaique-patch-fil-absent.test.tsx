// @vitest-environment happy-dom
/**
 * UN CACHE ABSENT N'EST PAS UN FIL VIDE — la fenetre de mosaique ne doit pas s'effacer.
 *
 * Le handler `refresh` retire le fil du cache d'affichage le temps de le relire sur le disque.
 * Si un evenement du tour (`done`) arrive PENDANT cette relecture, `patchLast` n'avait rien a
 * modifier et publiait le tableau vide qui en resultait : la fenetre de mosaique passait a
 * « Aucun message. » avant de se repeindre — le clignotement signale par l'utilisateur.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { CLE_DERNIERE_CONVERSATION } from './derniere-conversation'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): null => null
}))

type Ecouteur = (event: unknown) => void

describe('ChatView — evenement de tour pendant une relecture', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it("n'efface pas la fenetre de mosaique quand le cache du fil a ete retire", async () => {
    const fil = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'reponse-visible' }
    ]
    const conv = conversation('A', fil)
    // La relecture declenchee par `refresh` reste EN VOL : c'est la fenetre de course a reproduire.
    let relectureBloquee = false
    const ecouteursPilote: Ecouteur[] = []
    const ecouteursApp: Ecouteur[] = []
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["A"]')
    window.localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'A')
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conv]),
        conversation: vi.fn(
          () => (relectureBloquee ? new Promise(() => {}) : Promise.resolve(conv))
        ),
        onPilotEvent: vi.fn((ecouteur: Ecouteur) => {
          ecouteursPilote.push(ecouteur)
          return vi.fn()
        }),
        onAppEvent: vi.fn((ecouteur: Ecouteur) => {
          ecouteursApp.push(ecouteur)
          return vi.fn()
        })
      })
    )
    const fenetre = (): Element => h!.container.querySelector('[data-conv-id="A"]')!
    expect(fenetre().textContent).toContain('reponse-visible')

    // 1) Un tour commence : la conversation devient occupee cote vue.
    await act(async () => {
      for (const ecouteur of ecouteursPilote)
        ecouteur({ conversationId: 'A', kind: 'delta', text: 'suite' })
    })
    // 2) Un `refresh` retire le fil du cache ; la relecture ne rend pas la main.
    relectureBloquee = true
    await act(async () => {
      for (const ecouteur of ecouteursApp)
        ecouteur({ type: 'refresh', scope: 'chat', convId: 'A' })
    })
    // 3) La fin du tour arrive PENDANT la relecture.
    await act(async () => {
      for (const ecouteur of ecouteursPilote) ecouteur({ conversationId: 'A', kind: 'done' })
    })

    expect(fenetre().textContent).toContain('reponse-visible')
    expect(fenetre().textContent).not.toContain('Aucun message.')
  })
})
