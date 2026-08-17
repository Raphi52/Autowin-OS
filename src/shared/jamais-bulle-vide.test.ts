import { describe, expect, it } from 'vitest'
import { createChatTurn, flattenChatParts, reduceChatTurn } from './chat-turn'

/**
 * JAMAIS DE BULLE VIDE — y compris sur un tour ANNULÉ ou INTERROMPU.
 *
 * Constaté dans `conv-1267` (message 5) : l'utilisateur commence une phrase, se corrige, le tour est
 * annulé — et il ne reste RIEN à lire. La règle existait déjà, mais seulement sur les chemins où le
 * modèle avait parlé ; une annulation précoce y échappait.
 *
 * Un tour clos sans un mot est indistinguable d'une panne : l'utilisateur ne sait pas s'il a
 * interrompu quelque chose, ni si du travail a été perdu.
 */
describe('un tour clos sans un mot', () => {
  it('ANNULÉ sans rien dire reçoit un mot lisible', () => {
    const tour = reduceChatTurn(createChatTurn('t1'), { kind: 'cancelled' })
    expect(tour.status).toBe('cancelled')
    expect(flattenChatParts(tour.parts)).toContain('annulé')
  })

  it('INTERROMPU sans rien dire reçoit un mot lisible', () => {
    const tour = reduceChatTurn(createChatTurn('t2'), { kind: 'interrupted' })
    expect(tour.status).toBe('interrupted')
    expect(flattenChatParts(tour.parts)).toContain('interrompu')
  })

  it('NE TOUCHE PAS un tour qui avait déjà parlé', () => {
    // Ecraser une vraie reponse par un mot generique serait pire que le silence.
    const avecTexte = reduceChatTurn(createChatTurn('t3'), {
      kind: 'delta',
      streamId: 's',
      text: 'Voici le résultat.'
    })
    const annule = reduceChatTurn(avecTexte, { kind: 'cancelled' })
    expect(flattenChatParts(annule.parts)).toBe('Voici le résultat.')
  })

  it('NE TOUCHE PAS un tour qui avait agi', () => {
    // Une action seule n'est pas « vide » : la garde du tour muet s'en occupe ailleurs.
    const avecAction = reduceChatTurn(createChatTurn('t4'), {
      kind: 'command',
      actionId: 'a1',
      name: 'list_files'
    })
    const interrompu = reduceChatTurn(avecAction, { kind: 'interrupted' })
    expect(interrompu.parts).toHaveLength(1)
    expect(interrompu.parts[0].kind).toBe('action')
  })
})
