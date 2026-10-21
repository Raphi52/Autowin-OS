import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { VIADUC } from './home-decor-avenue'
import {
  ACCROCHES_RANGEE,
  hauteurMurRangee,
  LOTS_RANGEE,
  monterRangee,
  VITRINES_RANGEE
} from './home-decor-avenue-rangee'

/**
 * LA RANGÉE DE DROITE EN VOLUMES (conv-1037).
 *
 * Demande de l'utilisateur : « la barre d'immeuble de droite a les toits qui forment une ligne droite
 * ca fait pas naturelle et les boutiques et tags font trop basique refait toute la partie de droite »,
 * puis, après deux tours de /draft, « implémenter 1+2 ».
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. le retour au plan peint de 24 m (ou des toits tous à la même hauteur) → la ligne droite revient ;
 *   2. un lot creusé là où le décor accroche la porte du deal, le mur du taggeur, l'entrée du viaduc,
 *      la marquise ou une enseigne en drapeau → ils flottent dans le vide ;
 *   3. une lumière ponctuelle ou une matière transparente ajoutée → tous les programmes de la rue
 *      recompilés, ou les lots de halos coupés (home-decor-lots-halos.ts) ;
 *   4. la travée non fusionnée → des centaines d'objets de plus à chaque image ;
 *   5. une image chargée au lieu d'être dessinée par code.
 */

const P = 35
const Z0 = -130
const F = 7.5

const faux2d = (): CanvasRenderingContext2D => {
  const degrade = { addColorStop: (): void => {} }
  return new Proxy(
    {},
    {
      get: (_c, cle) =>
        cle === 'createRadialGradient' || cle === 'createLinearGradient'
          ? () => degrade
          : cle === 'measureText'
            ? () => ({ width: 10 })
            : () => {},
      set: () => true
    }
  ) as unknown as CanvasRenderingContext2D
}

function monter(): { decor: THREE.Group; animer: (t: number) => void } {
  const decor = new THREE.Group()
  const rangee = monterRangee({
    decor,
    P,
    Z0,
    copies: 4,
    FACADE: F,
    TROTTOIR: 0.15,
    toile: (w, h) => [{ width: w, height: h } as unknown as HTMLCanvasElement, faux2d()],
    tex: (c) => new THREE.CanvasTexture(c),
    glow: (color, size, x, y, z, op = 1, parent = decor) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, opacity: op }))
      s.scale.set(size, size, 1)
      s.position.set(x, y, z)
      parent.add(s)
      return s
    }
  })
  decor.updateMatrixWorld(true)
  return { decor, animer: rangee.animer }
}

/** Les géométries fusionnées de la rangée (la grue, qui pivote, n'en fait pas partie). */
const fusionnees = (decor: THREE.Group): THREE.Mesh[] =>
  decor.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && o.name === 'rangee')

/** Le premier obstacle rencontré depuis le trottoir d'en face, en regardant la façade (+x). */
function depuisLaRue(cibles: THREE.Mesh[], u: number, y: number): THREE.Vector3 | null {
  const r = new THREE.Raycaster(new THREE.Vector3(-2, y, Z0 + P + u), new THREE.Vector3(1, 0, 0))
  return r.intersectObjects(cibles, false)[0]?.point ?? null
}

/** Le plus haut point bâti à l'abscisse u, à 3 m derrière la ligne de façade. */
function faite(cibles: THREE.Mesh[], u: number): number {
  const r = new THREE.Raycaster(
    new THREE.Vector3(F + 3, 80, Z0 + P + u),
    new THREE.Vector3(0, -1, 0)
  )
  return r.intersectObjects(cibles, false)[0]?.point.y ?? 0
}

