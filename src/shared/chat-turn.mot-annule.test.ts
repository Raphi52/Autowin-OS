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

  /*
   * kaizen conv-1432 (2026-11-02) : le veilleur d'inactivité coupe le tour ; le pilote émet d'abord
   * `cancellation` (rejeté comme annulation), puis l'échec motivé. La bulle disait « Tour arrêté
   * (bouton Stop) » alors que personne n'avait cliqué — l'utilisateur ET l'agent du tour suivant
   * l'ont lu comme un Stop volontaire. Un échec n'hérite jamais du mot du Stop.
   */
  it('un échec qui suit l’annulation ne garde pas le mot du Stop, mais garde sa cause', () => {
    const motif = 'Tour interrompu : aucun signe de vie depuis 20 minutes.'
    const annule = reduceChatTurn(createChatTurn('t'), { kind: 'cancelled' } as never)
    const etat = reduceChatTurn(annule, { kind: 'failed', error: motif })
    const texte = etat.parts.map((p) => ('text' in p ? p.text : '')).join('')
    expect(texte).not.toContain('bouton Stop')
    expect(etat.status).toBe('failed')
    expect(etat.error).toBe(motif)
  })

  it('un échec garde la réponse déjà écrite par le tour', () => {
    const parle = reduceChatTurn(createChatTurn('t'), { kind: 'delta', text: 'déjà dit' } as never)
    const annule = reduceChatTurn(parle, { kind: 'cancelled' } as never)
    const etat = reduceChatTurn(annule, { kind: 'failed', error: 'coupé' })
    expect(etat.parts.map((p) => ('text' in p ? p.text : '')).join('')).toBe('déjà dit')
  })
})
