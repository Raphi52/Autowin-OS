import { describe, expect, it } from 'vitest'
import {
  ECHELLE_AJUSTEE_MAX,
  ECHELLE_MAX,
  ECHELLE_MIN,
  MARGE_AJUSTEE,
  copieDuSvg,
  facteurDeMolette,
  tailleDuSvg,
  vueAjustee,
  zoomerAutourDe
} from './zoom-diagramme'

describe('tailleDuSvg', () => {
  it('lit la largeur et la hauteur du viewBox que mermaid ecrit', () => {
    const svg =
      '<svg id="a" width="100%" viewBox="-8 -8 906.5 1412" style="max-width: 906px"></svg>'
    expect(tailleDuSvg(svg)).toEqual({ largeur: 906.5, hauteur: 1412 })
  })

  it('ne lit que la balise <svg> de tete, pas un viewBox imbrique', () => {
    expect(tailleDuSvg('<svg id="a"><svg viewBox="0 0 10 10"></svg></svg>')).toBeNull()
  })

  it('rend null sur un viewBox absent, incomplet ou vide', () => {
    expect(tailleDuSvg('<svg></svg>')).toBeNull()
    expect(tailleDuSvg('<svg viewBox="0 0 100"></svg>')).toBeNull()
    expect(tailleDuSvg('<svg viewBox="0 0 0 0"></svg>')).toBeNull()
    expect(tailleDuSvg('<svg viewBox="0 0 a b"></svg>')).toBeNull()
    expect(tailleDuSvg('pas un dessin')).toBeNull()
  })
})

describe('copieDuSvg', () => {
  it('change l identifiant partout ou mermaid s en sert : styles, pointes de fleche', () => {
    const id = 'artifact-diagram-r1-3'
    const svg =
      `<svg id="${id}" viewBox="0 0 10 10"><style>#${id} .node{fill:red}</style>` +
      `<marker id="${id}_pointe"></marker><path marker-end="url(#${id}_pointe)"></path></svg>`
    expect(copieDuSvg(svg, id)).toBe(
      `<svg id="${id}-agrandi" viewBox="0 0 10 10"><style>#${id}-agrandi .node{fill:red}</style>` +
        `<marker id="${id}-agrandi_pointe"></marker>` +
        `<path marker-end="url(#${id}-agrandi_pointe)"></path></svg>`
    )
  })
})

describe('vueAjustee', () => {
  it('fait tenir un schema tres haut dans le cadre, centre, marge comprise', () => {
    const vue = vueAjustee({ largeur: 900, hauteur: 1400 }, { largeur: 1400, hauteur: 800 })
    expect(vue.echelle).toBeCloseTo((800 - 2 * MARGE_AJUSTEE) / 1400, 5)
    expect(vue.y).toBeCloseTo(MARGE_AJUSTEE, 5)
    expect(vue.x).toBeCloseTo((1400 - 900 * vue.echelle) / 2, 5)
  })

  it('n agrandit pas un petit schema sans limite', () => {
    const vue = vueAjustee({ largeur: 100, hauteur: 50 }, { largeur: 1400, hauteur: 800 })
    expect(vue.echelle).toBe(ECHELLE_AJUSTEE_MAX)
  })

  it('reste bornee sur un cadre pas encore mesure', () => {
    const vue = vueAjustee({ largeur: 900, hauteur: 1400 }, { largeur: 0, hauteur: 0 })
    expect(vue.echelle).toBe(ECHELLE_MIN)
  })
})

describe('zoomerAutourDe', () => {
  it('garde sous le pointeur le point du dessin qui y etait', () => {
    const avant = { echelle: 0.5, x: 100, y: 40 }
    const pointeur = { x: 300, y: 200 }
    const dansLeDessin = {
      x: (pointeur.x - avant.x) / avant.echelle,
      y: (pointeur.y - avant.y) / avant.echelle
    }
    const apres = zoomerAutourDe(avant, 2, pointeur)
    expect(apres.echelle).toBe(1)
    expect(apres.x + dansLeDessin.x * apres.echelle).toBeCloseTo(pointeur.x, 5)
    expect(apres.y + dansLeDessin.y * apres.echelle).toBeCloseTo(pointeur.y, 5)
  })

  it('s arrete aux bornes et ne deplace plus rien une fois au bout', () => {
    const auMax = { echelle: ECHELLE_MAX, x: 12, y: 34 }
    expect(zoomerAutourDe(auMax, 2, { x: 500, y: 500 })).toEqual(auMax)
    const auMin = { echelle: ECHELLE_MIN, x: 56, y: 78 }
    expect(zoomerAutourDe(auMin, 0.5, { x: 500, y: 500 })).toEqual(auMin)
  })
})

describe('facteurDeMolette', () => {
  it('rapproche quand la molette monte, eloigne quand elle descend', () => {
    expect(facteurDeMolette(-100, false)).toBeGreaterThan(1)
    expect(facteurDeMolette(100, false)).toBeLessThan(1)
  })

  it('un aller-retour revient exactement a la meme echelle', () => {
    expect(facteurDeMolette(-100, false) * facteurDeMolette(100, false)).toBeCloseTo(1, 10)
  })

  it('le pincement du pave tactile, qui envoie de petits pas, reste aussi vif qu un cran', () => {
    expect(facteurDeMolette(-15, true)).toBeCloseTo(facteurDeMolette(-100, false), 1)
  })

  it('Ctrl + un cran de molette zoome comme un cran, pas de 2,7 fois', () => {
    expect(facteurDeMolette(-100, true)).toBeLessThan(1.3)
    expect(facteurDeMolette(100, true)).toBeGreaterThan(0.75)
  })
})
