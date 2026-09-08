import { describe, expect, it } from 'vitest'
import { tailleSuivante } from './graph-taille-observee'

describe('taille observee de la zone 3D', () => {
  it('rend la MEME reference quand la taille est inchangee', () => {
    const courante = { w: 640, h: 480 }
    expect(tailleSuivante(courante, 640, 480)).toBe(courante)
  })

  it('rend une nouvelle taille des quun cote change', () => {
    const courante = { w: 640, h: 480 }
    expect(tailleSuivante(courante, 641, 480)).toEqual({ w: 641, h: 480 })
    expect(tailleSuivante(courante, 640, 481)).toEqual({ w: 640, h: 481 })
  })
})
