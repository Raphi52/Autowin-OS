import { describe, expect, it } from 'vitest'
import { nomDeCopieDeFil } from './copie-du-fil'

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
