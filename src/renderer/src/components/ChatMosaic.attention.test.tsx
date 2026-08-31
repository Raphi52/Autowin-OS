// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'
import { lireConversationsEnAttente, viderConversationsEnAttente } from './conversations-attention'

/**
 * La mosaique PUBLIE son etat d'attention : sans cela, le cadre dore n'existe que dans le
 * `useState` local de la fenetre et l'accueil ne peut rien afficher.
 */
const fenetre = (id: string, titre: string, busy = false): ChatMosaicWindow => ({
  id,
  title: titre,
  messages: [{ role: 'user', content: 'bonjour' }],
  busy
})

const composerFactice = (id: string): React.ReactNode => <textarea data-testid={`c-${id}`} />

let hote: HTMLElement
let racine: ReturnType<typeof createRoot>

function rendre(fenetres: ChatMosaicWindow[]): void {
  act(() => {
    racine.render(
      <ChatMosaic
        fenetres={fenetres}
        onClose={vi.fn()}
        onOuvrirSeule={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
      />
    )
  })
}

beforeEach(() => {
  viderConversationsEnAttente()
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  viderConversationsEnAttente()
})

describe('ChatMosaic — publication de l etat attention', () => {
  it('publie la conversation quand son tour se TERMINE, et pas celle qui tourne encore', () => {
    rendre([fenetre('a', 'Alpha', true), fenetre('b', 'Beta', true)])
    expect(lireConversationsEnAttente()).toEqual([])
    // Seule `a` finit. `b` tourne toujours : c'est l'entree qui ferait echouer une publication
    // qui marquerait TOUTES les fenetres au lieu de celle qui vient de finir.
    rendre([fenetre('a', 'Alpha'), fenetre('b', 'Beta', true)])
    expect(lireConversationsEnAttente().map((c) => c.id)).toEqual(['a'])
    expect(lireConversationsEnAttente()[0].titre).toBe('Alpha')
  })

  it('retire la conversation des que l utilisateur touche SA fenetre', () => {
    rendre([fenetre('a', 'Alpha', true), fenetre('b', 'Beta', true)])
    rendre([fenetre('a', 'Alpha'), fenetre('b', 'Beta')])
    expect(lireConversationsEnAttente().map((c) => c.id)).toEqual(['a', 'b'])
    const fenetreA = hote.querySelector('[data-conv-id="a"]') as HTMLElement
    act(() => {
      fenetreA.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    // `b`, non touchee, SURVIT.
    expect(lireConversationsEnAttente().map((c) => c.id)).toEqual(['b'])
  })
})
