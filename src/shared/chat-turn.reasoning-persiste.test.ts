import { describe, expect, it } from 'vitest'
import { createChatTurn, reduceChatTurn, REASONING_MAX } from './chat-turn'
import { applyTurnEventToMessages, type Msg } from '../main/store/conversations'
import { hydrateStoredAssistant } from '../renderer/src/components/chat-view-model'

describe('le raisonnement survit au rechargement', () => {
  it("s'accumule dans le tour sans toucher à la réponse ni au statut", () => {
    const clos = reduceChatTurn(createChatTurn('t1'), { kind: 'done' })
    const pense = reduceChatTurn(clos, { kind: 'reasoning', text: 'je pèse' })
    const suite = reduceChatTurn(pense, { kind: 'reasoning', text: ' les options' })
    expect(suite.reasoning).toBe('je pèse les options')
    expect(suite.parts).toEqual([])
    // Penser n'est ni parler ni recommencer : un tour clos reste clos.
    expect(suite.status).toBe('completed')
  })

  it('borne ce qui est conservé, en gardant la FIN', () => {
    const long = reduceChatTurn(createChatTurn('t1'), {
      kind: 'reasoning',
      text: `${'a'.repeat(REASONING_MAX)}FIN`
    })
    expect(long.reasoning).toHaveLength(REASONING_MAX)
    expect(long.reasoning?.endsWith('FIN')).toBe(true)
  })

  it('atterrit sur le message du tour, puis se relit après hydratation', () => {
    const messages: Msg[] = [
      { role: 'assistant', content: '', ts: 1, turnId: 't1', status: 'completed', parts: [] }
    ]
    applyTurnEventToMessages(messages, 't1', { kind: 'reasoning', text: 'la pensée gardée' })
    expect(messages[0].reasoning).toBe('la pensée gardée')

    const relu = hydrateStoredAssistant({
      content: messages[0].content,
      parts: [],
      status: 'completed',
      reasoning: messages[0].reasoning
    })
    expect(relu.reasoning).toBe('la pensée gardée')
  })

  it("n'invente rien quand le tour n'a pas pensé", () => {
    expect(hydrateStoredAssistant({ content: 'x' }).reasoning).toBeUndefined()
  })
})
