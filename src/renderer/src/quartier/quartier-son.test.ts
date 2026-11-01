import { describe, expect, it } from 'vitest'
import { DUREE_GONG_S, PARTIELS_GONG } from './quartier-son'

describe('le son du gong', () => {
  it('fait monter les aigus après le coup : c’est ce qui sépare un gong d’une cloche', () => {
    for (let i = 1; i < PARTIELS_GONG.length; i++) {
      expect(PARTIELS_GONG[i].f).toBeGreaterThan(PARTIELS_GONG[i - 1].f)
      expect(PARTIELS_GONG[i].montee).toBeGreaterThan(PARTIELS_GONG[i - 1].montee)
    }
  })

  it('n’a aucun partiel qui tombe juste sur un multiple du grave', () => {
    const grave = PARTIELS_GONG[0].f
    for (const p of PARTIELS_GONG.slice(1)) {
      const rapport = p.f / grave
      expect(Math.abs(rapport - Math.round(rapport))).toBeGreaterThan(0.005)
    }
  })

  it('finit par s’éteindre avant qu’on referme le son', () => {
    for (const p of PARTIELS_GONG) {
      expect(p.montee).toBeLessThan(p.d)
      expect(p.d).toBeLessThan(DUREE_GONG_S)
    }
  })
})
