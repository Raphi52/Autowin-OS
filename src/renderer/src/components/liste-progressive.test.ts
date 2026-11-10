import { describe, expect, it } from 'vitest'
import { LIGNES_AU_PREMIER_RENDU, MARGE_LIGNES, lignesPourLaZone } from './liste-progressive'

/**
 * Le premier passage pose ce que la zone visible peut montrer, plus la marge, sans descendre sous le
 * plancher. Ces bornes tiennent la formule des deux côtés : une zone qui dépasse d'un pixel le multiple
 * d'une ligne en demande une de plus, et une zone sans mesure garde le plancher.
 */
describe('lignesPourLaZone — bornes du premier passage de la liste', () => {
  it.each([
    // 30 lignes tiennent exactement dans 1 080 px : 30 + la marge = 40, pile le plancher.
    { zone: 1080, ligne: 36, attendu: 40 },
    // 1 081 px en demandent une de plus : 31 + la marge = 41.
    { zone: 1081, ligne: 36, attendu: 41 },
    { zone: 1800, ligne: 36, attendu: 60 },
    // Une zone de 300 px tient 9 lignes : le plancher de 40 reste.
    { zone: 300, ligne: 36, attendu: 40 }
  ])('zone de $zone px, ligne de $ligne px ⇒ $attendu lignes', ({ zone, ligne, attendu }) => {
    expect(lignesPourLaZone(zone, ligne)).toBe(attendu)
  })

  it('sans mise en page, la zone ou la ligne inconnue garde le plancher', () => {
    expect(lignesPourLaZone(0, 0)).toBe(LIGNES_AU_PREMIER_RENDU)
    expect(lignesPourLaZone(1800, 0)).toBe(LIGNES_AU_PREMIER_RENDU)
    expect(lignesPourLaZone(0, 36)).toBe(LIGNES_AU_PREMIER_RENDU)
  })

  it('la marge s’ajoute à ce qui tient dans la zone', () => {
    expect(lignesPourLaZone(1800, 36)).toBe(50 + MARGE_LIGNES)
  })
})
