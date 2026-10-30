import { describe, expect, it } from 'vitest'
import {
  kaizenConversationParCommande,
  kaizenNamedConversationId,
  localiserMessageCite
} from './autowin-kaizen-context'
import { sansPrecisionDeLecture, tacheAvecLectureRetenue } from './deux-lectures'

/*
 * LA CIBLE D'UN /KAIZEN SE LIT SUR LES MOTS DE L'UTILISATEUR (conv-1332, 2026-10-30).
 *
 * « /kaizen tu aurais du tout paralléliser avec une super conv », tapé dans conv-1332 (tour
 * c7de932e-abac-4f8b-ba34-1b6335b62653) : l'app y a joint sa compréhension ET la lecture qu'elle
 * ÉCARTAIT, « Reprendre maintenant le travail sur /draft… ». Ce `/draft`-là a été pris pour une
 * commande citée, et le dossier est parti sur conv-1306, la dernière conversation où /draft a été
 * tapé. La phrase de compréhension, elle, a été prise pour une citation de l'utilisateur.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : relire la tâche complète dans l'un des trois sélecteurs.
 */
const TAPE = '/kaizen tu aurais du tout paralléliser avec une super conv'
const RETENUE =
  "Avec /kaizen, corriger le comportement de l'agent pour qu'il découpe et parallélise ce genre de chantier avec une super conv, au lieu de tout faire d'un bloc."
const ECARTEE =
  'Reprendre maintenant le travail sur /draft en le parallélisant dans une super conv, en plus de corriger le comportement via /kaizen.'
const TACHE = tacheAvecLectureRetenue(TAPE, RETENUE, ECARTEE)

const fil = (id: string, ...messages: string[]) => ({
  id,
  messages: messages.map((content, rang) => ({ role: 'user', content, ts: 1000 + rang }))
})

describe('la cible d’un /kaizen ignore la compréhension jointe à la demande', () => {
  const conversations = [
    fil('conv-1306', '/draft le front du browser'),
    fil('conv-1332', '/scout en fonction de ce que j’ai l’habitude de demander', TAPE)
  ]

  it('rend les mots tapés, et rien d’autre', () => {
    expect(sansPrecisionDeLecture(TACHE)).toBe(TAPE)
    expect(sansPrecisionDeLecture(TAPE)).toBe(TAPE)
  })

  it('garde ce qui suit la précision : seule elle est retirée', () => {
    expect(sansPrecisionDeLecture(`${TACHE}\n\nPièce jointe : a.png`)).toBe(
      `${TAPE}\n\nPièce jointe : a.png`
    )
  })

  it('un /draft de la lecture écartée ne déplace pas le dossier', () => {
    expect(kaizenConversationParCommande(TACHE, 'conv-1332', conversations)).toBeUndefined()
  })

  it('un /draft tapé par l’utilisateur le déplace toujours', () => {
    const tache = tacheAvecLectureRetenue('/kaizen /draft ne me rend pas les boutons', RETENUE)
    expect(kaizenConversationParCommande(tache, 'conv-1332', conversations)?.conversationId).toBe(
      'conv-1306'
    )
  })

  it('la compréhension n’est pas une citation de l’utilisateur', () => {
    expect(localiserMessageCite(TACHE, 'conv-1332', conversations)).toEqual({
      conversationId: 'conv-1332'
    })
  })

  it('un numéro de conversation dans la lecture écartée n’est pas une cible nommée', () => {
    const tache = tacheAvecLectureRetenue(TAPE, RETENUE, 'Auditer conv-1306 à la place.')
    expect(kaizenNamedConversationId(tache)).toBeUndefined()
  })
})
