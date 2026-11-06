import { describe, expect, it } from 'vitest'
import { CLE_AUTRES, nomCanonique, regrouperLesProjets } from './board-projets-du-filtre'

/**
 * LES PROJETS DU FILTRE DU BOARD. ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : « AutoWinOS » et
 * « Autowin-OS » (le même projet sur deux postes) qui restent deux entrées ; une copie de fil
 * (« AutoWinOS-git-conv-1317 ») ou un dossier d'essai (« super-conv-test-1284 ») qui reste un projet
 * à son nom ; un mot qui contient « conv » sans être un nom de fil (« Convertisseur ») avalé.
 */
describe('regrouperLesProjets', () => {
  const groupes = regrouperLesProjets(
    [
      { libelle: 'AutoWinOS', demandes: 954 },
      { libelle: 'Autowin-OS', demandes: 95 },
      { libelle: 'ZOX-V3', demandes: 5 },
      { libelle: 'ZOX-V3', demandes: 121 },
      { libelle: 'AutoWinOS-git-conv-1317', demandes: 1 },
      { libelle: 'super-conv-test-1284', demandes: 4 },
      { libelle: 'Convertisseur', demandes: 2 }
    ],
    'Autres dossiers'
  )

  it('regroupe le même projet nommé autrement sur un autre poste, sous le nom le plus porté', () => {
    expect(groupes.get('AutoWinOS')).toEqual({ cle: 'autowinos', nom: 'AutoWinOS' })
    expect(groupes.get('Autowin-OS')).toEqual({ cle: 'autowinos', nom: 'AutoWinOS' })
    expect(groupes.get('ZOX-V3')).toEqual({ cle: 'zoxv3', nom: 'ZOX-V3' })
  })

  it('range une copie de fil sous son projet, et un dossier d’essai sous « Autres dossiers »', () => {
    expect(groupes.get('AutoWinOS-git-conv-1317')).toEqual({ cle: 'autowinos', nom: 'AutoWinOS' })
    expect(groupes.get('super-conv-test-1284')).toEqual({
      cle: CLE_AUTRES,
      nom: 'Autres dossiers'
    })
  })

  it('ne prend pas pour un nom de fil un mot qui contient « conv »', () => {
    expect(groupes.get('Convertisseur')).toEqual({ cle: 'convertisseur', nom: 'Convertisseur' })
  })

  it('ignore casse, accents et ponctuation', () => {
    expect(nomCanonique('Équipe-Zox_V3')).toBe('equipezoxv3')
  })
})
