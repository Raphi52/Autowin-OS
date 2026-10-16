import { describe, expect, it } from 'vitest'
import { largeursDeLaBarre } from './tests-barre'

/**
 * Cas limites du cadrage (conv-981) : total nul, seulement des ignores, tout reussi, tout en echec,
 * et des totaux abimes dans le stockage local (negatifs, non numeriques, reussis + echecs > total).
 * ENTREE QUI DOIT FAIRE ECHOUER : diviser par `total` sans garde (NaN / Infinity en largeur), ou
 * laisser deux segments depasser 100 % a eux deux.
 */
describe('largeursDeLaBarre', () => {
  it('total nul : barre vide, jamais NaN ni Infinity', () => {
    expect(largeursDeLaBarre({ passed: 0, failed: 0, total: 0 })).toEqual({ reussis: 0, echecs: 0 })
    expect(largeursDeLaBarre(undefined)).toEqual({ reussis: 0, echecs: 0 })
  })

  it('seulement des ignores : les deux segments a 0 %', () => {
    expect(largeursDeLaBarre({ passed: 0, failed: 0, total: 12 })).toEqual({
      reussis: 0,
      echecs: 0
    })
  })

  it('tout reussi / tout en echec : un segment a 100 %, l autre a 0 %', () => {
    expect(largeursDeLaBarre({ passed: 40, failed: 0, total: 40 })).toEqual({
      reussis: 100,
      echecs: 0
    })
    expect(largeursDeLaBarre({ passed: 0, failed: 3, total: 3 })).toEqual({
      reussis: 0,
      echecs: 100
    })
  })

  it('nominal : chaque part au prorata du total, ignores compris dans le rail', () => {
    expect(largeursDeLaBarre({ passed: 6, failed: 2, total: 10 })).toEqual({
      reussis: 60,
      echecs: 20
    })
  })

  it('totaux abimes : negatifs et non numeriques comptent zero', () => {
    expect(largeursDeLaBarre({ passed: -5, failed: 'x', total: 10 })).toEqual({
      reussis: 0,
      echecs: 0
    })
    expect(largeursDeLaBarre({ passed: Number.NaN, failed: 2, total: Infinity })).toEqual({
      reussis: 0,
      echecs: 100
    })
  })

  it('reussis + echecs au-dela du total : la somme reste <= 100 %', () => {
    const l = largeursDeLaBarre({ passed: 9, failed: 3, total: 10 })
    expect(l.reussis + l.echecs).toBeLessThanOrEqual(100)
    expect(l).toEqual({ reussis: 75, echecs: 25 })
  })

  it('une fraction periodique ne pousse jamais la somme au-dela de 100 %', () => {
    const l = largeursDeLaBarre({ passed: 2, failed: 1, total: 3 })
    expect(l.reussis + l.echecs).toBeLessThanOrEqual(100)
    expect(l.reussis).toBeCloseTo(66.66, 2)
  })
})
