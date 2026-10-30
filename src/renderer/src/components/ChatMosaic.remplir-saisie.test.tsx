// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
/**
 * BOUTON DE CHOIX D'UNE PAGE INTERACTIVE DANS UNE FENETRE DE MOSAIQUE (conv-1304, 2026-10-30).
 *
 * Un lien `#autowin-prompt` d'un bloc ```html-interactif REMPLIT la saisie (saisie-du-fil.ts). En
 * mosaique, chaque fenetre a sa saisie : le texte doit aller dans celle de la fenetre OU la page a
 * ete cliquee, jamais dans celle d'une autre conversation.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'
import type { Msg } from './chat-view-types'
import { TYPE_MESSAGE_SCENE_3D } from '../../../shared/scene-3d'

const PAGE = '```html-interactif\n<a href="#autowin-prompt">Affiner la 2</a>\n```'

const fenetre = (id: string): ChatMosaicWindow => ({
  id,
  title: id,
  messages: [
    { role: 'user', content: 'propose' } as Msg,
    {
      role: 'assistant',
      content: PAGE,
      done: true,
      parts: [{ kind: 'text', text: PAGE }]
    } as unknown as Msg
  ],
  busy: false
})

/** Toujours a l'ecran : la page est montee tout de suite. */
class Visible {
  private readonly rappel: IntersectionObserverCallback
  constructor(rappel: IntersectionObserverCallback) {
    this.rappel = rappel
  }
  observe(cible: Element): void {
    this.rappel(
      [{ isIntersecting: true, target: cible } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
  disconnect(): void {
    // Rien a liberer.
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ChatMosaic — un choix de page interactive remplit la saisie de SA fenêtre', () => {
  it('pose le texte dans la saisie de la fenêtre cliquée, sans rien envoyer', () => {
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: true } })
    vi.stubGlobal('IntersectionObserver', Visible)
    const onRemplirSaisie = vi.fn()
    const onAnswerAsk = vi.fn()
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    act(() => {
      createRoot(hote).render(
        <ChatMosaic
          fenetres={[fenetre('a'), fenetre('b')]}
          onClose={vi.fn()}
          onOuvrirSeule={vi.fn()}
          rendreComposer={() => null}
          onNouvelleConversation={vi.fn()}
          onAnswerAsk={onAnswerAsk}
          onRemplirSaisie={onRemplirSaisie}
        />
      )
    })
    const cadre = hote.querySelector<HTMLIFrameElement>(
      '[data-conv-id="b"] [data-testid="html-interactif-cadre"]'
    )
    expect(cadre).not.toBeNull()
    const faux = { postMessage: vi.fn() }
    Object.defineProperty(cadre, 'contentWindow', { configurable: true, get: () => faux })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: TYPE_MESSAGE_SCENE_3D, etat: 'prompt', texte: 'Affiner la 2' },
          source: faux as unknown as Window
        })
      )
    })
    expect(onRemplirSaisie).toHaveBeenCalledTimes(1)
    expect(onRemplirSaisie).toHaveBeenCalledWith('Affiner la 2', 'b')
    expect(onAnswerAsk).not.toHaveBeenCalled()
  })
})
