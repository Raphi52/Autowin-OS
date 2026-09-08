import { describe, expect, it } from 'vitest'
import { doitRedimensionner } from './decor-redimension'

describe('redimensionnement du decor de fond', () => {
  it('accepte le tout premier calage', () => {
    expect(doitRedimensionner(null, 1200, 800)).toBe(true)
  })

  it('REFUSE une notification qui ne change rien — c est ce qui coutait les gels', () => {
    expect(doitRedimensionner({ w: 1200, h: 800 }, 1200, 800)).toBe(false)
  })

  it('accepte des que la largeur ou la hauteur bouge', () => {
    expect(doitRedimensionner({ w: 1200, h: 800 }, 1201, 800)).toBe(true)
    expect(doitRedimensionner({ w: 1200, h: 800 }, 1200, 801)).toBe(true)
  })

  it('refuse une taille nulle : rien a dessiner, et le tampon resterait vide', () => {
    expect(doitRedimensionner({ w: 1200, h: 800 }, 0, 800)).toBe(false)
  })
})
