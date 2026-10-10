// @vitest-environment happy-dom
/**
 * Ligne « Agent » RETIRÉE du fil (conv-227, 2026-10-11 : « enleve carrement cette ligne de tous
 * les themes elle pollue pour rien »). Elle vivait dans ChatMessageRow, commune à tous les thèmes :
 * ce test verrouille qu'aucune réponse de l'agent ne la rend plus, ni pendant le tour ni après.
 *
 * Entrée qui ferait échouer une correction fausse : la ligne masquée par CSS dans un seul thème
 * (elle resterait dans le DOM), ou rendue seulement pendant le tour (avec son spinner).
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

async function rendre(done: boolean): Promise<Element | null> {
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
  const trouve = host.querySelector('.msg.assistant')
  const copie = trouve ? (trouve.cloneNode(true) as Element) : null
  await act(async () => root.unmount())
  host.remove()
  return copie
}

describe('ligne Agent du fil', () => {
  it.each([
    ['pendant le tour', false],
    ['tour fini', true]
  ])("n'est plus rendue (%s)", async (_cas, done) => {
    const reponse = await rendre(done)
    expect(reponse, 'la réponse de l’agent doit exister').not.toBeNull()
    expect(reponse?.querySelector(':scope > .msg-meta')).toBeNull()
    expect(reponse?.textContent).not.toContain('Agent')
    expect(reponse?.textContent).toContain('réponse')
  })
})
