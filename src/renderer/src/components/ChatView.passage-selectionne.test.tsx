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
 * RÉPONDRE À UN PASSAGE, DE BOUT EN BOUT (conv-1038, 2026-10-21) : sélectionner un bout de
 * réponse fait apparaître une barre « Citer · Détaille · C'est faux · Retiens ça » ; un clic pose le
 * texte dans la saisie, SANS envoyer. Avant, aucune sélection n'était gérée : l'utilisateur
 * retapait le passage qu'il voulait contester.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const REPONSE = 'La cause est un cache périmé. Il faut le vider.'

const historique = [
  { role: 'user', content: 'pourquoi ça casse ?', ts: 1, messageId: 'm-1' },
  {
    role: 'assistant',
    content: REPONSE,
    ts: 2,
    messageId: 'm-2',
    turnId: 'tour-1',
    status: 'completed',
    parts: [{ kind: 'text', text: REPONSE }]
  }
]

describe('ChatView — répondre à un passage sélectionné', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>

  beforeEach(async () => {
    window.localStorage.clear()
    api = chatApi({ conversations: vi.fn().mockResolvedValue([conversation('A', historique)]) })
    h = await mountChat(api)
    await h.click('.conv-pick')
  })

  afterEach(async () => {
    window.getSelection()?.removeAllRanges()
    await h?.unmount()
    h = null
  })

  /** Sélectionne `extrait` dans le texte de la réponse affichée, puis relâche la souris. */
  async function selectionnerDansLaReponse(extrait: string): Promise<void> {
    const marcheur = document.createTreeWalker(h!.container, NodeFilter.SHOW_TEXT)
    let noeud: Node | null = marcheur.nextNode()
    while (noeud && !(noeud.textContent ?? '').includes(REPONSE)) noeud = marcheur.nextNode()
    expect(noeud).toBeTruthy()
    const debut = noeud!.textContent!.indexOf(extrait)
    const range = document.createRange()
    range.setStart(noeud!, debut)
    range.setEnd(noeud!, debut + extrait.length)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => {
      noeud!.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
  }

  const barre = (): HTMLElement | null =>
    h!.container.querySelector('[data-testid="barre-passage"]')

  it('sélection dans une réponse : la barre propose les quatre gestes', async () => {
    expect(barre()).toBeNull()
    await selectionnerDansLaReponse('un cache périmé')
    const libelles = [...(barre()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
    expect(libelles).toEqual(['Citer', 'Détaille', 'C’est faux', 'Retiens ça'])
  })

  it('« Citer » pose le passage en citation dans la saisie, sans envoyer', async () => {
    await selectionnerDansLaReponse('un cache périmé')
    await h!.click('[data-testid="barre-passage"] button[data-action="citer"]')
    expect(h!.textarea().value).toBe('> un cache périmé\n\n')
    expect(api.pilotChat).not.toHaveBeenCalled()
    expect(barre()).toBeNull()
  })

  it('« C’est faux » sur un brouillon déjà écrit : le brouillon reste, la contestation suit', async () => {
    await h!.type('ma remarque')
    await selectionnerDansLaReponse('Il faut le vider.')
    await h!.click('[data-testid="barre-passage"] button[data-action="faux"]')
    expect(h!.textarea().value).toBe(
      'ma remarque\n\nCe passage me paraît faux — vérifie-le et corrige-le :\n> Il faut le vider.'
    )
  })

  it('simple clic dans le fil (sélection vide) : aucune barre', async () => {
    const marcheur = document.createTreeWalker(h!.container, NodeFilter.SHOW_TEXT)
    let noeud: Node | null = marcheur.nextNode()
    while (noeud && !(noeud.textContent ?? '').includes(REPONSE)) noeud = marcheur.nextNode()
    const range = document.createRange()
    range.setStart(noeud!, 3)
    range.setEnd(noeud!, 3)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => {
      noeud!.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(barre()).toBeNull()
  })
})
