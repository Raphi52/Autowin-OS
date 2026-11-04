import { describe, expect, it } from 'vitest'
import { echelleMin, niveauPourEchelle } from './quartier-planche'

// Les parts réelles de la planche 126 × 170 : 1, 63/126, 32/126, 16/126 (conv-1526).
const PARTS = [1, 0.5, 32 / 126, 16 / 126]

describe('niveauPourEchelle', () => {
  it("lit l'original quand le personnage est agrandi ou presque à taille réelle", () => {
    expect(niveauPourEchelle(2.5, PARTS)).toBe(0)
    expect(niveauPourEchelle(1, PARTS)).toBe(0)
    expect(niveauPourEchelle(0.8, PARTS)).toBe(0)
  })

  it("au repos (~0,45 à l'écran), lit la moitié : un rapport de 0,9, sans crénelage", () => {
    expect(niveauPourEchelle(0.45, PARTS)).toBe(1)
    expect(niveauPourEchelle(0.5, PARTS)).toBe(1)
  })

  it("ne lit jamais un niveau plus petit que le personnage à l'écran", () => {
    for (const e of [0.9, 0.6, 0.4, 0.3, 0.2, 0.13]) {
      const i = niveauPourEchelle(e, PARTS)
      expect(PARTS[i]).toBeGreaterThanOrEqual(e)
      // ... ni plus du double : au-delà, le bilinéaire crénèle.
      expect(e / PARTS[i]).toBeGreaterThanOrEqual(0.5 - 1e-9)
    }
  })

  it('sous le huitième, garde le plus petit niveau', () => {
    expect(niveauPourEchelle(0.05, PARTS)).toBe(3)
  })
})

describe('echelleMin', () => {
  it("rend l'échelle uniforme d'un personnage, miroir compris", () => {
    expect(echelleMin({ a: -0.4, b: 0, c: 0, d: 0.4 })).toBeCloseTo(0.4)
  })

  it("rend l'axe le plus écrasé de l'ombre portée (biais 0,46, écrasement 0,2)", () => {
    const k = 0.5
    expect(echelleMin({ a: k, b: 0, c: 0.46 * k, d: -0.2 * k })).toBeCloseTo(
      Math.hypot(0.46, 0.2) * k
    )
  })
})
