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
  it('n’affiche pas le raisonnement dans la bulle assistant', async () => {
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
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')
    expect(bloc, 'le raisonnement doit être rendu dans un bloc « Réflexion »').not.toBeNull()
    // OUVERT tant que le tour court : replié, la pensée resterait invisible — le défaut d'origine.
    expect(bloc!.open).toBe(true)
    expect(host.querySelector('[data-testid="thinking-body"]')?.textContent).toBe(
      'raisonnement en cours'
    )
    await act(async () => root.unmount())
    host.remove()
  })
})
