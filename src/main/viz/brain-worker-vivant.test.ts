import { describe, expect, it } from 'vitest'
import { SILENCE_WORKER_AVANT_ABANDON_MS, workerAbandonne } from './brain-worker-vivant'

describe('un worker qui donne signe de vie n est pas abandonne', () => {
  it('attend un traitement LONG tant que le worker parle', () => {
    // 120 s de traitement, mais un signe de vie il y a 2 s : on attend.
    expect(workerAbandonne({ dernierSigneDeVie: 118_000, maintenant: 120_000 })).toBe(false)
  })

  it('abandonne un worker devenu muet', () => {
    expect(workerAbandonne({ dernierSigneDeVie: 10_000, maintenant: 45_000 })).toBe(true)
  })

  it('tolere exactement le silence configure', () => {
    expect(workerAbandonne({ dernierSigneDeVie: 0, maintenant: 29_999 }, 30_000)).toBe(false)
    expect(workerAbandonne({ dernierSigneDeVie: 0, maintenant: 30_000 }, 30_000)).toBe(true)
  })

  it('garde un seuil explicite plutot qu un nombre en dur', () => {
    expect(SILENCE_WORKER_AVANT_ABANDON_MS).toBeGreaterThan(0)
  })
})
