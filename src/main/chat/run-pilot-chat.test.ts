import { describe, expect, it } from 'vitest'
import { verdictVeilleurInactivite } from './run-pilot-chat'

describe('verdictVeilleurInactivite', () => {
  it('patiente tant que le plafond n est pas atteint', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 999, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('patienter')
  })
  it('coupe quand le plafond est atteint sans commande en vol', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 1000, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('couper')
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 5000, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('couper')
  })
  it('signale une commande en vol meme au-dela du plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 5000, commandesEnVol: 1, plafondMs: 1000 })
    ).toBe('commande-en-vol')
  })
  it('signale une commande en vol meme sous le plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 0, commandesEnVol: 2, plafondMs: 1000 })
    ).toBe('commande-en-vol')
  })
})
