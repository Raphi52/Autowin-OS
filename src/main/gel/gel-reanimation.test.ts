import { describe, expect, it } from 'vitest'
import { doitReanimer, REGLAGES_REANIMATION_PAR_DEFAUT } from './gel-reanimation'

describe('reanimation de la fenetre gelee', () => {
  it('laisse passer une lenteur sous le seuil', () => {
    expect(doitReanimer({ gelDepuisMs: 5_000, maintenant: 1_000_000 })).toEqual({
      reanimer: false,
      motif: 'sous-le-seuil'
    })
  })

  it('recharge un gel qui depasse le seuil', () => {
    expect(doitReanimer({ gelDepuisMs: 25_000, maintenant: 1_000_000 })).toEqual({ reanimer: true })
  })

  it('refuse de recharger deux fois coup sur coup', () => {
    expect(
      doitReanimer({ gelDepuisMs: 60_000, derniereReanimation: 990_000, maintenant: 1_000_000 })
    ).toEqual({ reanimer: false, motif: 'trop-recent' })
  })

  it('recharge de nouveau une fois le delai passe', () => {
    expect(
      doitReanimer({ gelDepuisMs: 60_000, derniereReanimation: 800_000, maintenant: 1_000_000 })
    ).toEqual({ reanimer: true })
  })

  it('garde des reglages explicites plutot que des nombres en dur', () => {
    expect(REGLAGES_REANIMATION_PAR_DEFAUT.seuilMs).toBeGreaterThan(0)
    expect(REGLAGES_REANIMATION_PAR_DEFAUT.delaiEntreDeuxMs).toBeGreaterThan(
      REGLAGES_REANIMATION_PAR_DEFAUT.seuilMs
    )
  })
})
