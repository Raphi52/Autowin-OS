import { describe, expect, it } from 'vitest'
import { compacter } from './titre-sans-homonyme'

/*
 * Une seule version de « blancs repliés en un espace, bords retirés » pour les titres de fil : elle
 * vivait en trois copies (titre automatique, titre sans homonyme, titre demandé par l'agent).
 */
describe('compacter', () => {
  it('replie tout blanc, retours à la ligne compris, et retire les bords', () => {
    expect(compacter('  Corrige\n\tle   bouton  ')).toBe('Corrige le bouton')
    expect(compacter('')).toBe('')
    expect(compacter(' \n ')).toBe('')
  })
})
