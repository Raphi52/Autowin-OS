/**
 * Le reflet du pin, rejoue sur le bord des blocs (reflet-du-pin.ts). Ce que ces tests verrouillent :
 *  - la PLACE sur le tour : midi au milieu du bord haut, puis le sens horaire, a pas egaux le long du
 *    bord, les quatre points cardinaux au milieu des quatre cotes quelle que soit la forme du bloc ;
 *  - la COULEUR : un pixel de l'anneau prend la couleur de la texture a son degre, un pixel hors du
 *    bloc la lueur relevee sur la video, a sa distance, et rien au-dela de la marge du canvas ;
 *  - l'HORLOGE : 150 images en 5 s, la meme pour tous les blocs, en boucle ;
 *  - la TEXTURE livree : 360 degres x 150 images x 5 lignes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DECROISSANCE_EXTERIEURE,
  DEGRES,
  IMAGES,
  LIGNES,
  MARGE,
  decroissance,
  imageA,
  peindre,
  pointDuBord,
  tableDuBord,
  type TableDuBord
} from './reflet-du-pin'

const ICI = dirname(fileURLToPath(import.meta.url))
const fabrique = (l: number, h: number): ImageData =>
  ({ data: new Uint8ClampedArray(l * h * 4), width: l, height: h }) as unknown as ImageData

describe('imageA — l horloge de la video', () => {
  it('150 images en 5 s, en boucle, depuis l origine du document', () => {
    expect(imageA(0)).toBe(0)
    expect(imageA(34)).toBe(1)
    expect(imageA(4999)).toBe(IMAGES - 1)
    expect(imageA(5000)).toBe(0)
    expect(imageA(12_345)).toBe(imageA(2345))
    expect(imageA(-1)).toBe(IMAGES - 1)
  })
})

describe('pointDuBord — le cercle du pin pose sur le bord du bloc', () => {
  // Le milieu du trait : 1,5 px sous le bord exterieur.
  const formes: [number, number, number][] = [
    [350, 52, 16],
    [720, 52, 16],
    [200, 200, 10],
    [60, 400, 16]
  ]
  it.each(formes)('met midi, 3 h, 6 h et 9 h au milieu des cotes (%i x %i)', (l, h, r) => {
    const tour = (x: number, y: number): number => pointDuBord(x, y, l, h, r).tour
    expect(Math.min(tour(l / 2, 1.5), 1 - tour(l / 2, 1.5))).toBeLessThan(1e-9)
    expect(tour(l - 1.5, h / 2)).toBeCloseTo(0.25, 9)
    expect(tour(l / 2, h - 1.5)).toBeCloseTo(0.5, 9)
    expect(tour(1.5, h / 2)).toBeCloseTo(0.75, 9)
  })

  // ENTREE QUI DOIT FAIRE ECHOUER : un tour mesure en angle depuis le centre (sur un bloc large,
  // le bord haut prendrait presque tout le tour) ou un sens antihoraire.
  it('avance a pas egaux le long du bord, dans le sens horaire', () => {
    const [l, h, r] = [350, 52, 16]
    const a = l / 2 - r
    const b = h / 2 - r
    const arc = ((r - 1.5) * Math.PI) / 2
    const perimetre = 4 * a + 4 * b + 4 * arc
    expect(pointDuBord(l / 2 + 50, 1.5, l, h, r).tour).toBeCloseTo(50 / perimetre, 9)
    // Le coin haut-droit, a mi-arc : a + arc / 2 depuis midi.
    const c = Math.SQRT1_2 * (r - 1.5)
    expect(pointDuBord(l - r + c, r - c, l, h, r).tour).toBeCloseTo((a + arc / 2) / perimetre, 6)
    // Tout le long du bord, dans l'ordre horaire, le tour ne fait que croitre.
    let avant = -1
    for (let x = l / 2; x <= l - r; x += 10) {
      const t = pointDuBord(x, 1.5, l, h, r).tour
      expect(t).toBeGreaterThan(avant)
      avant = t
    }
    for (let y = r; y <= h - r; y += 4) {
      const t = pointDuBord(l - 1.5, y, l, h, r).tour
      expect(t).toBeGreaterThan(avant)
      avant = t
    }
  })

  it('mesure la distance au bord exterieur, negative dedans', () => {
    expect(pointDuBord(175, 0.5, 350, 52, 16).distance).toBeCloseTo(-0.5, 9)
    expect(pointDuBord(175, -4, 350, 52, 16).distance).toBeCloseTo(4, 9)
    expect(pointDuBord(-3, 26, 350, 52, 16).distance).toBeCloseTo(3, 9)
    // Dans un coin arrondi, la distance suit l'arc, pas le rectangle.
    expect(pointDuBord(0, 0, 350, 52, 16).distance).toBeCloseTo(16 * Math.SQRT2 - 16, 9)
  })
})

describe('tableDuBord + peindre — la texture repeinte le long du bord', () => {
  /** Une texture RGBA ou chaque ligne de chaque image est remplie par `remplir(ligne, degre)`. */
  function texture(remplir: (ligne: number, degre: number) => [number, number, number]) {
    const t = new Uint8ClampedArray(DEGRES * IMAGES * LIGNES * 4)
    for (let i = 0; i < IMAGES; i++)
      for (let ligne = 0; ligne < LIGNES; ligne++)
        for (let d = 0; d < DEGRES; d++) {
          const o = ((i * LIGNES + ligne) * DEGRES + d) * 4
          const [r, g, b] = remplir(ligne, d)
          t.set([r, g, b, 255], o)
        }
    return t
  }
  /** Le pixel du canvas qui couvre le point (x, y) du bloc, a 1 pixel par px. */
  function pixel(table: TableDuBord, x: number, y: number): number[] {
    const i = Math.floor(x + MARGE)
    const j = Math.floor(y + MARGE)
    for (const z of table.zones) {
      const { width, height, data } = z.image
      if (i < z.x || j < z.y || i >= z.x + width || j >= z.y + height) continue
      const o = ((j - z.y) * width + (i - z.x)) * 4
      return [...data.slice(o, o + 4)]
    }
    return [0, 0, 0, 0]
  }
  const [l, h, r] = [350, 52, 16]

  // ENTREE QUI DOIT FAIRE ECHOUER : un eclat peint au mauvais degre, ou un anneau transparent la ou
  // la video le montre noir.
  it('peint l anneau de la couleur de la texture a son degre, opaque', () => {
    // Rouge autour de 3 h (degres 80 a 100), noir ailleurs ; aucune lueur.
    const tex = texture((ligne, d) =>
      ligne >= 1 && ligne <= 3 && d >= 80 && d <= 100 ? [255, 0, 0] : [0, 0, 0]
    )
    const table = tableDuBord(l, h, r, 1, 1, fabrique)
    peindre(table, tex, 0)
    expect(pixel(table, l - 1.5, h / 2)).toEqual([255, 0, 0, 255])
    expect(pixel(table, l / 2, 1.5)).toEqual([0, 0, 0, 255])
    // Hors de l'anneau, sans lueur : rien.
    expect(pixel(table, l / 2, -4)[3]).toBe(0)
    expect(pixel(table, l / 2, 8)[3]).toBe(0)
  })

  it('peint chaque tiers de l epaisseur depuis sa ligne de texture', () => {
    // Ligne 1 = tiers interieur (bleu), 2 = milieu (vert), 3 = exterieur (rouge).
    const couleurs: Record<number, [number, number, number]> = {
      1: [0, 0, 255],
      2: [0, 255, 0],
      3: [255, 0, 0]
    }
    const tex = texture((ligne) => couleurs[ligne] ?? [0, 0, 0])
    const table = tableDuBord(l, h, r, 1, 1, fabrique)
    peindre(table, tex, 0)
    expect(pixel(table, l / 2, 0.5)).toEqual([255, 0, 0, 255])
    expect(pixel(table, l / 2, 1.5)).toEqual([0, 255, 0, 255])
    expect(pixel(table, l / 2, 2.5)).toEqual([0, 0, 255, 255])
  })

  // La lueur est une lumiere AJOUTEE : son alpha est sa force, qui decroit comme sur la video, et
  // s'eteint avant le bord du canvas (un canvas coupe net dessinerait un cadre).
  it('fait decroitre la lueur dehors comme la video, jusqu a zero au bord du canvas', () => {
    const tex = texture((ligne) => (ligne === 4 ? [255, 255, 255] : [0, 0, 0]))
    const table = tableDuBord(l, h, r, 1, 1, fabrique)
    peindre(table, tex, 0)
    const alpha = (d: number): number => pixel(table, l / 2, -d)[3]!
    expect(alpha(1.5)).toBeCloseTo(255 * decroissance(DECROISSANCE_EXTERIEURE, 1.5), -1)
    expect(alpha(4.5)).toBeCloseTo(255 * decroissance(DECROISSANCE_EXTERIEURE, 4.5), -1)
    expect(alpha(1.5)).toBeGreaterThan(alpha(4.5))
    expect(alpha(4.5)).toBeGreaterThan(alpha(8.5))
    // Les 3 derniers px s'eteignent, a zero au dernier pixel : a 8,5 px, le tiers de la valeur relevee.
    expect(alpha(8.5)).toBeCloseTo((255 * decroissance(DECROISSANCE_EXTERIEURE, 8.5)) / 3, -1)
    expect(pixel(table, l / 2, -(MARGE - 0.5))[3]).toBe(0)
  })

  it('eteint la lueur quand le bloc le demande (scene 3D)', () => {
    const tex = texture((ligne) => (ligne === 4 || ligne === 0 ? [255, 255, 255] : [0, 0, 0]))
    const table = tableDuBord(l, h, r, 1, 0, fabrique)
    peindre(table, tex, 0)
    expect(pixel(table, l / 2, -1.5)[3]).toBe(0)
    expect(pixel(table, l / 2, 4.5)[3]).toBe(0)
    expect(pixel(table, l / 2, 1.5)[3]).toBe(255)
  })

  it('ne peint que la bande du bord, jamais le milieu d un grand bloc', () => {
    const table = tableDuBord(720, 600, 16, 1, 1, fabrique)
    const peints = table.zones.reduce((n, z) => n + z.octet.length, 0)
    const canvas = table.largeur * table.hauteur
    expect(peints).toBeLessThan(canvas * 0.15)
  })
})

describe('la texture du pin livree avec l application', () => {
  // WebP sans perte : un canal de couleur a 4:2:0 melangerait deux lignes voisines (deux tiers de
  // l'anneau, ou deux images). En-tete VP8L : largeur-1 et hauteur-1 sur 14 bits.
  it('fait 360 degres sur 150 images de 5 lignes, sans perte', () => {
    const octets = readFileSync(join(ICI, '..', 'assets', 'anneau-du-pin.webp'))
    expect(octets.subarray(0, 4).toString('latin1')).toBe('RIFF')
    expect(octets.subarray(8, 16).toString('latin1')).toBe('WEBPVP8L')
    expect(octets[20]).toBe(0x2f)
    const bits = octets.readUInt32LE(21)
    expect((bits & 0x3fff) + 1).toBe(DEGRES)
    expect(((bits >>> 14) & 0x3fff) + 1).toBe(IMAGES * LIGNES)
  })
})
