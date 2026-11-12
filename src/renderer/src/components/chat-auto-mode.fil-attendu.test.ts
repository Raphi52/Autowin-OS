import { describe, expect, it } from 'vitest'
import { filAttenduSuiteDifferee, suiteEstDifferee } from './chat-auto-mode'

/**
 * ATTENDRE LA FIN D'UN AUTRE FIL (candidat 3 du scout). Mesuré : la même
 * question « conv-N a-t-il fini ? » est partie 5 fois, dont 2 tours PAYÉS pour lire « pas terminé »,
 * et la fin a été vue 51 min en retard. La suite « quand le tour de conv-N est terminé » ne
 * matchait même pas la règle des suites différées (« est terminé » n'y figurait pas) : elle partait
 * tout de suite.
 *
 * L'entrée qui ferait échouer ces tests si la correction était fausse : « quand le tour de conv-1065
 * est terminé, relis sa conclusion » — reconnue comme différée, fil attendu `conv-1065`.
 */
describe('filAttenduSuiteDifferee', () => {
  it('extrait le fil attendu des formes réellement écrites', () => {
    expect(
      filAttenduSuiteDifferee('Quand le tour de conv-1065 est terminé, relis sa conclusion.', null)
    ).toBe('conv-1065')
    expect(
      filAttenduSuiteDifferee('relis la conclusion', 'quand conv-42 aura fini, relis-la')
    ).toBe('conv-42')
    expect(filAttenduSuiteDifferee('Dès que conv-7 a fini son tour, compare les deux.', null)).toBe(
      'conv-7'
    )
    expect(filAttenduSuiteDifferee('À la fin du tour de conv-9, relance le juge.', null)).toBe(
      'conv-9'
    )
    // Recopiée du « 👉 Recommandé » (22/10, 11:47) : le cas qui a coûté 5 envois.
    expect(
      filAttenduSuiteDifferee(
        'Le tour de conv-1053 est-il terminé ? Si oui, vérifie que le verrou a disparu.',
        'vérifier de nouveau le verrou quand le tour de conv-1053 sera terminé.'
      )
    ).toBe('conv-1053')
  })

  it('une telle suite est DIFFÉRÉE, pas envoyée tout de suite', () => {
    expect(
      suiteEstDifferee('Quand le tour de conv-1065 est terminé, relis sa conclusion.', null)
    ).toBe(true)
  })

  /*
   * ATTENDRE LA RÉPONSE D'UN FIL (fil d'un chef de plan, 31/10, 07:24 → 07:25) : trois envois en 55 s,
   * trois tours payés pour lire « conv-1374 n'a pas encore répondu ». Les formes « attendre la
   * réponse de conv-N », « à la réponse de conv-N », « attendre le compte rendu de conv-N » ne
   * passaient par aucune règle d'attente. Recopiées telles quelles des trois envois.
   */
  it('reconnaît « attendre la réponse / le compte rendu de conv-N » écrits par un chef de plan', () => {
    for (const suite of [
      'attendre la réponse de conv-1374, puis rejouer ses tests et mon essai sur un bureau vivant sans fiche.',
      "à la réponse de conv-1374, rejouer ses tests et l'essai sur un bureau vivant sans fiche.",
      "attendre le compte rendu de conv-1374, puis rejouer ses tests et l'essai sur un bureau vivant sans fiche.",
      'Dès la réponse de conv-88, relance le juge.',
      'Quand conv-12 aura répondu, compare les deux.'
    ]) {
      expect(filAttenduSuiteDifferee(suite, null)).toMatch(/^conv-\d+$/u)
      expect(suiteEstDifferee(suite, null)).toBe(true)
    }
  })

  it('JUMEAU : lire la réponse DÉJÀ arrivée d’un fil n’est pas une attente', () => {
    expect(
      filAttenduSuiteDifferee('Lis la réponse de conv-1374 et rejoue ses tests.', null)
    ).toBeNull()
    expect(filAttenduSuiteDifferee('Résume le compte rendu de conv-12.', null)).toBeNull()
  })

  it('JUMEAU : un fil cité sans condition de fin n’est pas une attente', () => {
    expect(filAttenduSuiteDifferee('Relis la conclusion de conv-1065 et compare.', null)).toBeNull()
    expect(suiteEstDifferee('Relis la conclusion de conv-1065 et compare.', null)).toBe(false)
    expect(filAttenduSuiteDifferee('quand fin.txt existe, relever', null)).toBeNull()
  })
})
