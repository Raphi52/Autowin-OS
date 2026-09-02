// @vitest-environment happy-dom
/**
 * REPONDRE A UNE QUESTION DEPUIS UNE FENETRE DE MOSAIQUE (conv-50, 2026-09-01).
 *
 * Meme symptome que le defaut vecu dans le fil unique — « j'ai répondu a la question et ca a rien
 * fait » — par un autre chemin : la mosaique rendait `ChatMessageRow` sans destinataire de reponse.
 * Le clic ne pouvait RIEN envoyer. La reponse doit partir vers la conversation de CETTE fenetre,
 * pas vers la conversation active.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'
import type { Msg } from './chat-view-types'

/**
 * Le bloc de decision n'existe QU'UNE FOIS LE TOUR TERMINE (`ChatMessageRow`, 2026-09-02) : un clic
 * avant la fin passait par une injection qui n'etait plus relue, donc la reponse etait perdue
 * pendant que le bloc se verrouillait sur « Repondu ». Le tour est donc CLOS ici — c'est l'etat
 * dans lequel une question est reellement cliquable.
 */
const askAssistant = (done = true): Msg =>
  ({
    role: 'assistant',
    content: '',
    done,
    parts: [
      {
        kind: 'action',
        name: 'ask',
        ok: true,
        data: { question: 'On garde laquelle ?', options: ['Garder A', 'Garder B'] }
      }
    ]
  }) as unknown as Msg

const fenetre = (id: string, tourClos = true): ChatMosaicWindow => ({
  id,
  title: id,
  messages: [{ role: 'user', content: 'compare' } as Msg, askAssistant(tourClos)],
  busy: !tourClos
})

function monter(node: React.JSX.Element): HTMLElement {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  act(() => {
    createRoot(hote).render(node)
  })
  return hote
}

describe('ChatMosaic — une question posée dans une fenêtre est répondable', () => {
  it('le clic envoie la réponse vers la conversation de CETTE fenêtre', () => {
    const onAnswerAsk = vi.fn()
    const hote = monter(
      <ChatMosaic
        fenetres={[fenetre('a'), fenetre('b')]}
        onClose={vi.fn()}
        onOuvrirSeule={vi.fn()}
        rendreComposer={() => null}
        onNouvelleConversation={vi.fn()}
        onAnswerAsk={onAnswerAsk}
      />
    )

    const choix = hote.querySelectorAll<HTMLButtonElement>('[data-conv-id="b"] button.askd-choix')
    expect(choix.length).toBeGreaterThan(0)
    act(() => choix[1].click())

    expect(onAnswerAsk).toHaveBeenCalledTimes(1)
    expect(onAnswerAsk).toHaveBeenCalledWith('Garder B', 'b')
  })

  it('ne propose rien tant que le tour de la fenêtre n’est pas terminé', () => {
    const hote = monter(
      <ChatMosaic
        fenetres={[fenetre('a', false)]}
        onClose={vi.fn()}
        onOuvrirSeule={vi.fn()}
        rendreComposer={() => null}
        onNouvelleConversation={vi.fn()}
        onAnswerAsk={vi.fn()}
      />
    )
    expect(hote.querySelectorAll('[data-conv-id="a"] button.askd-choix').length).toBe(0)
  })
})
