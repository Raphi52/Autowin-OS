import { describe, expect, it } from 'vitest'
import { fractionJauge, verdictMicro } from './jarvis-audio'

describe('fractionJauge', () => {
  it('rend 0 sur le silence et 1 sur la pleine échelle', () => {
    expect(fractionJauge(0)).toBe(0)
    expect(fractionJauge(1)).toBe(1)
  })

  it('ne réduit PAS une voix normale à une barre invisible', () => {
    // Le défaut que la conversion en dB corrige : 0,05 en linéaire = 5 % de barre.
    expect(fractionJauge(0.05)).toBeGreaterThan(0.4)
  })

  it('croît avec le niveau', () => {
    expect(fractionJauge(0.02)).toBeLessThan(fractionJauge(0.2))
  })
})

describe('verdictMicro', () => {
  const seuil = 0.012
  it('dit « parle dans le vide » quand rien ne dépasse le seuil', () => {
    expect(verdictMicro(true, 0.001, seuil)).toBe('silence')
  })
  it('distingue faible, bon et saturé', () => {
    expect(verdictMicro(true, 0.015, seuil)).toBe('faible')
    expect(verdictMicro(true, 0.06, seuil)).toBe('bon')
    expect(verdictMicro(true, 0.9, seuil)).toBe('sature')
  })
  it('micro coupé prime sur tout', () => {
    expect(verdictMicro(false, 0.9, seuil)).toBe('coupe')
  })
})
