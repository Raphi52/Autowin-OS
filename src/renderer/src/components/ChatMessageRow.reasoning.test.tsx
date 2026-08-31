// @vitest-environment happy-dom
/**
 * La bulle du fil ne porte PLUS le raisonnement : il vit dans le panneau dédié.
 * Entrée qui ferait échouer une correction fausse : un message EN COURS (`done: false`) avec
 * `reasoning` et zéro `parts` — exactement le cas que l'ancien affichage transitoire ciblait.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

describe('ChatMessageRow', () => {
  it('affiche le raisonnement dans un bloc Réflexion ouvert tant que le tour court', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const message = {
      role: 'assistant',
      content: '',
      parts: [],
      done: false,
      reasoning: 'raisonnement en cours'
    } as unknown as Msg
    await act(async () => {
      root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
    })
    expect(host.querySelector('[data-testid="msg-reasoning"]')).toBeNull()
    expect(host.textContent).not.toContain('raisonnement en cours')
    await act(async () => root.unmount())
    host.remove()
  })
})
