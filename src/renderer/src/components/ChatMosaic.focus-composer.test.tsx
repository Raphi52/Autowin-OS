// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'

/**
 * Demandé le 2026-09-06 : cliquer dans une fenêtre de la mosaïque doit poser le curseur dans SON
 * champ de saisie — même réflexe que le chat plein écran — sans voler le focus aux boutons.
 */
const fenetre = (id: string): ChatMosaicWindow => ({
  id,
  title: id,
  messages: [{ role: 'user', content: 'bonjour' }],
  busy: false
})

const composerFactice = (id: string): React.ReactNode => <textarea data-testid={`c-${id}`} />

let hote: HTMLElement
let racine: ReturnType<typeof createRoot>
const onClose = vi.fn()

function rendre(): void {
  act(() => {
    racine.render(
      <ChatMosaic
        fenetres={[fenetre('a'), fenetre('b')]}
        onClose={onClose}
        onOuvrirSeule={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
      />
    )
  })
}

const champ = (id: string): HTMLTextAreaElement =>
  hote.querySelector(`[data-testid="c-${id}"]`) as HTMLTextAreaElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  rendre()
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

describe('ChatMosaic — cliquer une fenêtre focalise son champ', () => {
  it('focalise le champ de LA fenêtre cliquée, pas celui des autres', () => {
    const fil = hote.querySelectorAll('.chat-mosaic-window-thread')[1] as HTMLElement
    act(() => fil.click())
    expect(document.activeElement).toBe(champ('b'))
  })

  it('ne vole PAS le focus quand on clique un bouton de la fenêtre', () => {
    const fermer = hote.querySelectorAll('.chat-mosaic-window-close')[0] as HTMLElement
    act(() => fermer.click())
    expect(onClose).toHaveBeenCalledWith('a')
    expect(document.activeElement).not.toBe(champ('a'))
  })
})
