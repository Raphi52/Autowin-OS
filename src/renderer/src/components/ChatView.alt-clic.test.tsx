// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installerAltClic, poserElementCible } from './alt-clic'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * ALT+CLIC, DE BOUT EN BOUT (conv-1038, 2026-10-21 ; toute l'app, conv-1338, 2026-10-30) : Alt+clic
 * sur un élément pose dans la saisie une référence exacte (texte affiché, bloc, source, fil, tour),
 * joint sa capture, sans envoyer et sans déclencher l'élément cliqué.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

// L'encodage réel passe par un <canvas> de miniature : hors sujet ici.
vi.mock('./chat-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-attachments')>()
  return {
    ...original,
    encodeAttachment: vi.fn(async (file: File) => ({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: 'image' as const,
      content: 'YWJj',
      thumbnail: 'data:image/png;base64,YWJj'
    }))
  }
})

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

const reglerEtAttendre = async (): Promise<void> => {
  await act(async () => {
    await new Promise((fin) => setTimeout(fin, 0))
  })
}

async function cliquer(element: Element, altKey: boolean): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey }))
  })
  await reglerEtAttendre()
}

describe('ChatView — Alt+clic sur un élément', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>
  let retirer: () => void
  let ouvrirChat: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    window.localStorage.clear()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 110,
      bottom: 70
    } as DOMRect)
    api = chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A', historique)]),
      conversationsFork: vi.fn().mockResolvedValue(undefined),
      capturerElement: vi.fn().mockResolvedValue('data:image/png;base64,QUJD'),
      getZoomFactor: () => 1
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
    ouvrirChat = vi.fn()
    retirer = installerAltClic(ouvrirChat)
  })

  afterEach(async () => {
    retirer()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  function texteDeLaReponse(): HTMLElement {
    const marcheur = document.createTreeWalker(h!.container, NodeFilter.SHOW_TEXT)
    let noeud: Node | null = marcheur.nextNode()
    while (noeud && noeud.textContent !== REPONSE) noeud = marcheur.nextNode()
    expect(noeud).toBeTruthy()
    return noeud!.parentElement!
  }

  const puces = (): Element[] => [
    ...h!.container.querySelectorAll('.attachment-list.pending .attachment-chip')
  ]

  it('Alt+clic sur le texte d’une réponse : la référence du fil et du tour arrive dans la saisie', async () => {
    await cliquer(texteDeLaReponse(), true)
    const saisie = h!.textarea().value
    expect(saisie.startsWith('Élément ciblé [élément pointé : « Bloc chelou affiché ici. »')).toBe(
      true
    )
    expect(saisie).toContain('fil A')
    expect(saisie).toContain('tour tour-1')
    expect(saisie).toContain('src/renderer/src/components/ChatMessageRow.tsx')
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('la capture de l’élément arrive en pièce jointe', async () => {
    await cliquer(texteDeLaReponse(), true)
    expect(puces()).toHaveLength(1)
    expect(puces()[0].textContent).toMatch(/element-[a-z0-9]+\.png/u)
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
    expect(puces()).toHaveLength(0)
  })

  it('un brouillon déjà écrit n’est pas écrasé : la référence s’y ajoute', async () => {
    await h!.type('met une croix ici')
    await cliquer(texteDeLaReponse(), true)
    expect(h!.textarea().value).toMatch(/^met une croix ici\n\nÉlément ciblé \[/u)
  })

  it('double-clic ou élément recliqué : une seule référence, une seule image', async () => {
    await cliquer(texteDeLaReponse(), true)
    await cliquer(texteDeLaReponse(), true)
    expect(h!.textarea().value.match(/Élément ciblé \[/gu)).toHaveLength(1)
    expect(puces()).toHaveLength(1)
  })

  it('deux éléments différents : deux références, deux images', async () => {
    await cliquer(texteDeLaReponse(), true)
    await cliquer(
      h!.container.querySelector('button[aria-label="Créer une branche à partir de ce message"]')!,
      true
    )
    expect(h!.textarea().value.match(/Élément ciblé \[/gu)).toHaveLength(2)
    expect(puces()).toHaveLength(2)
  })

  it('plafond de pièces jointes atteint : le texte reste, l’image est refusée et le dit', async () => {
    await act(async () => {
      for (let rang = 0; rang < 8; rang += 1)
        poserElementCible({
          texte: `élément ${rang}`,
          image: new File([`image ${rang}`], `piece-${rang}.png`, { type: 'image/png' })
        })
    })
    await reglerEtAttendre()
    expect(puces()).toHaveLength(8)
    await cliquer(texteDeLaReponse(), true)
    expect(h!.textarea().value).toContain('Élément ciblé [')
    expect(puces()).toHaveLength(8)
    expect(h!.container.textContent).toContain('Maximum 8 fichiers par message.')
  })
})

describe('ChatView — l’élément arrive quand le chat n’était pas encore ouvert', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null

  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  it('deux clics avant le premier affichage du chat : aucun n’est perdu, dans l’ordre', async () => {
    window.localStorage.clear()
    poserElementCible({ texte: 'Élément ciblé [premier]', image: null })
    poserElementCible({ texte: 'Élément ciblé [second]', image: null })
    h = await mountChat(chatApi())
    await reglerEtAttendre()
    expect(h.textarea().value).toBe('Élément ciblé [premier]\n\nÉlément ciblé [second]')
  })

  const chatAvecUnFil = (): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A', historique)]),
      conversation: vi.fn(async (id: string) => conversation(id, historique))
    })

  // Au démarrage, le chat rouvre le dernier fil : écouter trop tôt posait le texte dans le brouillon
  // « nouveau fil », que cette ouverture cachait aussitôt (saisie vide à l'écran).
  it('le chat rouvre le dernier fil au démarrage : le texte arrive dans CE fil, visible', async () => {
    window.localStorage.clear()
    poserElementCible({ texte: 'Élément ciblé [depuis Réglages]', image: null })
    h = await mountChat(chatAvecUnFil())
    await reglerEtAttendre()
    await reglerEtAttendre()
    expect(
      h.container
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-active-conversation-id')
    ).toBe('A')
    expect(h.textarea().value).toBe('Élément ciblé [depuis Réglages]')
  })

  it('un brouillon resté sur ce fil n’est pas effacé au démarrage', async () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      'autowin.chat.brouillons',
      JSON.stringify({ A: 'met une croix ici' })
    )
    poserElementCible({ texte: 'Élément ciblé [barre]', image: null })
    h = await mountChat(chatAvecUnFil())
    await reglerEtAttendre()
    await reglerEtAttendre()
    expect(h.textarea().value).toBe('met une croix ici\n\nÉlément ciblé [barre]')
  })

  it('le chat dont la liste des fils échoue : l’élément arrive quand même', async () => {
    window.localStorage.clear()
    poserElementCible({ texte: 'Élément ciblé [sans liste]', image: null })
    h = await mountChat(
      chatApi({ conversations: vi.fn().mockRejectedValue(new Error('hors ligne')) })
    )
    await reglerEtAttendre()
    await reglerEtAttendre()
    expect(h.textarea().value).toBe('Élément ciblé [sans liste]')
  })
})

