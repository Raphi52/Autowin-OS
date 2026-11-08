import { describe, expect, it } from 'vitest'
import { deuxChiffres } from './deux-chiffres'

/*
 * Une seule version de « 07 », « 12 » : elle vivait en trois copies (horodatage des enregistrements,
 * durée affichée dans l'Accueil, repère de moment d'un titre de fil).
 */
describe('deuxChiffres', () => {
  it('complète à deux chiffres, sans toucher au-delà', () => {
    expect(deuxChiffres(0)).toBe('00')
    expect(deuxChiffres(7)).toBe('07')
    expect(deuxChiffres(12)).toBe('12')
    expect(deuxChiffres(123)).toBe('123')
  })
})
