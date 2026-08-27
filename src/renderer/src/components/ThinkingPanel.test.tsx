// @vitest-environment happy-dom
/**
 * Le raisonnement doit vivre dans un PANNEAU DÉDIÉ à droite, pas dans la bulle du fil.
 *
 * Entrées qui feraient échouer une correction FAUSSE :
 *  - un message TERMINÉ (`done: true`) qui porte du raisonnement doit RESTER listé (une correction
 *    qui garderait la condition `!message.done` d'origine le perdrait) ;
 *  - un message assistant SANS raisonnement ne doit pas produire d'entrée vide ;
 *  - un message utilisateur ne doit jamais apparaître.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingPanel, collectReasoningEntries } from './ThinkingPanel'
import type { Msg } from './chat-view-types'

const assistant = (over: Partial<Msg>): Msg =>
  ({ role: 'assistant', content: '', parts: [], done: true, ...over }) as unknown as Msg

describe('collectReasoningEntries', () => {
  it('retient le raisonnement des messages assistant, terminés compris, dans l’ordre du fil', () => {
    const entries = collectReasoningEntries([
      { role: 'user', content: 'salut' } as unknown as Msg,
      assistant({ reasoning: 'étape 1', done: true, messageId: 'm1' }),
      assistant({ done: true, messageId: 'm2' }),
      assistant({ reasoning: 'étape 2', done: false, messageId: 'm3' })
    ])
    expect(entries.map((entry) => entry.reasoning)).toEqual(['étape 1', 'étape 2'])
    expect(entries[1].live).toBe(true)
    expect(entries[0].live).toBe(false)
  })
})

describe('ThinkingPanel', () => {
  it('affiche le raisonnement et un état vide explicite', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(ThinkingPanel, { messages: [], onClose: () => {} }))
    })
    expect(host.querySelector('[data-testid="thinking-empty"]')).not.toBeNull()
    await act(async () => {
      root.render(
        createElement(ThinkingPanel, {
          messages: [assistant({ reasoning: 'je pèse deux options', messageId: 'm1' })],
          onClose: () => {}
        })
      )
    })
    expect(host.querySelector('[data-testid="thinking-panel"]')?.textContent).toContain(
      'je pèse deux options'
    )
    expect(host.querySelector('[data-testid="thinking-empty"]')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
})
