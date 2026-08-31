import { describe, expect, it } from 'vitest'
import { surveillerGelsRenderer } from './gel-renderer'

/**
 * Ce que ces tests defendent : un freeze du RENDERER doit laisser une trace ecrite, et seulement
 * quand il merite le nom de gel. Sans cela, un freeze de la fenetre reste non attribuable apres
 * coup — le trou constate le 2026-08-31 sur le gel de 30 211 ms.
 */
describe('sonde de gels du renderer', () => {
  function fabriqueControlee(): {
    fabrique: (r: (d: number[]) => void) => { disconnect: () => void }
    emettre: (durees: number[]) => void
    deconnexions: () => number
  } {
    let rappel: (d: number[]) => void = () => {}
    let deconnexions = 0
    return {
      fabrique: (r) => {
        rappel = r
        return { disconnect: () => void (deconnexions += 1) }
      },
      emettre: (durees) => rappel(durees),
      deconnexions: () => deconnexions
    }
  }

  it('signale une tache longue qui atteint le seuil, arrondie a la milliseconde', () => {
    const vus: number[] = []
    const c = fabriqueControlee()
    surveillerGelsRenderer((ms) => vus.push(ms), 1000, c.fabrique)
    c.emettre([1234.6])
    expect(vus).toEqual([1235])
  })

  it('ignore ce qui reste SOUS le seuil — une saccade n’est pas un gel', () => {
    const vus: number[] = []
    const c = fabriqueControlee()
    surveillerGelsRenderer((ms) => vus.push(ms), 1000, c.fabrique)
    c.emettre([120, 999])
    expect(vus).toEqual([])
  })

  it('survit a un canal qui jette — un instrument muet ne casse pas l’interface', () => {
    const c = fabriqueControlee()
    surveillerGelsRenderer(
      () => {
        throw new Error('canal indisponible')
      },
      1000,
      c.fabrique
    )
    expect(() => c.emettre([5000])).not.toThrow()
  })

  it('reste inerte, sans jeter, quand le moteur n’offre aucun observateur', () => {
    const arreter = surveillerGelsRenderer(
      () => {
        throw new Error('ne doit pas etre appele')
      },
      1000,
      () => undefined
    )
    expect(() => arreter()).not.toThrow()
  })

  it('deconnecte l’observateur a l’arret', () => {
    const c = fabriqueControlee()
    const arreter = surveillerGelsRenderer(() => {}, 1000, c.fabrique)
    arreter()
    expect(c.deconnexions()).toBe(1)
  })
})
