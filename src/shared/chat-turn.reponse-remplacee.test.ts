import { describe, expect, it } from 'vitest'
import {
  flattenChatParts,
  flattenChatPartsForModel,
  reduceChatTurn,
  type ChatTurnState,
  type PersistedChatPart
} from './chat-turn'

/**
 * RÉPONSE REMPLACÉE PAR UNE RELANCE : le texte retiré de `parts` se garde à son rang, pour se
 * montrer replié dans le fil. Il ne compte ni dans le contenu, ni dans l'historique renvoyé au modèle.
 *
 * Entrées qui feraient échouer une correction fausse :
 *  - une relance qui efface sans rien garder (le défaut d'origine : la réponse disparaît) ;
 *  - une réponse gardée qui reste à son ancien rang après un retrait qui la précède ;
 *  - une réponse gardée qui rentre dans `parts` (elle compterait alors dans le contenu).
 */
const tour = (parts: PersistedChatPart[]): ChatTurnState => ({
  turnId: 't1',
  status: 'streaming',
  parts
})
const texte = (streamId: string, text: string): PersistedChatPart => ({
  kind: 'text',
  streamId,
  text
})
const action: PersistedChatPart = { kind: 'action', name: 'Bash', actionId: 'a1', ok: true }

describe('réponse remplacée par une relance', () => {
  it('la relance sort la réponse de parts et la garde à son rang', () => {
    const suivant = reduceChatTurn(
      tour([texte('0:0', 'Récit.'), action, texte('1:0', 'Chiffre 42.')]),
      {
        kind: 'stream-reset',
        streamId: '1:0',
        remplacee: true
      }
    )
    expect(suivant.parts).toEqual([texte('0:0', 'Récit.'), action])
    expect(suivant.reponsesRemplacees).toEqual([{ rang: 2, parts: [texte('1:0', 'Chiffre 42.')] }])
  })

  it('sans marquage, la relance retire comme avant : rien n’est gardé', () => {
    const suivant = reduceChatTurn(
      tour([texte('0:0', 'Récit.'), action, texte('1:0', 'Chiffre 42.')]),
      {
        kind: 'stream-reset',
        streamId: '1:0'
      }
    )
    expect(suivant.parts).toEqual([texte('0:0', 'Récit.'), action])
    expect(suivant.reponsesRemplacees).toBeUndefined()
  })

  it('une relance qui ne refait que la conclusion ne garde que la conclusion', () => {
    const suivant = reduceChatTurn(
      tour([texte('1:0', 'Intro.'), action, texte('1:0', 'Conclusion.')]),
      {
        kind: 'stream-reset',
        streamId: '1:0',
        conclusionSeule: true,
        remplacee: true
      }
    )
    expect(suivant.parts).toEqual([texte('1:0', 'Intro.'), action])
    expect(suivant.reponsesRemplacees).toEqual([{ rang: 2, parts: [texte('1:0', 'Conclusion.')] }])
  })

  it('une réponse gardée recule d’autant de parts retirées qui la précèdent', () => {
    let etat = tour([texte('0:0', 'A.'), texte('1:0', 'B.'), action, texte('1:0', 'Z.')])
    etat = reduceChatTurn(etat, {
      kind: 'stream-reset',
      streamId: '1:0',
      conclusionSeule: true,
      remplacee: true
    })
    expect(etat.reponsesRemplacees).toEqual([{ rang: 3, parts: [texte('1:0', 'Z.')] }])
    // A est retirée (rang 0) : Z, gardée après l'action, recule d'une part et reste à sa place.
    etat = reduceChatTurn(etat, { kind: 'stream-reset', streamId: '0:0', remplacee: true })
    expect(etat.parts).toEqual([texte('1:0', 'B.'), action])
    expect(etat.reponsesRemplacees).toEqual([
      { rang: 2, parts: [texte('1:0', 'Z.')] },
      { rang: 0, parts: [texte('0:0', 'A.')] }
    ])
  })

  it('la réponse remplacée n’entre ni dans le contenu ni dans l’historique renvoyé au modèle', () => {
    const retiree = reduceChatTurn(tour([texte('0:0', 'Le chiffre est 42.')]), {
      kind: 'stream-reset',
      streamId: '0:0',
      remplacee: true
    })
    const nouvelle = reduceChatTurn(retiree, {
      kind: 'delta',
      streamId: '1:0',
      text: 'Le chiffre est 17, vérifié.'
    })
    expect(flattenChatParts(nouvelle.parts)).toBe('Le chiffre est 17, vérifié.')
    expect(flattenChatPartsForModel(nouvelle.parts)).toBe('Le chiffre est 17, vérifié.')
  })
})
