import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import { avancerBateau, glissementEau, placeDuTram, type VoieBateau } from './quartier-vie'

describe('les animations du décor (conv-1424, « les animations de décor sont éclatées »)', () => {
  it("l'eau ondule sans se découper en peigne : deux lignes voisines glissent presque pareil", () => {
    let pire = 0
    for (let temps = 0; temps < 20; temps += 0.13)
      for (let y = 341; y < 490; y++) {
        const a = glissementEau(y, temps, (y - 341) / 149)
        const b = glissementEau(y + 1, temps, (y + 1 - 341) / 149)
        pire = Math.max(pire, Math.abs(a - b))
      }
    // Avant : 0,46 rad par ligne et 3,6 px d'amplitude, soit jusqu'à 1,3 px d'une ligne à l'autre.
    expect(pire).toBeLessThan(0.25)
  })

  it("l'eau reste près de sa place, y compris sur la rive proche", () => {
    for (let temps = 0; temps < 20; temps += 0.13)
      expect(Math.abs(glissementEau(480, temps, 1))).toBeLessThan(1.1)
  })

  it('un bateau reste sur sa voie, vire et repart dans l’autre sens', () => {
    const b: VoieBateau = { x: 120, sens: 1, cap: 1, v: 5, min: 100, max: 140 }
    const vus = new Set<number>()
    let x = b.x
    for (let i = 0; i < 6000; i++) {
      avancerBateau(b, 1 / 30)
      x = b.x
      vus.add(Math.sign(b.cap))
      // Il finit son virage après le bout de la voie : quelques pixels, pas un demi-tour sur place.
      expect(x).toBeGreaterThan(b.min - 8)
      expect(x).toBeLessThan(b.max + 8)
    }
    expect(vus.has(1)).toBe(true)
    expect(vus.has(-1)).toBe(true)
  })

  it('un bateau vire sans à-coup : son cap change peu à chaque image', () => {
    const b: VoieBateau = { x: 139.9, sens: 1, cap: 1, v: 5, min: 100, max: 140 }
    let avant = b.cap
    for (let i = 0; i < 300; i++) {
      avancerBateau(b, 1 / 30)
      expect(Math.abs(b.cap - avant)).toBeLessThan(0.02)
      avant = b.cap
    }
  })

  it("le tram s'arrête aux deux bouts du pont et y repart en douceur", () => {
    expect(placeDuTram(0)).toBe(0)
    expect(placeDuTram(0.05)).toBe(0)
    expect(placeDuTram(0.5)).toBeCloseTo(0.5)
    expect(placeDuTram(0.97)).toBe(1)
    expect(placeDuTram(1.03)).toBe(1)
    expect(placeDuTram(1.5)).toBeCloseTo(0.5)
    let avant = placeDuTram(0)
    for (let t = 0; t < 2; t += 0.001) {
      const p = placeDuTram(t)
      expect(Math.abs(p - avant)).toBeLessThan(0.003)
      avant = p
    }
  })

  it('les objets qui bougent sont des peintures, et les fenêtres sont relevées sur la toile', () => {
    const { sprites, fenetres } = (
      donnees as unknown as {
        vie: {
          sprites: Record<string, { m: string; w: number; h: number }>
          fenetres: number[][]
        }
      }
    ).vie
    for (const nom of ['ballon', 'bateau1', 'bateau2', 'bateau3', 'tram']) {
      expect(sprites[nom].m).toMatch(/^data:image\/webp;base64,/)
      expect(sprites[nom].w).toBeGreaterThan(0)
    }
    expect(fenetres.length).toBeGreaterThan(20)
    for (const [x, y, w, h] of fenetres) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThan(150)
      expect(y + h).toBeLessThan(345)
      // Une fenêtre reste une fenêtre : une grande plaque jaune se verrait comme un défaut.
      expect(w * h).toBeLessThan(30)
    }
  })
})
