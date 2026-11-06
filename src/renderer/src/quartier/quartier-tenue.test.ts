/**
 * La tenue à la couleur choisie (conv-1633) : le masque ne prend que la tenue, jamais le pelage. Les pixels
 * ci-dessous sont des MÉDIANES relevées sur les atlas (4 premières rangées de chaque planche, pixels
 * opaques, conv-1633) : ce qui doit changer de couleur, et ce qui ne doit surtout pas. Vue d'ensemble :
 * `node scripts/quartier-planche.mjs --rangees 0,2`.
 */
import { describe, expect, it } from 'vitest'
import {
  ANIMAUX_AGENTS,
  TENUES_AGENTS,
  tenueLisible,
  type AnimalAgent
} from '../../../shared/quartier-presence'
import {
  creerCasesDeTenue,
  FENETRES_DE_TENUE,
  masqueDeTenue,
  TEINTE_DES_TENUES
} from './quartier-tenue'

/** Le masque d'un seul pixel opaque (ou de l'opacité donnée), de 0 à 255. */
function masque(animal: AnimalAgent, hex: string, alpha = 255): number {
  const v = Number.parseInt(hex.slice(1), 16)
  const px = new Uint8ClampedArray([(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha])
  return masqueDeTenue(px, FENETRES_DE_TENUE[animal])[0]
}

describe('tenueLisible', () => {
  it.each([...TENUES_AGENTS])('lit %s', (t) => expect(tenueLisible(t)).toBe(t))

  it('refuse une couleur inconnue, une couleur CSS ou une valeur qui n’est pas du texte', () => {
    for (const v of ['noir', 'Rouge', '#ff0000', 'red', '', null, undefined, 3, {}])
      expect(tenueLisible(v)).toBeNull()
  })

  it('chaque couleur proposée a sa teinte, et chaque animal sa fenêtre de tenue', () => {
    expect(Object.keys(TEINTE_DES_TENUES).sort()).toEqual([...TENUES_AGENTS].sort())
    for (const hex of Object.values(TEINTE_DES_TENUES)) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(Object.keys(FENETRES_DE_TENUE).sort()).toEqual([...ANIMAUX_AGENTS].sort())
  })
})

describe('le masque de la tenue prend la tenue, jamais le pelage', () => {
  it.each([
    // [animal, tenue peinte (claire, sombre), pelage à laisser tel quel]
    ['tanuki', '#d0642c', '#aba293'], // kimono orange ; pelage gris clair
    ['tanuki', '#854026', '#2f2c28'], // pantalon brun-rouge ; pelage sombre
    ['renard', '#359b8f', '#985534'], // veste turquoise ; pelage roux
    ['renard', '#2b6f68', '#9e9c91'], // pli de la veste ; plastron clair
    ['panda', '#6b9639', '#a5a39b'], // gilet vert ; pelage blanc
    ['panda', '#48652a', '#2c2b29'], // pli du gilet ; pelage noir
    ['panda-roux', '#3b4b77', '#8a482c'], // veste bleue ; pelage roux
    ['panda-roux', '#2f3a59', '#312e2e'] // pli de la veste ; pattes brun-noir
  ] as const)('%s : %s change, %s reste', (animal, tenue, pelage) => {
    expect(masque(animal, tenue)).toBeGreaterThan(200)
    expect(masque(animal, pelage)).toBe(0)
  })

  it('les bruns du tanuki hors tenue (oreilles ternes, sourcils sombres) restent peints', () => {
    expect(masque('tanuki', '#685a4b')).toBe(0)
    expect(masque('tanuki', '#251c15')).toBe(0)
  })

  it('un pixel transparent n’est jamais teint ; un bord à demi opaque l’est à moitié', () => {
    expect(masque('renard', '#359b8f', 0)).toBe(0)
    const plein = masque('renard', '#359b8f')
    const bord = masque('renard', '#359b8f', 128)
    expect(bord).toBeGreaterThan(plein * 0.4)
    expect(bord).toBeLessThan(plein * 0.6)
  })
})

describe('les cases teintes gardées en mémoire', () => {
  it('fabrique une case une seule fois, puis la relit', () => {
    const cases = creerCasesDeTenue(4)
    let fabriquees = 0
    const fabriquer = (): HTMLCanvasElement => {
      fabriquees++
      return {} as HTMLCanvasElement
    }
    const a = cases.lire('tanuki|bleu|0|0', fabriquer)
    expect(cases.lire('tanuki|bleu|0|0', fabriquer)).toBe(a)
    expect(fabriquees).toBe(1)
  })

  it('n’en garde jamais plus que sa limite, et oublie d’abord la moins récemment lue', () => {
    const cases = creerCasesDeTenue(2)
    const fabriquer = (): HTMLCanvasElement => ({}) as HTMLCanvasElement
    const a = cases.lire('a', fabriquer)
    cases.lire('b', fabriquer)
    cases.lire('a', fabriquer) // relue : « b » devient la plus ancienne
    cases.lire('c', fabriquer)
    expect(cases.taille()).toBe(2)
    expect(cases.lire('a', fabriquer)).toBe(a)
    let refaite = false
    cases.lire('b', () => {
      refaite = true
      return {} as HTMLCanvasElement
    })
    expect(refaite).toBe(true)
  })
})
