import { describe, expect, it } from 'vitest'
import { createChatTurn, reduceChatTurn } from './chat-turn'

// conv-798, tour caea20e6-d64b-436a-9af7-6912bdd13943 : la bulle d'un tour stoppe doit nommer le Stop.
describe('tour annule sans reponse', () => {
  it('nomme le bouton Stop et dit quoi faire', () => {
    const etat = reduceChatTurn(createChatTurn('t'), { kind: 'cancelled' } as never)
    const texte = etat.parts.map((p) => ('text' in p ? p.text : '')).join('')
    expect(texte).toContain('bouton Stop')
    expect(texte).toContain('Renvoie ton message')
  })
})
