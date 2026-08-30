// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'
import { colonnesPour } from './chat-mosaic-grille'

const fenetre = (id: string, titre: string, busy = false): ChatMosaicWindow => ({
  id,
  title: titre,
  messages: [{ role: 'user', content: `bonjour ${id}` }],
  busy
})

/** Le VRAI composer est fabrique par ChatView ; ici on verifie seulement qu'il est monte PAR FENETRE. */
const composerFactice = (id: string): React.ReactNode => (
  <textarea data-testid={`composer-${id}`} aria-label={`Message pour ${id}`} />
)

function monter(node: React.JSX.Element): HTMLElement {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  act(() => {
    createRoot(hote).render(node)
  })
  return hote
}

describe('ChatMosaic', () => {
  it('la grille suit le NOMBRE de fenetres ouvertes', () => {
    expect(colonnesPour(1)).toBe(1)
    expect(colonnesPour(2)).toBe(2)
    expect(colonnesPour(4)).toBe(2)
    expect(colonnesPour(5)).toBe(3)
  })

  it('rend une fenetre de chat, avec SON composer, par conversation ouverte', () => {
    const hote = monter(
      <ChatMosaic
        fenetres={[fenetre('a', 'Alpha'), fenetre('b', 'Beta')]}
        onClose={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
      />
    )
    expect(hote.querySelectorAll('.chat-mosaic-window')).toHaveLength(2)
    // Un composer PAR fenetre : c'est ce qui distingue une mini-fenetre d'une vignette.
    expect(hote.querySelector('[data-conv-id="a"] [data-testid="composer-a"]')).not.toBeNull()
    expect(hote.querySelector('[data-conv-id="b"] [data-testid="composer-b"]')).not.toBeNull()
  })

  it('ferme la fenetre visee, et elle seule', () => {
    const onClose = vi.fn()
    const hote = monter(
      <ChatMosaic
        fenetres={[fenetre('a', 'Alpha'), fenetre('b', 'Beta')]}
        onClose={onClose}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
      />
    )
    act(() => {
      hote.querySelector<HTMLButtonElement>('[data-conv-id="a"] .chat-mosaic-window-close')!.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('a')
  })

  it('offre de creer une conversation, meme quand aucune fenetre n est ouverte', () => {
    const onNouvelle = vi.fn()
    const vide = monter(
      <ChatMosaic
        fenetres={[]}
        onClose={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={onNouvelle}
      />
    )
    act(() => {
      vide.querySelector<HTMLButtonElement>('[data-testid="chat-mosaic-new"]')!.click()
    })
    expect(onNouvelle).toHaveBeenCalledTimes(1)
  })

  it('n affiche aucun bouton nouvelle conversation quand des fenetres sont ouvertes', () => {
    const hote = monter(
      <ChatMosaic
        fenetres={[fenetre('a', 'Alpha')]}
        onClose={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
      />
    )
    expect(hote.querySelector('[data-testid="chat-mosaic-new"]')).toBeNull()
  })

  it('signale la fenetre occupee', () => {
    const hote = monter(
      <ChatMosaic
        fenetres={[fenetre('a', 'Alpha', true), fenetre('b', 'Beta')]}
        onClose={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
      />
    )
    expect(hote.querySelector('[data-conv-id="a"] .chat-mosaic-window-busy')).not.toBeNull()
    expect(hote.querySelector('[data-conv-id="b"] .chat-mosaic-window-busy')).toBeNull()
  })
it("colore la bordure de la fenetre dont le tour VIENT de se terminer, jusqu au retour de l utilisateur", () => {
    const hote = document.createElement("div")
    document.body.appendChild(hote)
    const root = createRoot(hote)
    const rendre = (busyA: boolean): void => {
      act(() => {
        root.render(
          <ChatMosaic
            fenetres={[fenetre("a", "Alpha", busyA), fenetre("b", "Beta")]}
            onClose={vi.fn()}
            rendreComposer={composerFactice}
            onNouvelleConversation={vi.fn()}
          />
        )
      })
    }
    rendre(true)
    const caseA = (): HTMLElement => hote.querySelector("[data-conv-id=\"a\"]") as HTMLElement
    expect(caseA().dataset.etat).toBe("occupe")
    rendre(false)
    expect(caseA().dataset.etat).toBe("attention")
    expect((hote.querySelector("[data-conv-id=\"b\"]") as HTMLElement).dataset.etat).toBeUndefined()
    act(() => {
      caseA().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(caseA().dataset.etat).toBeUndefined()
  })
})
