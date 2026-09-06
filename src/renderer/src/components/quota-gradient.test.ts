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
    expect(quotaGradientColor(0)).toBe('rgb(184, 32, 26)')
    expect(quotaGradientColor(12)).toBe('rgb(184, 32, 26)')
    expect(quotaGradientColor(68)).toBe('rgb(239, 192, 35)')
    expect(quotaGradientColor(100)).toBe('rgb(53, 208, 127)')
  })

  it('interpole entre deux arrets au lieu de sauter au palier', () => {
    const teinte = quotaGradientColor(74)
    expect(teinte).not.toBe('rgb(53, 208, 127)')
    expect(teinte).not.toBe('rgb(239, 192, 35)')
    const [r, v, b] = teinte.match(/\d+/g)!.map(Number)
    expect(r).toBeLessThan(239)
    expect(r).toBeGreaterThan(53)
    expect(v).toBeGreaterThan(192)
    expect(b).toBeGreaterThan(35)
  })

  it('borne les valeurs hors echelle', () => {
    expect(quotaGradientColor(-10)).toBe(quotaGradientColor(0))
    expect(quotaGradientColor(150)).toBe(quotaGradientColor(100))
  })
})
