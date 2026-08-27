import { describe, expect, it } from 'vitest'
import { askEnAttente } from './chat-message-keys'
import type { Msg } from './chat-view-types'

const ask = (): Msg =>
  ({
    role: 'assistant',
    parts: [{ kind: 'ask-decision', askId: 'a1', decision: { question: 'q', options: ['o'] } }]
  }) as unknown as Msg
const user = (): Msg => ({ role: 'user', content: 'coucou' }) as unknown as Msg
const texte = (): Msg =>
  ({ role: 'assistant', parts: [{ kind: 'text', text: 'bla' }] }) as unknown as Msg

describe('askEnAttente', () => {
  it('vrai quand une question ask termine le fil', () => {
    expect(askEnAttente([user(), ask()])).toBe(true)
  })
  it('faux quand un message utilisateur y a repondu', () => {
    expect(askEnAttente([ask(), user()])).toBe(false)
  })
  it('faux sans question ask', () => {
    expect(askEnAttente([user(), texte()])).toBe(false)
  })
})
