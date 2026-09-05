import { describe, expect, it } from 'vitest'
import { occupationDeFenetre } from './occupation-fenetre'

describe('occupationDeFenetre', () => {
  it("prend l'entree du DERNIER appel, pas le cumul du tour", () => {
    // Le cas reel : un tour de ~14 appels cumule 2,18 M pour une occupation de 118 k.
    const o = occupationDeFenetre({
      inputTokens: 2_181_502,
      cacheReadTokens: 2_100_000,
      derniereEntree: 118_402,
      derniereEntreeCache: 110_000
    })
    expect(o.entree).toBe(118_402)
    expect(o.cache).toBe(110_000)
    expect(o.replicumul).toBe(false)
  })

  it('replie sur le cumul quand le provider ne desagrege pas, et le SIGNALE', () => {
    // Un majorant reste plus utile qu'une jauge absente — a condition de ne pas se faire passer
    // pour une occupation mesuree.
    const o = occupationDeFenetre({ inputTokens: 18_904_589, cacheReadTokens: 18_000_000 })
    expect(o.entree).toBe(18_904_589)
    expect(o.cache).toBe(18_000_000)
    expect(o.replicumul).toBe(true)
  })

  it('ne confond pas une derniere entree de zero avec une absence', () => {
    // `?? ` sur une valeur nulle rebasculerait sur le cumul : un tour sans entree fraiche
    // afficherait la somme de tout le fil.
    const o = occupationDeFenetre({ inputTokens: 999_999, derniereEntree: 0 })
    expect(o.entree).toBe(0)
    expect(o.replicumul).toBe(false)
  })
})
