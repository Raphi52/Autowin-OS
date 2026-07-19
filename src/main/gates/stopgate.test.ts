import { describe, it, expect } from 'vitest'
import { evaluateClosure, assertClosable, type ClosureState } from './stopgate'

describe('evaluateClosure', () => {
  it('bloque le statut "open"', () => {
    const state: ClosureState = { status: 'open', dod: [] }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(true)
    expect(result.reasons.some((r) => r.includes('open'))).toBe(true)
  })

  it('bloque le statut "red"', () => {
    const state: ClosureState = { status: 'red', dod: [] }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(true)
    expect(result.reasons.some((r) => r.includes('red'))).toBe(true)
  })

  it('bloque une DoD à contenu non cochée', () => {
    const state: ClosureState = {
      status: 'green',
      dod: [{ checked: false, hasContent: true }]
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(true)
    expect(result.reasons.some((r) => r.includes('DoD'))).toBe(true)
  })

  it('ne bloque pas une DoD non cochée SANS contenu', () => {
    const state: ClosureState = {
      status: 'green',
      dod: [{ checked: false, hasContent: false }]
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('bloque un signal exitCode != 0', () => {
    const state: ClosureState = {
      status: 'green',
      dod: [{ checked: true, hasContent: true }],
      signalExitCode: 1
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(true)
    expect(result.reasons.some((r) => r.includes('Signal rouge'))).toBe(true)
  })

  it('ne bloque jamais "degraded-closed", même avec DoD rouge et signal rouge', () => {
    const state: ClosureState = {
      status: 'degraded-closed',
      dod: [{ checked: false, hasContent: true }],
      signalExitCode: 1
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('ne bloque pas un "green" propre (DoD complète, signal 0)', () => {
    const state: ClosureState = {
      status: 'green',
      dod: [
        { checked: true, hasContent: true },
        { checked: false, hasContent: false }
      ],
      signalExitCode: 0
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('ne bloque pas un "green" sans signalExitCode défini', () => {
    const state: ClosureState = {
      status: 'green',
      dod: [{ checked: true, hasContent: true }]
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(false)
  })

  it('cumule TOUTES les raisons de blocage (open + DoD + signal)', () => {
    const state: ClosureState = {
      status: 'open',
      dod: [{ checked: false, hasContent: true }],
      signalExitCode: 2
    }
    const result = evaluateClosure(state)
    expect(result.blocked).toBe(true)
    expect(result.reasons.length).toBe(3)
  })

  it('assertClosable jette une Error détaillée si bloqué', () => {
    const state: ClosureState = { status: 'red', dod: [] }
    expect(() => assertClosable(state)).toThrowError(/Clôture bloquée/)
  })

  it('assertClosable ne jette rien si non bloqué', () => {
    const state: ClosureState = { status: 'degraded-closed', dod: [] }
    expect(() => assertClosable(state)).not.toThrow()
  })
})
