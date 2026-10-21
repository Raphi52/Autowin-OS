// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * « C'EST QUOI ÇA ? », DE BOUT EN BOUT (conv-1038, 2026-10-21) : Alt+clic sur un élément du chat
 * pose dans la saisie une référence exacte (texte affiché, bloc, source, fil, tour), sans envoyer
 * et sans déclencher l'élément cliqué.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const REPONSE = 'Bloc chelou affiché ici.'

const historique = [
  { role: 'user', content: 'lance le travail', ts: 1, messageId: 'm-1' },
  {
    role: 'assistant',
    content: REPONSE,
    ts: 2,
    messageId: 'm-2',
    turnId: 'tour-1',
    status: 'completed',
    done: true,
    parts: [{ kind: 'text', text: REPONSE }]
  }
]

describe('ChatView — Alt+clic « C’est quoi ça ? »', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>

  beforeEach(async () => {
    window.localStorage.clear()
    api = chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A', historique)]),
      conversationsFork: vi.fn().mockResolvedValue(undefined)
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
  })

  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  function texteDeLaReponse(): HTMLElement {
    const marcheur = document.createTreeWalker(h!.container, NodeFilter.SHOW_TEXT)
    let noeud: Node | null = marcheur.nextNode()
    while (noeud && noeud.textContent !== REPONSE) noeud = marcheur.nextNode()
    expect(noeud).toBeTruthy()
    return noeud!.parentElement!
  }

  async function cliquer(element: Element, altKey: boolean): Promise<void> {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey }))
    })
  }

  it('Alt+clic sur le texte d’une réponse : la référence du fil et du tour arrive dans la saisie', async () => {
    await cliquer(texteDeLaReponse(), true)
    const saisie = h!.textarea().value
    expect(
      saisie.startsWith('C’est quoi ça ? [élément pointé : « Bloc chelou affiché ici. »')
    ).toBe(true)
    expect(saisie).toContain('fil A')
    expect(saisie).toContain('tour tour-1')
    expect(saisie).toContain('src/renderer/src/components/ChatMessageRow.tsx')
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('Alt+clic sur le bouton « brancher » : référence posée, et la branche N’EST PAS créée', async () => {
    const bouton = h!.container.querySelector(
      'button[aria-label="Créer une branche à partir de ce message"]'
    )!
    await cliquer(bouton, true)
    expect(h!.textarea().value).toContain('bouton « Créer une branche à partir de ce message »')
    expect(api.conversationsFork).not.toHaveBeenCalled()
  })

  // Jumeau : le MÊME clic sans Alt garde son comportement — aucune référence.
  it('clic ordinaire (sans Alt) sur le même texte : la saisie reste vide', async () => {
    await cliquer(texteDeLaReponse(), false)
    expect(h!.textarea().value).toBe('')
  })
})
