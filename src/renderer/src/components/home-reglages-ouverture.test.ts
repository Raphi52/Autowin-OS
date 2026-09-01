import { beforeEach, describe, expect, it } from 'vitest'
import {
  memoriserOuvertureReglages,
  oublierOuvertureReglages,
  reglagesSontOuverts
} from './home-reglages-ouverture'

describe('memoire d ouverture du panneau de reglages', () => {
  beforeEach(() => oublierOuvertureReglages())

  it('demarre FERME', () => {
    expect(reglagesSontOuverts()).toBe(false)
  })

  it('retient une ouverture, puis une fermeture', () => {
    memoriserOuvertureReglages(true)
    expect(reglagesSontOuverts()).toBe(true)
    memoriserOuvertureReglages(false)
    expect(reglagesSontOuverts()).toBe(false)
  })

  it('revient a ferme quand on l oublie (equivalent d un redemarrage)', () => {
    memoriserOuvertureReglages(true)
    oublierOuvertureReglages()
    expect(reglagesSontOuverts()).toBe(false)
  })
})
