import { describe, expect, it } from 'vitest'
import { ancienNomDeCopieDeFil, nomDeCopieDeFil } from './copie-du-fil'

describe('nomDeCopieDeFil — la copie d’un fil se reconnaît à son dossier et au nom du fil', () => {
  it('rend le fil d’une copie rangée sous copies-de-fil, séparateur et casse quelconques', () => {
    expect(
      nomDeCopieDeFil('D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-fil\\conv-1710')
    ).toEqual({ fil: 'conv-1710' })
    expect(nomDeCopieDeFil('/data/Copies-De-Fil/conv-7/')).toEqual({ fil: 'conv-7' })
  })

  it('refuse un autre dossier parent, un nom vide ou un nom qui sortirait du dossier', () => {
    expect(nomDeCopieDeFil('D:\\projets\\conv-1710')).toBeNull()
    expect(nomDeCopieDeFil('D:\\data\\retours-de-tour\\essai__conv-1-1700-1')).toBeNull()
    expect(nomDeCopieDeFil('D:\\data\\copies-de-fil')).toBeNull()
    expect(nomDeCopieDeFil('D:\\data\\copies-de-fil\\..')).toBeNull()
    expect(nomDeCopieDeFil('D:\\data\\copies-de-fil\\a b')).toBeNull()
    expect(nomDeCopieDeFil(undefined)).toBeNull()
  })
})

/**
 * L'ANCIEN NOM des copies de fil, `essai__<fil>-<instant>-<rang>` : le ménage et la liste des dossiers
 * le lisent encore. Entrée qui fait échouer une version fausse : un fil qui contient des tirets
 * (`conv-1038`) — une lecture par `split('-')` le couperait.
 */
describe('ancienNomDeCopieDeFil — les copies rangées sous retours-de-tour/essai__…', () => {
  it('lit fil, instant et rang, tirets du fil compris, sous Windows comme ailleurs', () => {
    expect(ancienNomDeCopieDeFil('D:\\data\\retours-de-tour\\essai__conv-1038-1700-3')).toEqual({
      fil: 'conv-1038',
      quand: 1700,
      rang: 3
    })
    expect(ancienNomDeCopieDeFil('/data/retours-de-tour/essai__conv-7-12-1/')).toEqual({
      fil: 'conv-7',
      quand: 12,
      rang: 1
    })
  })
  it('refuse une copie de « revenir à ce tour », un rang nul, un nom sans instant', () => {
    expect(ancienNomDeCopieDeFil('D:\\r\\retour__conv-1-1700')).toBeNull()
    expect(ancienNomDeCopieDeFil('D:\\r\\essai__conv-1-1700-0')).toBeNull()
    expect(ancienNomDeCopieDeFil('D:\\r\\essai__conv-1')).toBeNull()
    expect(ancienNomDeCopieDeFil(undefined)).toBeNull()
  })
})
