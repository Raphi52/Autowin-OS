import { describe, expect, it } from 'vitest'
import { askEnAttente } from './chat-message-keys'
import type { Msg } from './chat-view-types'

/**
 * FIXTURE CORRIGEE (2026-08-28, salvage run-0be31590f330-1) : ce test fabriquait une part
 * `{ kind: 'ask-decision' }`, forme qui N'EXISTE PAS dans `PersistedChatPart`
 * (text|action|artifact|error). Il validait donc une implementation morte. Une question `ask`
 * arrive comme part d'ACTION ; le bloc `ask-decision` est produit par `groupAssistantActivity`.
 */
const ask = (): Msg =>
  ({
    role: 'assistant',
    parts: [
      {
        kind: 'action',
        actionId: 'a1',
        name: 'ask',
        ok: true,
        data: { question: 'q', options: [{ libelle: 'o1' }, { libelle: 'o2' }] }
      }
    ]
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
