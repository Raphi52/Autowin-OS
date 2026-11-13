/**
 * Le reflet du pin, rejoue sur le bord des blocs (reflet-du-pin.ts). Ce que ces tests verrouillent :
 *  - la PLACE sur le tour : midi au milieu du bord haut, puis le sens horaire, a pas egaux le long du
 *    bord, les quatre points cardinaux au milieu des quatre cotes quelle que soit la forme du bloc ;
 *  - l'ANNEAU : un pixel du trait prend la couleur de la texture a son degre, tiers par tiers ;
 *  - la LUMIERE : la lueur dehors decroit comme sur la video jusqu'a zero au bord du canvas ; le
 *    VERRE du bloc s'eclaire jusqu'au centre du bouton ; composee sur le fond du theme, elle eclaircit
 *    un fond clair vers le blanc au lieu de le teinter ;
 *  - le TEMPS : 150 images en 5 s, deux images voisines melangees, un decalage propre a chaque bloc ;
 *  - la TEXTURE livree : 360 degres x 150 images x 5 lignes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DECALAGE_MAX,
  DECROISSANCE_EXTERIEURE,
  DEGRES,
  ECHELLE_LUEUR,
  IMAGES,
  LIGNES,
  MARGE,
  NOIR_JUSQUA,
  COULEUR_DES,
  LIGNES_REJOUEES,
  PROFONDEUR_DU_VERRE,
  VERRE_LOCAL,
  VERRE_SEUIL,
  VERRE_VOISINS_20,
  VERRE_VOISINS_40,
  avecLesVoisins,
  cranDePeinture,
  peindreACeTic,
  couleurRgb,
  decalageDe,
  decroissance,
  eclatsMoyens,
  peindre,
  pointDuBord,
  positionA,
  tableDuBord,
  type DernierePeinture,
  type Source,
  type TableDuBord
} from './reflet-du-pin'

const ICI = dirname(fileURLToPath(import.meta.url))
const fabrique = (l: number, h: number): ImageData =>
  ({ data: new Uint8ClampedArray(l * h * 4), width: l, height: h }) as unknown as ImageData

describe('positionA — le temps de la video', () => {
  it('150 images en 5 s, en boucle, decimales entre deux images', () => {
    expect(positionA(0)).toBe(0)
    expect(positionA(50)).toBeCloseTo(1.5, 9)
    expect(positionA(5000)).toBe(0)
    expect(positionA(12_345)).toBeCloseTo(positionA(2345), 9)
    expect(positionA(-1)).toBeCloseTo(IMAGES - 0.03, 9)
    // Le decalage d'un bloc avance sa video, toujours dans la boucle.
    expect(positionA(4990, 3)).toBeCloseTo(2.7, 9)
  })

  // ENTREE QUI DOIT FAIRE ECHOUER : un meme decalage pour tous les blocs, ou un decalage hors de la
  // boucle annoncee.
  it('donne a chaque place de la page son decalage, stable et borne', () => {
    const vus = new Set<number>()
    for (let x = 0; x < 800; x += 64)
      for (let y = 0; y < 2000; y += 48) {
        const d = decalageDe(x, y)
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThan(DECALAGE_MAX)
        vus.add(Math.floor(d))
      }
    expect(vus.size).toBe(DECALAGE_MAX)
    expect(decalageDe(364, 120)).toBe(decalageDe(366, 121))
    expect(decalageDe(16, 120)).not.toBe(decalageDe(380, 120))
  })
})

describe('peindreACeTic — 30 peintures par seconde, au meme tic pour tous les blocs', () => {
  /**
   * Les tics d'une seconde d'un ecran a `hz` qui peignent (une peinture a l'instant 1000), les tics
   * impairs avances et les pairs retardes de `gigue` ms.
   */
  function tics(hz: number, gigue = 0): number[] {
    const derniere: DernierePeinture = { cran: cranDePeinture(1000), instant: 1000 }
    const peints: number[] = []
    for (let k = 1; k <= hz; k++) {
      const t = 1000 + (k * 1000) / hz + (k % 2 ? -gigue : gigue)
      if (peindreACeTic(t, derniere)) peints.push(t)
    }
    return peints
  }

  // Peint a la cadence de l'ecran (60 images/s), le reflet coutait 3 a 21 % de la GT 1030 du poste,
  // contre 1,2 a 1,7 % a 30 (mesure du 2026-11-13). ENTREE QUI DOIT FAIRE ECHOUER : une cadence liee a
  // la frequence de l'ecran, ou un ecran a 30 Hz qui perd des images sur les bords des crans.
  it('peint 30 fois par seconde, quel que soit l ecran', () => {
    for (const hz of [30, 60, 75, 120, 144]) expect(tics(hz).length, `${hz} Hz`).toBe(30)
  })

  it('reste a 30 par seconde quand les tics de l ecran tremblent', () => {
    expect(tics(60, 2).length).toBe(30)
    expect(tics(144, 1).length).toBe(30)
  })

  // La decision ne depend que de l'instant et de la peinture COMMUNE : tous les blocs a l'ecran
  // peignent au meme tic, et la fenetre ne se recompose qu'une fois par image.
  it('ne peint jamais deux fois dans la meme image de la video', () => {
    for (const hz of [60, 120, 144]) {
      const peints = tics(hz)
      for (let i = 1; i < peints.length; i++)
        expect(peints[i]! - peints[i - 1]!, `${hz} Hz`).toBeGreaterThan(1000 / 30 - 8)
    }
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

  // ENTREE QUI DOIT FAIRE ECHOUER : un tour mesure en angle depuis le centre (sur un bloc large, un
  // reflet passerait de 0,5 a 17,7 epaisseurs de trait selon sa place) ou un sens antihoraire.
  it('avance a pas egaux le long du bord, dans le sens horaire', () => {
    const [l, h, r] = [350, 52, 16]
    const a = l / 2 - r
    const b = h / 2 - r
    const arc = ((r - 1.5) * Math.PI) / 2
    const perimetre = 4 * a + 4 * b + 4 * arc
    expect(pointDuBord(l / 2 + 50, 1.5, l, h, r).tour).toBeCloseTo(50 / perimetre, 9)
    expect(pointDuBord(l / 2 + 150, 1.5, l, h, r).tour).toBeCloseTo(150 / perimetre, 9)
    const c = Math.SQRT1_2 * (r - 1.5)
    expect(pointDuBord(l - r + c, r - c, l, h, r).tour).toBeCloseTo((a + arc / 2) / perimetre, 6)
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
    expect(pointDuBord(0, 0, 350, 52, 16).distance).toBeCloseTo(16 * Math.SQRT2 - 16, 9)
  })
})

