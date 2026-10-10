import { describe, expect, it } from 'vitest'
import { quotaGradientColor } from './quota-gradient'

/**
 * La teinte doit suivre le MEME degrade que la barre, pas le palier.
 *
 * Entrees qui feraient echouer une implementation par paliers : 74 % doit rendre une couleur
 * INTERMEDIAIRE entre le jaune-or (68 %) et le vert (86 %) — un code par paliers y rendrait le vert
 * plein. Les bornes hors echelle (-10, 150) doivent etre ramenees aux extremites, sinon la pastille
 * prendrait une couleur inventee.
 */
describe('teinte du degrade des quotas', () => {
  it('rend les couleurs des arrets connus', () => {
    expect(quotaGradientColor(0)).toBe('var(--quota-rouge)')
    expect(quotaGradientColor(12)).toBe('var(--quota-rouge)')
    expect(quotaGradientColor(68)).toBe('var(--quota-jaune)')
    expect(quotaGradientColor(100)).toBe('var(--quota-vert)')
  })

  it('interpole entre deux arrets au lieu de sauter au palier', () => {
    // 74 % = un tiers du chemin entre le jaune (68 %) et le vert (86 %).
    expect(quotaGradientColor(74)).toBe(
      'color-mix(in srgb, var(--quota-vert) 33.3%, var(--quota-jaune))'
    )
    // 21 % = la moitie entre le rouge (12 %) et l'orange (30 %).
    expect(quotaGradientColor(21)).toBe(
      'color-mix(in srgb, var(--quota-orange) 50%, var(--quota-rouge))'
    )
  })

  /**
   * DEFAUT DU 2026-10-10 (conv-197) : la pastille recopiait la palette de BASE (vert #35d07f) alors
   * que le theme Nebuleuse repeint la barre en #4fd1a5 — deux verts cote a cote. Aucune couleur
   * ecrite en dur ne doit sortir d'ici : seules les variables que le theme pose.
   */
  it('ne rend jamais une couleur en dur, seulement les variables du theme', () => {
    for (let p = 0; p <= 100; p += 1) {
      // `\brgba?\(` : une couleur rgb(...) ; le mot `srgb` de color-mix n'en est pas une.
      expect(quotaGradientColor(p)).not.toMatch(/#|\brgba?\(/)
    }
  })

  it('borne les valeurs hors echelle', () => {
    expect(quotaGradientColor(-10)).toBe(quotaGradientColor(0))
    expect(quotaGradientColor(150)).toBe(quotaGradientColor(100))
  })
})
