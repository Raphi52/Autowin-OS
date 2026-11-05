import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COLONNES_PLANCHE,
  echelleMin,
  finesseDePlanche,
  niveauPourEchelle
} from './quartier-planche'

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

// Les animaux v3 sont rendus en ×2 (conv-1558) : chaque planche fait 3024 × 9520 (28 rangées de 340 px).
describe('finesseDePlanche', () => {
  it('lit 1 sur une planche à la grille de donnees.json, 2 sur une planche ×2', () => {
    expect(finesseDePlanche(1512, 126)).toBe(1)
    expect(finesseDePlanche(3024, 126)).toBe(2)
  })

  it("refuse une largeur qui n'est pas un multiple entier de la grille", () => {
    expect(() => finesseDePlanche(2268, 126)).toThrow(/1512/)
    expect(() => finesseDePlanche(1000, 126)).toThrow()
  })

  it('sur une planche ×2, le repos (~0,45) lit la case de 63 px, le zoom (~1,8) la case de 252 px', () => {
    const parts = [2, 1, 0.5, 0.25]
    expect(parts[niveauPourEchelle(0.45, parts)]).toBe(0.5)
    expect(parts[niveauPourEchelle(1.8, parts)]).toBe(2)
  })
})

// La largeur et la hauteur d'un AVIF sont dans sa boîte « ispe » : pas besoin de décoder l'image.
function tailleAvif(chemin: string): [number, number] {
  const b = readFileSync(chemin)
  const i = b.indexOf('ispe')
  if (i < 0) throw new Error(`pas de boîte ispe dans ${chemin}`)
  return [b.readUInt32BE(i + 8), b.readUInt32BE(i + 12)]
}

describe('les planches livrées', () => {
  const dossier = join(__dirname, '../assets/quartier')
  const { an, gestes } = JSON.parse(readFileSync(join(dossier, 'donnees.json'), 'utf8')) as {
    an: { cw: number; ch: number }
    gestes: Record<string, { r: number; e?: { r: number } }>
  }
  const planches = readdirSync(dossier).filter((f) => /^atlas.*\.avif$/.test(f))
  // Chaque planche porte toutes les rangées que donnees.json fait jouer (28 depuis les visages de conv-1558) : une
  // rangée qui manque chez un animal le rendrait invisible dans ce geste.
  const rangees = 1 + Math.max(...Object.values(gestes).flatMap((g) => [g.r, g.e?.r ?? 0]))

  it('donnees.json fait jouer 28 rangées, visages compris', () => {
    expect(rangees).toBe(28)
    expect(gestes.bz.r).toBe(26)
    expect(gestes.su.r).toBe(27)
  })

  it.each(planches)(
    '%s : 12 colonnes et toutes les rangées de la grille, à une finesse entière',
    (f) => {
      const [w, h] = tailleAvif(join(dossier, f))
      const k = finesseDePlanche(w, an.cw)
      expect(w).toBe(COLONNES_PLANCHE * an.cw * k)
      expect(h).toBe(rangees * an.ch * k)
    }
  )
})
