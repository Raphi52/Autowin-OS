import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NUAGE_FRAGMENT_SHADER, SILHOUETTE_NUAGE } from './home-decor-scene'

/**
 * Demande conv-1455 : « on voit que le container du nuage est un cercle, c'est moche, faut qu'il soit
 * plus chaotique et plus coloré ». Falsifieurs : un masque circulaire (smoothstep sur la seule
 * distance) et une saturation neutre.
 */
describe('silhouette du nuage cosmique', () => {
  it('déforme le rayon du masque par un champ fractal au lieu d’un cercle', () => {
    expect(SILHOUETTE_NUAGE.chaos).toBeGreaterThan(0.2)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/lobes = fbm\(pBord\)/)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/rayon = 0\.42 \+ lobes \* uChaos/)
    expect(NUAGE_FRAGMENT_SHADER).not.toMatch(/smoothstep\(0\.10, 0\.5, length\(c\)\)/)
  })

  it('resature les teintes pour éviter le camaïeu grisé', () => {
    expect(SILHOUETTE_NUAGE.saturation).toBeGreaterThan(1)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/mix\(vec3\(lum\), couleur, uSaturation\)/)
  })

  it('câble les réglages en uniforms plutôt qu’en dur', () => {
    const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf-8')
    for (const u of ['uChaos', 'uFreqBord', 'uFondu', 'uSaturation']) {
      expect(NUAGE_FRAGMENT_SHADER).toContain(`uniform float ${u};`)
      expect(source).toContain(`${u}: { value:`)
    }
  })
})
