import { describe, expect, it } from 'vitest'
import {
  avecDossierRetire,
  fusionnerDossiersImportes,
  sansDossierRetire
} from './chat-dossiers-import'

/**
 * La règle défendue ici : le retrait volontaire PRIME sur l'import claude.exe. Sans la mémoire
 * des retraits, l'import rejoué à chaque lancement ressusciterait le dossier retiré par la croix
 * à chaque démarrage — la croix serait un bouton mort.
 */
describe('fusionnerDossiersImportes', () => {
  it('ajoute les projets importés absents de la liste', () => {
    expect(
      fusionnerDossiersImportes(
        ['C:\\Deja'],
        ['E:\\SOURCES\\AutoWinOS', 'E:\\PERSO\\VideoToMp3'],
        []
      )
    ).toEqual(['C:\\Deja', 'E:\\SOURCES\\AutoWinOS', 'E:\\PERSO\\VideoToMp3'])
  })

  it('ne ressuscite JAMAIS un dossier retiré par la croix, quelle que soit sa graphie', () => {
    expect(
      fusionnerDossiersImportes([], ['E:\\SOURCES\\AutoWinOS'], ['e:/sources/autowinos/'])
    ).toBeNull()
  })

  it('ne duplique pas une entrée déjà connue sous une autre graphie (E:/x vs E:\\x)', () => {
    expect(
      fusionnerDossiersImportes(['E:/SOURCES/AutoWinOS'], ['E:\\SOURCES\\AutoWinOS'], [])
    ).toBeNull()
  })

  it('rend null quand rien ne change, pour ne pas réécrire un état identique', () => {
    expect(fusionnerDossiersImportes(['C:\\Deja'], [], [])).toBeNull()
  })

  it('revalide ce qui traverse le pont : non-chaînes et libellés de classement ignorés', () => {
    expect(fusionnerDossiersImportes([], [42, null, 'Clients/Amitel', {}], [])).toBeNull()
  })
})

describe('mémoire des retraits', () => {
  it('un retrait s’enregistre canonisé et sans doublon', () => {
    const retires = avecDossierRetire(
      avecDossierRetire([], 'E:/SOURCES/AutoWinOS'),
      'E:\\SOURCES\\AutoWinOS\\'
    )
    expect(retires).toEqual(['E:\\SOURCES\\AutoWinOS'])
  })

  it('un ré-ajout MANUEL efface le retrait : l’import redevient possible', () => {
    const retires = avecDossierRetire([], 'E:\\SOURCES\\AutoWinOS')
    const rouverts = sansDossierRetire(retires, 'e:/sources/autowinos')
    expect(rouverts).toEqual([])
    expect(fusionnerDossiersImportes([], ['E:\\SOURCES\\AutoWinOS'], rouverts)).toEqual([
      'E:\\SOURCES\\AutoWinOS'
    ])
  })
})
