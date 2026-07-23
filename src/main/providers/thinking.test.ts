import { describe, it, expect } from 'vitest'
import { joinThinking } from './thinking'

describe('joinThinking (capture du raisonnement, partagé claude+codex)', () => {
  it('concatène plusieurs fragments par saut de ligne (pas d’écrasement)', () => {
    expect(joinThinking(['je pèse A', 'contre B', 'donc C'])).toBe('je pèse A\ncontre B\ndonc C')
  })
  it('aucun fragment / que du vide → undefined (pas chaîne vide)', () => {
    expect(joinThinking([])).toBeUndefined()
    expect(joinThinking(['', '   ', undefined, null])).toBeUndefined()
  })
  it('jette les fragments vides entre deux réels', () => {
    expect(joinThinking(['a', '', 'b'])).toBe('a\nb')
  })
  it('borne à 20k caractères (garde la fin)', () => {
    const big = 'x'.repeat(50_000)
    const out = joinThinking([big])
    expect(out?.length).toBe(20_000)
  })
})