describe('fond de l Accueil — la rangée de droite en volumes (conv-1037)', () => {
  it('LES TOITS NE FONT PLUS UNE LIGNE DROITE : des faîtes de hauteurs différentes d un lot à l autre', () => {
    const cibles = fusionnees(monter().decor)
    // la moitié centrale de chaque lot : aux bords, le débord d'un toit voisin fausserait la mesure
    const hauts = LOTS_RANGEE.map((lot) => {
      const w = lot.u1 - lot.u0
      let max = 0
      for (let u = lot.u0 + w / 4; u <= lot.u1 - w / 4; u += 0.25)
        max = Math.max(max, faite(cibles, u))
      return max
    })
    // mesuré sur la géométrie réelle : chaque lot diffère de son voisin d'au moins 2,5 m
    for (let i = 0; i < hauts.length; i++)
      expect(Math.abs(hauts[i] - hauts[(i + 1) % hauts.length])).toBeGreaterThan(2.5)
    expect(Math.max(...hauts) - Math.min(...hauts)).toBeGreaterThan(15)
    expect(new Set(hauts.map((h) => Math.round(h))).size).toBe(hauts.length)
  })

  it('UN MUR LÀ OÙ LE DÉCOR ACCROCHE QUELQUE CHOSE : rien ne flotte dans le vide', () => {
    const cibles = fusionnees(monter().decor)
    const hauteurs: Record<string, [number, number]> = {
      'porte du deal': [0.5, 2.5],
      // 2,55 et non 2,65 : à 2,6 m pile, le tir passe entre la palissade et la façade qui s'y joignent
      'mur du taggeur': [1.2, 2.55],
      'entrée du viaduc': [9.6, 13.9],
      marquise: [10, 12.4]
    }
    for (const a of ACCROCHES_RANGEE) {
      const [y0, y1] = hauteurs[a.nom] ?? [4, 9.2]
      for (const u of [a.u0 + 0.02, (a.u0 + a.u1) / 2, a.u1 - 0.02])
        for (const y of [y0, (y0 + y1) / 2, y1]) {
          const point = depuisLaRue(cibles, u, y)
          expect(point, `${a.nom} à u ${u.toFixed(2)}, y ${y}`).not.toBeNull()
          expect(
            Math.abs((point as THREE.Vector3).x - F),
            `${a.nom} à u ${u.toFixed(2)}, y ${y}`
          ).toBeLessThan(0.08)
        }
      for (let u = a.u0; u <= a.u1; u += 0.1)
        expect(hauteurMurRangee(u)).toBeGreaterThanOrEqual(a.haut)
    }
  })

  it('les accroches sont bien celles du décor : lieux de la boucle de 70 m ramenés dans la travée', () => {
    const source = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')
    const u = (z: number): number => (((z - Z0) % P) + P) % P
    const deal = Number(/const Z_DEAL = (-?\d+)/.exec(source)?.[1])
    const tag = Number(/const Z_TAG = (-?\d+)/.exec(source)?.[1])
    const nommee = (nom: string): (typeof ACCROCHES_RANGEE)[number] => {
      const a = ACCROCHES_RANGEE.find((x) => x.nom === nom)
      if (!a) throw new Error(nom)
      return a
    }
    // la porte est posée à +1,1 m de Z_DEAL, le plan du tag fait 4,8 m, le tablier 3,2 m
    expect(u(deal + 1.1)).toBeCloseTo(
      (nommee('porte du deal').u0 + nommee('porte du deal').u1) / 2,
      5
    )
    expect(nommee('mur du taggeur').u0).toBeLessThanOrEqual(u(tag) - 2.4)
    expect(nommee('mur du taggeur').u1).toBeGreaterThanOrEqual(u(tag) + 2.4)
    expect(nommee('entrée du viaduc').u0).toBeLessThanOrEqual(u(VIADUC.z) - VIADUC.profondeur / 2)
    expect(nommee('entrée du viaduc').u1).toBeGreaterThanOrEqual(
      u(VIADUC.z) + VIADUC.profondeur / 2
    )
  })

  it('la hauteur du mur se lit à n importe quelle abscisse : la rangée se répète tous les 35 m', () => {
    expect(hauteurMurRangee(1)).toBe(hauteurMurRangee(36))
    expect(hauteurMurRangee(-34)).toBe(hauteurMurRangee(1))
    expect(hauteurMurRangee(25)).toBe(8.5)
    // les lots couvrent toute la travée, sans trou ni recouvrement
    LOTS_RANGEE.forEach((lot, i) => expect(lot.u0).toBe(i === 0 ? 0 : LOTS_RANGEE[i - 1].u1))
    expect(LOTS_RANGEE[LOTS_RANGEE.length - 1].u1).toBe(P)
    for (const [u, w] of VITRINES_RANGEE) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u + w).toBeLessThanOrEqual(P)
    }
  })

  it('AUCUNE LUMIÈRE, AUCUNE MATIÈRE TRANSPARENTE, et la travée est fusionnée', () => {
    const { decor, animer } = monter()
    const meshes: THREE.Mesh[] = []
    decor.traverse((o) => {
      expect((o as THREE.Light).isLight, o.type).toBeFalsy()
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
    })
    for (const m of meshes) expect((m.material as THREE.Material).transparent, m.name).toBe(false)
    // une géométrie par matière pour les quatre copies (9 matières), et les grues en instances
    // (1 dessin) : la première version en faisait 64, soit 102 dessins de plus par image au banc
    expect(fusionnees(decor).length).toBeLessThanOrEqual(9)
    expect(meshes.length).toBeLessThanOrEqual(10)
    expect(() => {
      animer(0)
      animer(12.5)
    }).not.toThrow()
  })

  it('LA RANGÉE EST DESSINÉE PAR CODE : aucune image chargée, aucune lumière dans le source', () => {
    const source = readFileSync(new URL('./home-decor-avenue-rangee.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toMatch(
      /\b\w*Loader\b|new Image\b|createImageBitmap|\bfetch\s*\(|\.src\s*=|url\(/
    )
    expect(source).not.toMatch(/\.(png|jpe?g|webp|avif|gif)\b/i)
    expect(source).not.toMatch(
      /new THREE\.(PointLight|SpotLight|DirectionalLight)\(|transparent: true/
    )
  })
})
