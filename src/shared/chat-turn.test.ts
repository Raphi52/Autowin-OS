import { describe, expect, it } from 'vitest'
import {
  createChatTurn,
  flattenChatParts,
  reduceChatTurn,
  sanitizePersistedValue
} from './chat-turn'

describe('chat turn reducer', () => {
  it('preserves text/action/text order and resolves the matching action', () => {
    let turn = createChatTurn('turn-1')
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:0', text: 'Bonjour ' })
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:0', text: 'Raphaël.' })
    turn = reduceChatTurn(turn, {
      kind: 'command',
      actionId: 'action-1',
      name: 'get_state',
      args: { target: 'chat' }
    })
    turn = reduceChatTurn(turn, {
      kind: 'result',
      actionId: 'action-1',
      name: 'get_state',
      ok: true,
      data: { tab: 'chat' }
    })
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '1:0', text: ' Terminé.' })
    turn = reduceChatTurn(turn, { kind: 'done' })

    expect(turn.status).toBe('completed')
    expect(turn.parts).toEqual([
      { kind: 'text', streamId: '0:0', text: 'Bonjour Raphaël.' },
      {
        kind: 'action',
        actionId: 'action-1',
        name: 'get_state',
        args: { target: 'chat' },
        ok: true,
        data: { tab: 'chat' }
      },
      { kind: 'text', streamId: '1:0', text: ' Terminé.' }
    ])
    expect(flattenChatParts(turn.parts)).toBe('Bonjour Raphaël.\n[a exécuté get_state]\n Terminé.')
  })

  it('removes only the failed retry stream', () => {
    let turn = createChatTurn('turn-2')
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:0', text: 'Réponse perdue' })
    turn = reduceChatTurn(turn, { kind: 'stream-reset', streamId: '0:0' })
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:1', text: 'Réponse valide' })

    expect(turn.parts).toEqual([{ kind: 'text', streamId: '0:1', text: 'Réponse valide' }])
  })

  it.each([
    ['failed', { kind: 'failed', error: 'provider indisponible' } as const],
    ['cancelled', { kind: 'cancelled' } as const],
    ['interrupted', { kind: 'interrupted' } as const]
  ])('records the honest %s terminal state', (status, event) => {
    const turn = reduceChatTurn(createChatTurn('turn-terminal'), event)
    expect(turn.status).toBe(status)
  })

  it('redacts sensitive keys while preserving ordinary action evidence', () => {
    expect(
      sanitizePersistedValue({ target: 'chat', token: 'secret', nested: { password: 'hidden' } })
    ).toEqual({ target: 'chat', token: '[masqué]', nested: { password: '[masqué]' } })
  })
})
