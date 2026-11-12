import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COLONNES_PLANCHE,
  echelleMin,
  finesseDePlanche,
  lirePlanche,
  niveauPourEchelle,
  reductionMin
} from './quartier-planche'

// Les parts réelles de la planche 126 × 170 : 1, 63/126, 32/126, 16/126.
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

  it("rend le plus court des deux axes de la planche une fois posés à l'écran (ombre portée)", () => {
    const k = 0.5
    expect(echelleMin({ a: k, b: 0, c: 0.46 * k, d: -0.2 * k })).toBeCloseTo(
      Math.hypot(0.46, 0.2) * k
    )
  })
})

describe('reductionMin', () => {
  it("vaut l'échelle uniforme d'un personnage, miroir compris", () => {
    expect(reductionMin({ a: -0.4, b: 0, c: 0, d: 0.4 })).toBeCloseTo(0.4)
  })

  it('une rotation ne réduit rien', () => {
    const t = 0.7
    const rotation = { a: Math.cos(t), b: Math.sin(t), c: -Math.sin(t), d: Math.cos(t) }
    expect(reductionMin(rotation)).toBeCloseTo(1)
  })

  it("l'ombre portée est écrasée plus fort, en biais, que sur ses deux axes", () => {
    const ombre = { a: 1, b: 0, c: 0.46, d: -0.2 }
    expect(reductionMin(ombre)).toBeCloseTo(0.1812, 3)
    expect(reductionMin(ombre)).toBeLessThan(echelleMin(ombre))
  })
})

/**
 * Le zoom sur un tanuki (« sur rdp quand je clique sur un tanuki le zoom est ultra laggy ») : planche ×2,
 * vue au repos à ~1,12 pixel d'écran par pixel de scène, tanuki de 76 px de haut (k = 76 / 140,9), zoom ×1 à ×6.
 */
describe('lirePlanche, du repos au zoom sur un tanuki', () => {
  const PARTS2 = [2, 1, 0.5, 0.25]
  const k = 76 / 140.926
  type Matrice = { a: number; b: number; c: number; d: number }
  const corps = (e: number): Matrice => ({ a: -e, b: 0, c: 0, d: e })
  const ombre = (e: number): Matrice => ({ a: e, b: 0, c: 0.46 * e, d: -0.2 * e })

  it('au repos, la case de 126 px en lissage rapide, comme avant', () => {
    expect(lirePlanche(corps(1.12 * k), PARTS2)).toEqual({ niveau: 1, rapide: true })
  })

  it('en pleine montée, la case de 252 px rétrécie aux trois quarts : lissage rapide', () => {
    // Avant : lissage fin dès que l'échelle passait 1, alors que la case ×2 était encore rétrécie.
    expect(lirePlanche(corps(1.5), PARTS2)).toEqual({ niveau: 0, rapide: true })
  })

  it('zoomé (×6), le corps agrandi garde le lissage fin de la scène, et reste net', () => {
    expect(lirePlanche(corps(6 * 1.12 * k), PARTS2)).toEqual({ niveau: 0, rapide: false })
  })

  it("zoomé (×6), l'ombre portée reste écrasée sous sa case : lissage rapide", () => {
    expect(lirePlanche(ombre(6 * 1.12 * k), PARTS2)).toEqual({ niveau: 0, rapide: true })
  })

  it('de ×1 à ×6, aucun dessin rétréci en lissage fin, aucun dessin agrandi en lissage rapide', () => {
    for (let z = 1; z <= 6; z += 0.05)
      for (const m of [corps(1.12 * z * k), ombre(1.12 * z * k)]) {
        const { niveau, rapide } = lirePlanche(m, PARTS2)
        expect(niveau).toBe(niveauPourEchelle(echelleMin(m), PARTS2))
        expect(rapide, `×${z.toFixed(2)}`).toBe(reductionMin(m) < PARTS2[niveau])
      }
  })
})

// Les animaux v3 sont rendus en ×2 : chaque planche fait 3024 × 9520 (28 rangées de 340 px).
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
  // Chaque planche porte toutes les rangées que donnees.json fait jouer (28 depuis les visages) : une
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
