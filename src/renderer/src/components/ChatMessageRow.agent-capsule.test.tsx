// @vitest-environment happy-dom
/**
 * Capsule « Agent » (Fumé net · Agent assorti, conv-173, 2026-10-10 : « Agent assorti implémente
 * c magnifique »). Le thème Nébuleuse de verre allume la capsule de la ligne Agent tant que le tour
 * tourne, et la pâlit ensuite. Il le lit sur la classe `is-live` de `.msg-meta` : ce test verrouille
 * qu'elle suit `message.done`, dans les deux sens.
 *
 * Entrée qui ferait échouer une correction fausse : un tour terminé qui garderait `is-live` (la
 * capsule resterait allumée sur tout l'historique) ou un tour en cours qui ne l'aurait pas.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

async function meta(done: boolean): Promise<Element | null> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const message = {
    role: 'assistant',
    content: '',
    parts: [{ kind: 'text', text: 'réponse' }],
    done,
    messageId: 'm1',
    turnId: 't1'
  } as unknown as Msg
  await act(async () => {
    root.render(createElement(ChatMessageRow, { message, conversationId: 'A' } as never))
  })
  const trouve = host.querySelector('.msg.assistant > .msg-meta')
  const copie = trouve ? (trouve.cloneNode(true) as Element) : null
  await act(async () => root.unmount())
  host.remove()
  return copie
}

describe('ligne Agent du fil', () => {
  it('porte is-live pendant le tour, pour que sa capsule reste allumée', async () => {
    expect((await meta(false))?.classList.contains('is-live')).toBe(true)
  })

  it('perd is-live une fois le tour fini, pour que sa capsule pâlisse', async () => {
    const ligne = await meta(true)
    expect(ligne, 'la ligne Agent doit exister').not.toBeNull()
    expect(ligne?.classList.contains('is-live')).toBe(false)
    expect(ligne?.querySelector('.msg-role')?.textContent).toBe('Agent')
  })
})
