import { describe, expect, it, vi } from 'vitest'
import { isTransientOverload, retryOnTransientOverload } from './transient-overload'

describe('isTransientOverload — classement sur les chaînes RÉELLES des adaptateurs', () => {
  it('reconnaît le 529 tel que rendu par le CLI claude (incident ak-9d3fa074346ba9da)', () => {
    expect(
      isTransientOverload(
        'claude result error: API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.'
      )
    ).toBe(true)
    expect(
      isTransientOverload('API Claude surchargée (529) — abandon après 10/10 tentatives')
    ).toBe(true)
    expect(isTransientOverload('503 Service Unavailable')).toBe(true)
  })

  it('ne réessaie PAS ce qui ne se répare pas en rejouant', () => {
    expect(isTransientOverload('codex non authentifié — lance npm run codex:login')).toBe(false)
    expect(isTransientOverload('spawn claude ENOENT')).toBe(false)
    expect(isTransientOverload('429 rate limit exceeded')).toBe(false)
    expect(isTransientOverload('claude CLI figé (aucune sortie) — tué par le watchdog')).toBe(false)
  })
})

describe('retryOnTransientOverload', () => {
  it('rejoue une surcharge transitoire puis rend le succès', async () => {
    const sleep = vi.fn(async () => undefined)
    const retries: number[] = []
    let calls = 0
    const value = await retryOnTransientOverload(
      async () => {
        calls += 1
        if (calls === 1) throw new Error('API Error: 529 Overloaded')
        return 'ok'
      },
      { sleep, baseDelayMs: 10, onRetry: (i) => retries.push(i.attempt) }
    )
    expect(value).toBe('ok')
    expect(calls).toBe(2)
    expect(retries).toEqual([2])
    expect(sleep).toHaveBeenCalledWith(10)
  })

  it('relance IMMÉDIATEMENT une erreur non transitoire (aucun réessai)', async () => {
    let calls = 0
    await expect(
      retryOnTransientOverload(
        async () => {
          calls += 1
          throw new Error('codex non authentifié')
        },
        { sleep: async () => undefined, attempts: 3 }
      )
    ).rejects.toThrow(/non authentifié/)
    expect(calls).toBe(1)
  })

  it('à épuisement, remonte la dernière erreur telle quelle', async () => {
    let calls = 0
    await expect(
      retryOnTransientOverload(
        async () => {
          calls += 1
          throw new Error('529 Overloaded')
        },
        { sleep: async () => undefined, attempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow(/529/)
    expect(calls).toBe(3)
  })
})
