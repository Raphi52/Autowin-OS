import { describe, expect, it } from 'vitest'
import {
  LONGUEUR_TITRE,
  marqueurDeMoment,
  titreCourt,
  titreSansHomonyme
} from './titre-sans-homonyme'

const LE_12_A_9H41 = new Date(2026, 8, 12, 9, 41)

describe('titre de conversation sans homonyme', () => {
  it('laisse un titre libre EXACTEMENT tel qu il etait', () => {
    expect(titreSansHomonyme('corrige le bouton Stop', ['autre chose'], LE_12_A_9H41)).toBe(
      'corrige le bouton Stop'
    )
  })

  it('distingue par le moment les lanceurs repetes — les 14 « /salvage » du poste', () => {
    const rendu = titreSansHomonyme('/salvage', ['/salvage'], LE_12_A_9H41)
    expect(rendu).not.toBe('/salvage')
    expect(rendu).toContain('/salvage')
    expect(rendu).toContain(marqueurDeMoment(LE_12_A_9H41))
  })

  it('compare comme le store : casse, accents et point final ne font pas deux titres', () => {
    expect(
      titreSansHomonyme('Réparer la mise à jour', ['reparer la mise a jour.'], LE_12_A_9H41)
    ).toContain('12/09 09:41')
  })

  it('ne depasse jamais la longueur d affichage, et garde la date VISIBLE', () => {
    const long = 'Réparer la mise à jour du client lourd RigV3 sur le poste de recette'
    const rendu = titreSansHomonyme(long, [titreCourt(long)], LE_12_A_9H41)
    expect(rendu.length).toBeLessThanOrEqual(LONGUEUR_TITRE)
    expect(rendu.endsWith(marqueurDeMoment(LE_12_A_9H41))).toBe(true)
  })

  it('ne fabrique pas un titre a partir de rien', () => {
    expect(titreSansHomonyme('   ', ['quelque chose'], LE_12_A_9H41)).toBe('')
  })

  it('coupe toujours a 42 caracteres quand il n y a pas d homonyme', () => {
    const long = 'a'.repeat(80)
    expect(titreCourt(long).length).toBe(LONGUEUR_TITRE + 1)
    expect(titreSansHomonyme(long, [], LE_12_A_9H41)).toBe(titreCourt(long))
  })
})
