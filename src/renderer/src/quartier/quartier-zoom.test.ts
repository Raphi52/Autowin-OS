import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import {
  bornerVue,
  MARGE_BORD,
  rapprocherZoom,
  REMPLISSAGE,
  sourcesDesBords,
  TAMPON_BORDS,
  ZOOM_MAX,
  zoomSur
} from './quartier-zoom'

// La vue au repos, en pixels de scène, pour une fenêtre de 1745 × 938 (menu de 236 px) : 1344 × 835.
const VUE_L = 1344
const VUE_H = 835
const CLIQUABLES = (
  donnees as unknown as { obj: { cle?: string; nom?: string; w: number; h: number }[] }
).obj.filter((o) => o.cle && o.nom)

describe('le zoom au clic (conv-1424, « beaucoup plus proche »)', () => {
  it('chaque élément cliquable remplit presque la vue, sans en sortir', () => {
    expect(CLIQUABLES.length).toBeGreaterThan(8)
    for (const o of CLIQUABLES) {
      const z = zoomSur(o, VUE_L, VUE_H)
      const part = Math.max((o.w * z) / VUE_L, (o.h * z) / VUE_H)
      // Plafonné, un petit objet reste plus petit que la vue ; sinon il la remplit.
      if (z < ZOOM_MAX) expect(part, o.nom).toBeCloseTo(REMPLISSAGE, 5)
      expect(part, o.nom).toBeLessThanOrEqual(REMPLISSAGE + 1e-9)
    }
  })

  it("va beaucoup plus près qu'avant : au moins une fois et demie l'ancien zoom", () => {
    for (const o of CLIQUABLES) {
      const avant = Math.min(3, 760 / Math.max(o.w, o.h * 1.75))
      expect(zoomSur(o, VUE_L, VUE_H) / avant, o.nom).toBeGreaterThan(1.5)
    }
  })

  it('un tanuki, tout petit, est plafonné pour ne pas devenir flou', () => {
    expect(zoomSur({ w: 61, h: 76 }, VUE_L, VUE_H)).toBe(ZOOM_MAX)
    expect(zoomSur({ w: 5000, h: 5000 }, VUE_L, VUE_H)).toBe(1)
  })

  it('le zoom avance sans bond, et a fait plus de 90 % du chemin quand la vue s’ouvre', () => {
    let zv = 1
    let pire = 1
    for (let t = 0; t < 0.64; t += 1 / 30) {
      const avant = zv
      zv = rapprocherZoom(zv, ZOOM_MAX, 1 / 30)
      pire = Math.max(pire, zv / avant)
      expect(zv).toBeLessThanOrEqual(ZOOM_MAX)
    }
    // Une image ne grossit jamais la scène de plus d'un tiers d'elle-même.
    expect(pire).toBeLessThan(1.33)
    expect(Math.log(zv) / Math.log(ZOOM_MAX)).toBeGreaterThan(0.9)
    // Et il se défait de même au retour.
    for (let i = 0; i < 90; i++) zv = rapprocherZoom(zv, 1, 1 / 30)
    expect(zv).toBeCloseTo(1, 2)
  })
})

describe('la roue et la clé, au bord de la peinture, se centrent au zoom (conv-1424)', () => {
  const objets = (
    donnees as unknown as { obj: { cle?: string; x: number; y: number; w: number; h: number }[] }
  ).obj
  // Fenêtres courantes, la vue au repos en pixels de scène : 1745 × 938, 2560 × 1440, 3440 × 1440.
  const VUES: [number, number][] = [
    [1344, 835],
    [1344, 832],
    [1344, 605]
  ]

  it.each(['settings', 'tests'])('« %s » finit au milieu de l’écran', (cle) => {
    const o = objets.find((q) => q.cle === cle)
    expect(o, cle).toBeDefined()
    if (!o) return
    for (const [l, h] of VUES) {
      const vue = l / zoomSur(o, l, h)
      const debut = bornerVue(o.x + o.w / 2, vue, 0, 1344, MARGE_BORD)
      // Avant, sans marge, la roue finissait à plus d'un quart de vue du centre.
      expect(Math.abs(debut + vue / 2 - (o.x + o.w / 2)), `${cle} ${l}×${h}`).toBeLessThan(1)
    }
  })

  it('au repos, rien ne change : la vue reste dans la peinture', () => {
    for (let c = -400; c < 1800; c += 37)
      for (const vue of [300, 900, 1344])
        expect(bornerVue(c, vue, 0, 1344, 0)).toBe(Math.max(0, Math.min(1344 - vue, c - vue / 2)))
  })

  it('le débord ne dépasse jamais la peinture prolongée', () => {
    for (let c = -400; c < 1800; c += 37) {
      const d = bornerVue(c, 220, 0, 1344, MARGE_BORD)
      expect(d).toBeGreaterThanOrEqual(-MARGE_BORD)
      expect(d + 220).toBeLessThanOrEqual(1344 + MARGE_BORD)
    }
  })
})

/** La taille d'une image AVIF, lue dans sa boîte `ispe` (taille, type, version, largeur, hauteur). */
function tailleAvif(nom: string): [number, number] {
  const o = readFileSync(fileURLToPath(new URL(`../assets/quartier/${nom}`, import.meta.url)))
  const i = o.indexOf('ispe')
  return [o.readUInt32BE(i + 8), o.readUInt32BE(i + 12)]
}

describe('les bords prolongés se lisent à leur propre échelle (conv-1644, bande bleue au zoom)', () => {
  const [largeur, hauteur] = tailleAvif('bords.avif')

  it('chaque bord est lu en entier, toute sa hauteur et toute sa largeur', () => {
    const { gauche, droite } = sourcesDesBords(largeur, hauteur)
    expect(gauche.h).toBe(hauteur)
    expect(droite.h).toBe(hauteur)
    expect(droite.x).toBe(gauche.l + TAMPON_BORDS)
    expect(droite.x + droite.l).toBe(largeur)
    // Un bord fait MARGE_BORD de large sur la hauteur de la scène (768) : il n'est pas déformé.
    expect(gauche.l / gauche.h).toBeCloseTo(MARGE_BORD / 768, 3)
  })
})