/** Une texture RGBA : chaque ligne de chaque image remplie par `remplir(ligne, degre, image)`. */
function texture(
  remplir: (ligne: number, degre: number, image: number) => [number, number, number]
): Uint8ClampedArray {
  const t = new Uint8ClampedArray(DEGRES * IMAGES * LIGNES * 4)
  for (let i = 0; i < IMAGES; i++)
    for (let ligne = 0; ligne < LIGNES; ligne++)
      for (let d = 0; d < DEGRES; d++) {
        const [r, g, b] = remplir(ligne, d, i)
        t.set([r, g, b, 255], ((i * LIGNES + ligne) * DEGRES + d) * 4)
      }
  return t
}
const source = (tex: Uint8ClampedArray, fond: [number, number, number] = [0, 0, 0]): Source => ({
  texture: avecLesVoisins(tex),
  eclats: eclatsMoyens(tex),
  fond
})
/** Le pixel de la couche qui couvre le point (x, y) du bloc (px CSS). */
function pixel(table: TableDuBord, x: number, y: number, pas: number): number[] {
  const i = Math.floor((x + MARGE) / pas)
  const j = Math.floor((y + MARGE) / pas)
  for (const z of table.zones) {
    const { width, height, data } = z.image
    if (i < z.x || j < z.y || i >= z.x + width || j >= z.y + height) continue
    const o = ((j - z.y) * width + (i - z.x)) * 4
    return [...data.slice(o, o + 4)]
  }
  return [0, 0, 0, 0]
}
const [l, h, r] = [350, 52, 16]

