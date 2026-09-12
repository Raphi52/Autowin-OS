// @vitest-environment happy-dom
/**
 * DEUX exigences de l'utilisateur (2026-09-12) : « dans le bloc Action je veux une ligne par
 * action, et les blocs action et raisonnement doivent pas disparaitre a la fin du tour ».
 *
 * Entrees qui feraient echouer une correction fausse :
 *  1. une action annoncee puis SIX battements de la meme action (duree qui monte) -> UNE ligne ;
 *  2. un message TERMINE, sans raisonnement (pensee chiffree cote modele) mais avec un journal
 *     d'actions -> les deux blocs doivent rester dans le fil.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import { corpsDesActions } from './thinking-block-corps'
import type { Msg } from './chat-view-types'

describe('bloc Actions — une ligne par action', () => {
  it('replie les battements d’une même action sur sa ligne', () => {
    const corps = corpsDesActions(
      [
        'Read · src/a.ts',
        'Bash · npm test',
        'Bash en cours - 30 s',
        'Bash en cours - 1 min',
        'Bash en cours - 2 min - vitest 3/12',
        'Grep · thinking'
      ],
      'Grep · thinking'
    )
    expect(corps.split('\n')).toEqual([
      'Read · src/a.ts',
      'Bash · npm test — 2 min - vitest 3/12',
      'Grep · thinking'
    ])
  })

  it('ne garde qu’une ligne quand seuls des battements arrivent', () => {
    expect(corpsDesActions(['Bash en cours - 30 s', 'Bash en cours - 1 min'], undefined)).toBe(
      'Bash en cours - 1 min'
    )
  })
})

describe('blocs Raisonnement et Actions — après la fin du tour', () => {
  it('restent affichés sur un tour terminé sans raisonnement', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const message = {
      role: 'assistant',
      content: 'réponse',
      parts: [{ kind: 'text', text: 'réponse' }],
      done: true,
      status: 'completed',
      providerStatus: 'Grep · thinking',
      providerStatusLog: ['Read · src/a.ts', 'Grep · thinking']
    } as unknown as Msg
    await act(async () => {
      root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
    })
    expect(host.querySelector('[data-testid="thinking-block"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="action-block-body"]')?.textContent).toBe(
      'Read · src/a.ts\nGrep · thinking'
    )
    await act(async () => root.unmount())
    host.remove()
  })
})
