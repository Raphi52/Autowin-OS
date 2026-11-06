import { describe, expect, it } from 'vitest'
import type { LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'
import { enchainementDuLot, rangsLisibles } from './enchainement-des-lots'

const H = (h: number, m: number): number => Date.UTC(2026, 9, 30, h, m)

function lot(rang: number, debut?: number, fin?: number, apres?: number[]): LotDuPlan {
  return {
    rang,
    titre: `Lot ${rang}`,
    demande: '',
    fichiers: [],
    etat: fin ? 'fait' : debut ? 'en-cours' : 'a-faire',
    ...(apres ? { apres } : {}),
    ...(debut ? { debut } : {}),
    ...(fin ? { fin } : {})
  }
}

// Les heures du vrai plan : 1 seul, puis 2 à 6 après lui, le 5
// parti à la fin du 4, le 7 après tous, puis des lots ajoutés sans dépendance.
const plan = {
  lots: [
    lot(1, H(20, 11), H(21, 11)),
    lot(2, H(21, 11), H(22, 22), [1]),
    lot(4, H(21, 11), H(21, 56), [1]),
    lot(5, H(21, 56), H(22, 33)),
    lot(7, H(22, 42), H(23, 31), [6, 2, 3, 4, 5]),
    lot(8, H(23, 40), H(23, 59)),
    lot(14, H(7, 49), H(8, 42)),
    lot(15, H(7, 49), H(8, 41)),
    lot(17, H(8, 42)),
    lot(20)
  ]
} as unknown as PlanDeLots
const de = (rang: number): ReturnType<typeof enchainementDuLot> =>
  enchainementDuLot(
    plan,
    plan.lots.find((l) => l.rang === rang)!
  )

describe('enchainementDuLot', () => {
  it('la dépendance déclarée passe devant, triée', () => {
    expect(de(2)).toEqual({ genre: 'apres', rangs: [1] })
    expect(de(7)).toEqual({ genre: 'apres', rangs: [2, 3, 4, 5, 6] })
  })
  it('sans dépendance, un lot parti à la fin d’un autre dit lequel', () => {
    expect(de(5)).toEqual({ genre: 'relais', rang: 4 })
  })
  it('deux fins avant le départ : la plus proche gagne', () => {
    expect(de(17)).toEqual({ genre: 'relais', rang: 14 })
  })
  it('parti sans fin d’un autre juste avant : libre ; pas parti : en file', () => {
    expect(de(1)).toEqual({ genre: 'libre' })
    expect(de(8)).toEqual({ genre: 'libre' })
    expect(de(20)).toEqual({ genre: 'file' })
  })
})

describe('rangsLisibles', () => {
  it('resserre les suites de trois rangs et plus', () => {
    expect(rangsLisibles([6, 2, 3, 4, 5])).toBe('2–6')
    expect(rangsLisibles([1])).toBe('1')
    expect(rangsLisibles([2, 3])).toBe('2, 3')
    expect(rangsLisibles([1, 3, 4, 5, 9])).toBe('1, 3–5, 9')
  })
})
