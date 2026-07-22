import { describe, it, expect } from 'vitest'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import type { OrchestrationStep } from './orchestrator'

const step = (over: Partial<OrchestrationStep>): OrchestrationStep => ({ step: 'exec', ...over })

describe('CostCircuitBreaker', () => {
  it('ne trip pas tant que sous le seuil', () => {
    const b = new CostCircuitBreaker({ maxTokens: 1000 })
    expect(b.observe(step({ tokens: 400 }))).toBeNull()
    expect(b.observe(step({ tokens: 400 }))).toBeNull()
    expect(b.totals.tokens).toBe(800)
  })

  it('trip quand les tokens cumulés dépassent le seuil', () => {
    const b = new CostCircuitBreaker({ maxTokens: 1000 })
    b.observe(step({ tokens: 700 }))
    const t = b.observe(step({ tokens: 700 })) // cumul 1400 > 1000
    expect(t?.trip).toBe(true)
    expect(t?.spentTokens).toBe(1400)
    expect(t?.reason).toContain('tokens 1400 > seuil 1000')
  })

  it('trip sur le coût USD cumulé', () => {
    const b = new CostCircuitBreaker({ maxUsd: 1.5 })
    b.observe(step({ costUsd: 1.0 }))
    const t = b.observe(step({ costUsd: 1.0 }))
    expect(t?.trip).toBe(true)
    expect(t?.reason).toContain('coût 2.00$ > seuil 1.50$')
  })

  it('ne trip QU’UNE fois (pas de notif en boucle après coupure)', () => {
    const b = new CostCircuitBreaker({ maxTokens: 100 })
    expect(b.observe(step({ tokens: 200 }))?.trip).toBe(true)
    expect(b.observe(step({ tokens: 200 }))).toBeNull() // déjà tripped
    expect(b.hasTripped).toBe(true)
  })

  it('un costUsd/tokens NaN n’empoisonne PAS le cumul (Corrector #3)', () => {
    const b = new CostCircuitBreaker({ maxTokens: 1000 })
    b.observe(step({ tokens: NaN })) // ne doit pas rendre spentTokens NaN
    expect(b.totals.tokens).toBe(0)
    const t = b.observe(step({ tokens: 1500 })) // le dépassement réel doit toujours trip
    expect(t?.trip).toBe(true)
  })

  it('sans limite déclarée : ne trip jamais (opt-in)', () => {
    const b = new CostCircuitBreaker({})
    expect(b.observe(step({ tokens: 10_000_000, costUsd: 999 }))).toBeNull()
  })
})
