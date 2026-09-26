import { describe, expect, it } from 'vitest'
import { computeObservatoryTotals, formatObservatoryDuration } from './observatory-totals'

describe('computeObservatoryTotals', () => {
  it('somme tokens, coût, durée et compte les appels en échec', () => {
    const totals = computeObservatoryTotals([
      {
        usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 100, costUsd: 0.5 },
        durationMs: 1200
      },
      { usage: { inputTokens: 5, outputTokens: 7 }, durationMs: 800, status: 'failed' },
      { status: 'completed' }
    ])
    expect(totals).toEqual({
      calls: 3,
      input: 15,
      output: 10,
      cache: 100,
      cost: 0.5,
      durationMs: 2000,
      errors: 1
    })
  })

  it('rend des totaux nuls sans appel', () => {
    expect(computeObservatoryTotals([]).durationMs).toBe(0)
  })

  it('formate la durée sans jamais inventer un zéro', () => {
    expect(formatObservatoryDuration(0)).toBe('')
    expect(formatObservatoryDuration(450)).toBe('450 ms')
    expect(formatObservatoryDuration(1234)).toBe('1,2 s')
    expect(formatObservatoryDuration(184000)).toBe('3 min 04 s')
  })
})