describe('ChatView — Alt+clic en mosaïque', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let retirer: () => void

  beforeEach(async () => {
    window.localStorage.clear()
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', JSON.stringify(['A', 'B']))
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
        conversation: vi.fn(async (id: string) => conversation(id, historique))
      })
    )
    await reglerEtAttendre()
    retirer = installerAltClic(vi.fn())
  })

  afterEach(async () => {
    retirer()
    await h?.unmount()
    h = null
    window.localStorage.clear()
  })

  const fenetre = (id: string): Element =>
    h!.container.querySelector(`.chat-mosaic-window[data-conv-id="${id}"]`)!
  const saisie = (id: string): string =>
    (fenetre(id).querySelector('textarea') as HTMLTextAreaElement).value

  it('le texte va dans la saisie de la fenêtre cliquée, pas dans celle du fil actif', async () => {
    await cliquer(fenetre('B').querySelector('.chat-mosaic-window-head')!, true)
    expect(saisie('B')).toContain('Élément ciblé [')
    expect(saisie('B')).toContain('fil B')
    expect(saisie('A')).toBe('')
  })

  it('un élément venu d’une autre vue : il atterrit dans une fenêtre à l’écran', async () => {
    await act(async () => {
      poserElementCible({ texte: 'Élément ciblé [depuis Réglages]', image: null })
    })
    await reglerEtAttendre()
    expect([saisie('A'), saisie('B')]).toContain('Élément ciblé [depuis Réglages]')
  })
})
