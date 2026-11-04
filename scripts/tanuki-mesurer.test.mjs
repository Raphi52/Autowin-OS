// Tests de la mesure des tanukis (conv-1562, lot 1 du plan conv-1558).
// On fabrique une silhouette connue au pixel près, et on vérifie que le script la relit.
// Entrée qui ferait échouer ce test si la mesure était fausse : la silhouette synthétique dont le
// cou est à la rangée 40 (tête 40 % de la hauteur) et les oreilles hautes de 10 rangées.
import { describe, expect, it } from 'vitest'
import { hex, mesurerCase, mesurerQueue, paletteKMoyennes } from './tanuki-mesurer.mjs'

const W = 60
const H = 100

/** Une image RGBA vide, puis un pinceau qui peint un rectangle opaque. */
function image(w = W, h = H) {
  return { w, h, d: new Uint8ClampedArray(w * h * 4) }
}
function peindre(im, x0, y0, x1, y1, [r, g, b]) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * im.w + x) * 4
      im.d.set([r, g, b, 255], i)
    }
}

/** Tanuki de face : oreilles 0..10 (la droite part plus bas), tête 10..40 (40 large), cou étroit, corps 42..100 (50 large). */
function tanukiSynthetique() {
  const im = image()
  peindre(im, 12, 0, 20, 10, [120, 120, 120]) // oreille gauche
  peindre(im, 40, 2, 48, 10, [120, 120, 120]) // oreille droite, 2 rangées plus bas (comme sur l'atlas)
  peindre(im, 2, 30, 3, 31, [128, 128, 128]) // poil isolé d'un pixel : ne doit compter ni comme oreille ni dans la tête
  peindre(im, 10, 10, 50, 40, [128, 128, 128]) // tête grise
  peindre(im, 16, 18, 44, 38, [235, 225, 200]) // face crème (le masque clair du tanuki)
  peindre(im, 18, 20, 26, 26, [20, 20, 20]) // masque : œil gauche
  peindre(im, 34, 20, 42, 26, [20, 20, 20]) // masque : œil droit
  peindre(im, 24, 40, 36, 42, [128, 128, 128]) // cou (12 large)
  peindre(im, 5, 42, 55, 100, [230, 100, 30]) // corps orange
  return im
}

describe('mesurerCase', () => {
  it('retrouve le cou, la tête, les oreilles et le masque d’une silhouette connue', () => {
    const m = mesurerCase(tanukiSynthetique(), 0, 0, W, H)
    expect(m.haut).toBe(0)
    expect(m.bas).toBe(99)
    expect(m.cou).toBeGreaterThanOrEqual(40)
    expect(m.cou).toBeLessThanOrEqual(41)
    expect(m.teteSurHauteur).toBeCloseTo(0.4, 1)
    expect(m.largeurTeteSurCorps).toBeCloseTo(40 / 50, 2)
    expect(m.oreilles.nombre).toBe(2)
    expect(m.oreilles.hauteurSurTete).toBeCloseTo(10 / 40, 2)
    expect(m.oreilles.ecartSurTete).toBeCloseTo(20 / 40, 2)
    const pixelsTete = 8 * 10 + 8 * 8 + 40 * 30
    expect(m.masque.sombre.partDeLaTete).toBeCloseTo((2 * 48) / pixelsTete, 2)
    expect(m.masque.clair.partDeLaTete).toBeCloseTo((28 * 20 - 2 * 48) / pixelsTete, 2)
    expect(m.masque.clair.couleur).toBe('#ebe1c8')
  })

  it('refuse une case vide au lieu de rendre des mesures inventées', () => {
    expect(() => mesurerCase(image(), 0, 0, W, H)).toThrow(/vide/)
  })
})

describe('mesurerQueue', () => {
  it('compte les anneaux d’une queue rayée qui dépasse du corps', () => {
    const im = image(100, 60)
    peindre(im, 60, 0, 90, 60, [230, 100, 30]) // corps (pleine hauteur)
    // queue horizontale de x=0 à 60, 4 anneaux sombres et 4 clairs de 7,5 px
    for (let k = 0; k < 8; k++)
      peindre(
        im,
        Math.round(k * 7.5),
        30,
        Math.round((k + 1) * 7.5),
        40,
        k % 2 ? [235, 235, 235] : [25, 25, 25]
      )
    const q = mesurerQueue(im, 0, 0, 100, 60)
    expect(q.anneauxSombres).toBe(4)
    expect(q.longueurSurHauteur).toBeCloseTo(60 / 60, 1)
  })
})

describe('paletteKMoyennes', () => {
  it('sépare deux couleurs franches avec leur part', () => {
    const px = []
    for (let i = 0; i < 300; i++) px.push([230, 100, 30])
    for (let i = 0; i < 100; i++) px.push([20, 20, 20])
    const p = paletteKMoyennes(px, 2)
    expect(p.map((c) => c.hex)).toEqual(['#e6641e', '#141414'])
    expect(p[0].part).toBeCloseTo(0.75, 2)
  })
  it('écrit un hexadécimal sur deux chiffres', () => {
    expect(hex([0, 15, 255])).toBe('#000fff')
  })
})
