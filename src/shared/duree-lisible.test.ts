import { describe, expect, it } from 'vitest'
import { dureeLisible } from './duree-lisible'

/*
 * Une seule version de « 45 s », « 2 min 30 s », « 3 min ». Elle vivait en trois copies : le battement
 * des outils (`claude.ts`), le relais d'un appel repris (copie déclarée de la première) et les
 * en-têtes du bloc Raisonnement de l'interface.
 */
describe('dureeLisible', () => {
  it('écrit les secondes sous une minute', () => {
    expect(dureeLisible(0)).toBe('0 s')
    expect(dureeLisible(45)).toBe('45 s')
    expect(dureeLisible(59)).toBe('59 s')
  })

  it('écrit les minutes, avec les secondes seulement quand il en reste', () => {
    expect(dureeLisible(60)).toBe('1 min')
    expect(dureeLisible(125)).toBe('2 min 5 s')
    expect(dureeLisible(150)).toBe('2 min 30 s')
    expect(dureeLisible(180)).toBe('3 min')
  })

  it('arrondit une durée non entière à la seconde', () => {
    expect(dureeLisible(44.6)).toBe('45 s')
    expect(dureeLisible(59.6)).toBe('1 min')
  })
})