describe('la couche de l anneau — la texture repeinte le long du trait', () => {
  // ENTREE QUI DOIT FAIRE ECHOUER : un eclat peint au mauvais degre, ou un trait peint la ou la
  // lumiere ne passe pas (il masquerait l'anneau noir de la feuille et son liseré).
  it('peint l eclat de la couleur de la texture a son degre, et laisse le noir a la feuille', () => {
    const tex = texture((ligne, d) =>
      ligne >= 1 && ligne <= 3 && d >= 80 && d <= 100 ? [255, 0, 0] : [0, 0, 0]
    )
    const table = tableDuBord('anneau', l, h, r, 1, 1, fabrique)
    peindre(table, source(tex), 0)
    expect(pixel(table, l - 1.5, h / 2, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(table, l / 2, 1.5, 1)[3]).toBe(0)
    expect(pixel(table, l / 2, -4, 1)[3]).toBe(0)
    expect(pixel(table, l / 2, 8, 1)[3]).toBe(0)
  })

  // « quand ya pas la lumiere qui passe ca doit etre noir » : au niveau des bords de l'anneau du pin
  // au repos (13 %), le trait s'efface ; la couleur revient en entier a 50 % (« monte le seuil [...] de
  // 35 % a 50 % pour avoir plus de noir au repos »). ENTREE QUI DOIT FAIRE ECHOUER : un trait gris ou
  // colore la ou le pin est au repos, ou une lueur de 40 % deja peinte en entier (le seuil de 35 %).
  it('efface le trait au repos et le garde entier dans la lumiere', () => {
    const niveau = (force: number): number => {
      const tex = texture((ligne) => (ligne >= 1 && ligne <= 3 ? [force, force, force] : [0, 0, 0]))
      const table = tableDuBord('anneau', l, h, r, 1, 1, fabrique)
      peindre(table, source(tex), 0)
      return pixel(table, l / 2, 1.5, 1)[3]!
    }
    expect(niveau(Math.round(0.09 * 255))).toBe(0)
    expect(niveau(Math.round(NOIR_JUSQUA * 255))).toBe(0)
    expect(niveau(Math.round(0.24 * 255))).toBeGreaterThan(0)
    expect(niveau(Math.round(0.24 * 255))).toBeLessThan(255)
    expect(niveau(Math.round(0.4 * 255))).toBeLessThan(255)
    expect(niveau(Math.round(COULEUR_DES * 255) + 1)).toBe(255)
    expect(niveau(255)).toBe(255)
  })

  it('peint chaque tiers de l epaisseur depuis sa ligne de texture', () => {
    const couleurs: Record<number, [number, number, number]> = {
      1: [0, 0, 255],
      2: [0, 255, 0],
      3: [255, 0, 0]
    }
    const tex = texture((ligne) => couleurs[ligne] ?? [0, 0, 0])
    const table = tableDuBord('anneau', l, h, r, 1, 1, fabrique)
    peindre(table, source(tex), 0)
    expect(pixel(table, l / 2, 0.5, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(table, l / 2, 1.5, 1)).toEqual([0, 255, 0, 255])
    expect(pixel(table, l / 2, 2.5, 1)).toEqual([0, 0, 255, 255])
  })

  // A 30 images/s sans melange, chaque image restait deux rafraichissements d'un ecran a 60 Hz.
  // ENTREE QUI DOIT FAIRE ECHOUER : une position arrondie a l'image entiere.
  it('melange les deux images voisines selon le temps', () => {
    const tex = texture((ligne, _d, i) => (ligne === 2 ? [i % 2 === 0 ? 0 : 200, 0, 0] : [0, 0, 0]))
    const table = tableDuBord('anneau', l, h, r, 1, 1, fabrique)
    peindre(table, source(tex), 10)
    expect(pixel(table, l / 2, 1.5, 1)[0]).toBe(0)
    peindre(table, source(tex), 10.5)
    expect(pixel(table, l / 2, 1.5, 1)[0]).toBe(100)
    peindre(table, source(tex), 10.75)
    expect(pixel(table, l / 2, 1.5, 1)[0]).toBe(150)
  })
})

describe('la couche de lumiere — lueur dehors et verre du bloc', () => {
  const pas = ECHELLE_LUEUR
  const blanc = (lignes: number[]): Uint8ClampedArray =>
    texture((ligne) => (lignes.includes(ligne) ? [255, 255, 255] : [0, 0, 0]))

  it('fait decroitre la lueur dehors comme la video, jusqu a zero au bord du canvas', () => {
    const table = tableDuBord('lumiere', l, h, r, 1 / pas, 1, fabrique)
    peindre(table, source(blanc([4])), 0)
    // Les centres des pixels de lumiere tombent a 1, 3, 5, 7 et 9 px au-dessus du bloc.
    const alpha = (d: number): number => pixel(table, l / 2 - 1, -d, pas)[3]!
    expect(alpha(1)).toBe(255)
    expect(alpha(5)).toBeCloseTo(255 * decroissance(DECROISSANCE_EXTERIEURE, 5), -1)
    expect(alpha(3)).toBeGreaterThan(alpha(5))
    expect(alpha(5)).toBeGreaterThan(alpha(7))
    expect(alpha(9)).toBeLessThan(alpha(7) / 2)
  })

  // « La gerbe n'eclaire pas le bloc » (relecture du 2026-11-13) : sur le pin, le verre s'eclaire
  // jusqu'au centre du bouton. ENTREE QUI DOIT FAIRE ECHOUER : une lumiere arretee a quelques px du
  // trait, ou qui ne decroit pas avec la profondeur.
  it('eclaire le verre du bloc jusqu au centre du bouton, de moins en moins', () => {
    const table = tableDuBord('lumiere', 720, 120, r, 1 / pas, 1, fabrique)
    peindre(table, source(blanc([0])), 0)
    // Les centres des pixels de lumiere tombent a 1, 3, 5... px sous le bord : 2, 10 et 16 px sous
    // le trait de 3 px pour ceux de 5, 13 et 19.
    const alpha = (d: number): number => pixel(table, 360, 3 + d, pas)[3]!
    // Une lueur uniforme : le secteur et ses voisins valent la meme chose.
    const verre = (d: number): number =>
      [VERRE_LOCAL, VERRE_VOISINS_20, VERRE_VOISINS_40, VERRE_SEUIL].reduce(
        (somme, table) => somme + decroissance(table, d),
        0
      )
    expect(alpha(2)).toBeCloseTo(255 * verre(2), -1)
    expect(alpha(10)).toBeCloseTo(255 * verre(10), -1)
    expect(alpha(16)).toBeGreaterThan(0)
    expect(alpha(2)).toBeGreaterThan(alpha(10))
    expect(alpha(10)).toBeGreaterThan(alpha(16))
    // Au-dela du centre du bouton, le verre n'est plus eclaire.
    expect(alpha(PROFONDEUR_DU_VERRE + 6)).toBe(0)
  })

  it('ajoute au verre une part commune, qui suit l eclat moyen de l anneau', () => {
    const table = tableDuBord('lumiere', 720, 120, r, 1 / pas, 1, fabrique)
    // Aucune lueur, mais un anneau tout blanc : la part commune seule eclaire le verre.
    peindre(table, source(blanc([2])), 0)
    expect(pixel(table, 360, 3 + 16, pas)[3]).toBeGreaterThan(0)
    const noir = texture(() => [0, 0, 0])
    peindre(table, source(noir), 0)
    expect(pixel(table, 360, 3 + 16, pas)[3]).toBe(0)
  })

  // La gerbe eclaire le verre de biais : la lueur dedans est aussi moyennee a +-20 et +-40 degres,
  // en bouclant sur le tour. ENTREE QUI DOIT FAIRE ECHOUER : un voisinage qui ne boucle pas a midi.
  it('ajoute a la texture la lueur dedans moyennee sur ses voisins, en bouclant', () => {
    const tex = texture((ligne, d) =>
      ligne === 0 && (d === 100 || d === 359) ? [205, 0, 0] : [0, 0, 0]
    )
    const rejouee = avecLesVoisins(tex)
    const lu = (ligne: number, d: number): number => rejouee[(ligne * DEGRES + d) * 4]!
    expect(rejouee.length).toBe(DEGRES * IMAGES * LIGNES_REJOUEES * 4)
    expect(lu(0, 100)).toBe(205)
    expect(lu(5, 110)).toBe(5)
    expect(lu(5, 121)).toBe(0)
    expect(lu(6, 135)).toBe(3)
    // Le degre 359 eclaire ses voisins de l'autre cote de midi.
    expect(lu(5, 10)).toBe(5)
  })

  // En theme clair, une lumiere peinte comme sur un fond noir laissait des taches bleues et
  // orangees. Composee sur le fond, elle l'eclaircit : jamais un canal sous celui du fond.
  it('eclaircit un fond clair au lieu de le teinter', () => {
    const fond: [number, number, number] = [228, 230, 238]
    const tex = texture((ligne) => (ligne === 4 ? [30, 80, 160] : [0, 0, 0]))
    const table = tableDuBord('lumiere', l, h, r, 1 / pas, 1, fabrique)
    peindre(table, source(tex, fond), 0)
    const [pr, pv, pb, pa] = pixel(table, l / 2 - 1, -3, pas)
    const a = pa! / 255
    const vu = [pr!, pv!, pb!].map((c, i) => c * a + fond[i]! * (1 - a))
    for (let i = 0; i < 3; i++) expect(vu[i]).toBeGreaterThanOrEqual(fond[i]! - 1)
  })

  // La lueur deborde de 10 px et passe sur l'anneau noir du bloc voisin (6 px d'ecart dans le fil).
  // Une lumiere ajoutee l'eclaircit de ce qu'elle apporte ; un alpha tire de la marge restant
  // jusqu'au blanc la rendait opaque en theme clair et effacait cet anneau (film du 2026-11-13).
  // ENTREE QUI DOIT FAIRE ECHOUER : revenir a cet alpha.
  it('eclaire l anneau noir d un bloc voisin sans l effacer, meme en theme clair', () => {
    const fond: [number, number, number] = [228, 230, 238]
    const tex = texture((ligne) => (ligne === 4 ? [60, 60, 60] : [0, 0, 0]))
    const table = tableDuBord('lumiere', l, h, r, 1 / pas, 1, fabrique)
    peindre(table, source(tex, fond), 0)
    const [pr, , , pa] = pixel(table, l / 2 - 1, -5, pas)
    // Composee sur du noir : ce que la lueur ajoute, rien de plus.
    const surLeNoir = (pr! * pa!) / 255
    expect(surLeNoir).toBeCloseTo(60 * decroissance(DECROISSANCE_EXTERIEURE, 5), -1)
  })

  it('eteint la lumiere quand le bloc le demande (--reflet-lueur a 0)', () => {
    const table = tableDuBord('lumiere', l, h, r, 1 / pas, 0, fabrique)
    peindre(table, source(blanc([0, 4])), 0)
    expect(pixel(table, l / 2, -3, pas)[3]).toBe(0)
    expect(pixel(table, l / 2, 9, pas)[3]).toBe(0)
  })

  it('reste legere : un pixel pour quatre px, la bande du bord seulement', () => {
    const table = tableDuBord('lumiere', 720, 600, 16, 1 / pas, 1, fabrique)
    const peints = table.zones.reduce((n, z) => n + z.octet.length, 0)
    expect(peints).toBeLessThan(table.largeur * table.hauteur * 0.3)
    expect(table.largeur).toBe(Math.round((720 + 2 * MARGE) / pas))
  })
})

describe('couleurRgb — le fond du theme', () => {
  it('lit les ecritures que rend getComputedStyle', () => {
    expect(couleurRgb(' #0b0c10')).toEqual([11, 12, 16])
    expect(couleurRgb('#fff')).toEqual([255, 255, 255])
    expect(couleurRgb('rgb(228, 230, 238)')).toEqual([228, 230, 238])
    expect(couleurRgb('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3])
    expect(couleurRgb('')).toEqual([0, 0, 0])
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
