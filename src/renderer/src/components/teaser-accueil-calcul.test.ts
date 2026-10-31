import { describe, expect, it } from 'vitest'
import { CERCLE_DANS_L_IMAGE, etatDeLaPhrase, placeDeLaPhrase } from './teaser-accueil-calcul'

const hautDeLaPhrase = (l: number, h: number): number => placeDeLaPhrase(l, h).haut

/** La phrase commence sous le cercle de runes : 6 % de l'image sous son centre. */
const SOUS_LE_CERCLE = CERCLE_DANS_L_IMAGE + 0.06

describe('placeDeLaPhrase', () => {
  it('fil au format de la vidéo : la phrase commence sous le cercle de runes', () => {
    expect(hautDeLaPhrase(1280, 720)).toBeCloseTo(720 * SOUS_LE_CERCLE)
  })

  it('fil plus large : la vidéo est coupée en haut surtout, la phrase suit le cercle', () => {
    // 2000 × 1125 d'image dans 900 de haut : 225 px de coupe, dont 85 % par le haut.
    expect(hautDeLaPhrase(2000, 900)).toBeCloseTo(1125 * SOUS_LE_CERCLE - 191.25)
  })

  it('fil plus étroit : la vidéo est coupée sur les côtés, seule sa hauteur compte', () => {
    expect(hautDeLaPhrase(700, 720)).toBeCloseTo(hautDeLaPhrase(1280, 720))
  })

  it('fenêtre basse : la phrase garde la place de ses deux lignes', () => {
    expect(hautDeLaPhrase(900, 300)).toBeLessThanOrEqual(300 - 76)
  })

  it('l’écart mène du haut de la phrase au centre du cercle', () => {
    expect(placeDeLaPhrase(1280, 720).ecart).toBeCloseTo(720 * 0.06)
    // Fenêtre basse : la phrase remonte, le chemin des lettres raccourcit.
    expect(placeDeLaPhrase(900, 300).ecart).toBeLessThan(900 * (720 / 1280) * 0.06)
  })
})

describe('etatDeLaPhrase', () => {
  it('la phrase sort juste après le coup de bâton, sur le plan large', () => {
    expect(etatDeLaPhrase(0.9)).toBe('absente')
    expect(etatDeLaPhrase(1.2)).toBe('presente')
    expect(etatDeLaPhrase(6.4)).toBe('presente')
  })

  it('elle se disperse avant la coupe vers les plans serrés', () => {
    expect(etatDeLaPhrase(6.6)).toBe('sortante')
    expect(etatDeLaPhrase(7)).toBe('absente')
    expect(etatDeLaPhrase(9.9)).toBe('absente')
  })

  it('chaque temps du film recommence, jusqu’au bout de la boucle', () => {
    expect(etatDeLaPhrase(13)).toBe('presente')
    expect(etatDeLaPhrase(38)).toBe('absente')
    expect(etatDeLaPhrase(39.99)).toBe('absente')
  })
})
