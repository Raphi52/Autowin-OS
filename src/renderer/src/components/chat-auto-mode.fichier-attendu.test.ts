import { describe, expect, it } from 'vitest'
import { fichierAttenduSuiteDifferee } from './chat-auto-mode'

describe('fichierAttenduSuiteDifferee (conv-826)', () => {
  it('extrait le fichier d’une suite « quand X existe »', () => {
    expect(fichierAttenduSuiteDifferee('Quand `fin.txt` existe, relever.', null)).toBe('fin.txt')
    expect(fichierAttenduSuiteDifferee('relever', 'quand D:/arena/t4/fin.txt apparaît')).toBe(
      'D:/arena/t4/fin.txt'
    )
  })
  it('aucune condition de fichier → null', () => {
    expect(fichierAttenduSuiteDifferee('relever dans 20 min', null)).toBeNull()
    expect(fichierAttenduSuiteDifferee('quand le tournoi aura fini', null)).toBeNull()
  })
})
