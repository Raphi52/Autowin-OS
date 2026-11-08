import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dossierDeCopieDeTache,
  nomCopieAgentHeritee,
  racineDesCopiesDeTaches
} from './chemins-de-copies'

describe('racine unique des copies de tâche', () => {
  it('range toutes les copies sous un seul dossier du dossier de données', () => {
    expect(racineDesCopiesDeTaches(join('D:', 'donnees'))).toBe(
      join('D:', 'donnees', 'copies-de-taches')
    )
  })

  it('nomme la copie d’une tâche par son identifiant, fil ou run', () => {
    const racine = racineDesCopiesDeTaches('donnees')
    expect(dossierDeCopieDeTache(racine, 'conv-1751')).toBe(join(racine, 'conv-1751'))
    expect(dossierDeCopieDeTache(racine, 'run-815dbdcf8bfe-1')).toBe(
      join(racine, 'run-815dbdcf8bfe-1')
    )
  })

  it('accepte un identifiant de 128 caractères, et refuse 129', () => {
    const racine = racineDesCopiesDeTaches('donnees')
    expect(dossierDeCopieDeTache(racine, 'a'.repeat(128))).not.toBeNull()
    expect(dossierDeCopieDeTache(racine, 'a'.repeat(129))).toBeNull()
  })

  it('refuse un identifiant qui ne peut pas nommer un dossier sans sortir de la racine', () => {
    const racine = racineDesCopiesDeTaches('donnees')
    for (const mauvais of ['', '.', '..', '../conv-1', 'conv/1', 'conv\\1', 'conv.1', 'conv 1']) {
      expect(dossierDeCopieDeTache(racine, mauvais), `« ${mauvais} »`).toBeNull()
    }
  })

  it('garde le nom hérité de la copie d’agent tel que la version 1 l’écrit aujourd’hui', () => {
    expect(nomCopieAgentHeritee('run-815dbdcf8bfe-1')).toBe('agent__run-815dbdcf8bfe-1')
  })
})
