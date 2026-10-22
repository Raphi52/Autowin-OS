import { describe, expect, it } from 'vitest'
import { filAttenduSuiteDifferee, suiteEstDifferee } from './chat-auto-mode'

/**
 * ATTENDRE LA FIN D'UN AUTRE FIL (conv-1069, candidat 3 du scout). Mesuré sur conv-1065 : la même
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
    // Recopiée du « 👉 Recommandé » de conv-1065 (22/10, 11:47) : le cas qui a coûté 5 envois.
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

  it('JUMEAU : un fil cité sans condition de fin n’est pas une attente', () => {
    expect(filAttenduSuiteDifferee('Relis la conclusion de conv-1065 et compare.', null)).toBeNull()
    expect(suiteEstDifferee('Relis la conclusion de conv-1065 et compare.', null)).toBe(false)
    expect(filAttenduSuiteDifferee('quand fin.txt existe, relever', null)).toBeNull()
  })
})
