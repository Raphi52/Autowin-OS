import { describe, expect, it } from 'vitest'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import type { OrchestrationStep } from './orchestrator'

/**
 * Le plafond USD était SILENCIEUSEMENT INOPÉRANT sur un provider qui ne chiffre pas ses tours.
 *
 * Mesuré le 2026-08-04 sur le journal de prompts réel : 1 280 appels codex totalisant 1,0 MILLIARD de
 * tokens sont remontés SANS `costUsd`, donc comptés à zéro. Conséquence : `maxUsd` ne se déclenchait
 * jamais sur ces runs, et le coût affiché sous-estimait d'environ 88 % (~$283 affichés). Un plafond
 * qu'on croit armé et qui ne peut pas mordre est pire que pas de plafond : on lance et on part.
 *
 * On ne le corrige PAS en inventant un tarif — un prix sans source tracée serait un chiffre faux
 * présenté comme mesuré. On rend l'aveuglement VISIBLE et on le fait TRIPPER.
 */
const step = (over: Partial<OrchestrationStep> = {}): OrchestrationStep => ({
  step: 'exec',
  provider: 'codex',
  tokens: 400_000,
  ...over
})

describe('disjoncteur de coût — volume non chiffré', () => {
  it('compte les tokens arrivés sans coût, au lieu de les ignorer', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 5 })
    breaker.observe(step())
    breaker.observe(step())
    expect(breaker.totals.uncostedTokens).toBe(800_000)
    expect(breaker.totals.uncostedCalls).toBe(2)
  })

  it('un provider qui chiffre ses tours ne compte RIEN comme non chiffré', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 5 })
    breaker.observe(step({ provider: 'claude', costUsd: 0.42 }))
    expect(breaker.totals.uncostedTokens).toBe(0)
    expect(breaker.totals.uncostedCalls).toBe(0)
    expect(breaker.totals.usd).toBeCloseTo(0.42)
  })

  it('un plafond USD armé DÉCLENCHE quand le volume non chiffré le rend inopérant', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 5, maxUncostedTokens: 1_000_000 })
    expect(breaker.observe(step({ tokens: 600_000 }))).toBeNull()
    const trip = breaker.observe(step({ tokens: 600_000 }))
    expect(trip).not.toBeNull()
    // Le motif doit NOMMER la cause, pas dire « coût dépassé » : le coût est justement inconnu.
    expect(trip!.reason).toMatch(/non chiffr/i)
    expect(trip!.reason).toContain('1200000')
    expect(trip!.uncostedTokens).toBe(1_200_000)
  })

  it("sans plafond USD, un volume non chiffré ne déclenche rien (on ne surveille pas ce qui n'est pas demandé)", () => {
    const breaker = new CostCircuitBreaker({ maxCalls: 99 })
    expect(breaker.observe(step({ tokens: 50_000_000 }))).toBeNull()
    expect(breaker.totals.uncostedTokens).toBe(50_000_000)
  })

  it('un plafond USD sans seuil de non-chiffré explicite garde un garde-fou par défaut', () => {
    // Sinon poser `maxUsd` seul laisse exactement le trou mesuré : rien ne mord jamais.
    const breaker = new CostCircuitBreaker({ maxUsd: 1 })
    let trip: ReturnType<CostCircuitBreaker['observe']> = null
    for (let i = 0; i < 400 && !trip; i++) trip = breaker.observe(step({ tokens: 1_000_000 }))
    expect(trip).not.toBeNull()
    expect(trip!.reason).toMatch(/non chiffr/i)
  })

  /**
   * LA FRONTIÈRE, dans le sens qui compte : un garde-fou qui coupe un run légitime est un défaut, pas
   * une protection. Le run le plus lourd du journal réel (conv-102 : 118 appels de sous-agents) totalise
   * ~94M tokens non chiffrés — il DOIT passer. Un premier jet à 100M l'aurait coupé à 7 % près.
   */
  it('ne coupe PAS le run réel le plus lourd observé (~94M tokens non chiffrés)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 20 })
    let trip: ReturnType<CostCircuitBreaker['observe']> = null
    // 118 appels × 795k tokens ≈ 93,8M, la forme mesurée du run.
    for (let i = 0; i < 118 && !trip; i++) trip = breaker.observe(step({ tokens: 795_000 }))
    expect(trip).toBeNull()
    expect(breaker.totals.uncostedTokens).toBeGreaterThan(93_000_000)
  })

  it("coupe une dérive d'un ordre de grandeur au-dessus du plus lourd run observé", () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 20 })
    let trip: ReturnType<CostCircuitBreaker['observe']> = null
    for (let i = 0; i < 1_200 && !trip; i++) trip = breaker.observe(step({ tokens: 795_000 }))
    expect(trip).not.toBeNull()
    expect(trip!.uncostedTokens).toBeGreaterThan(250_000_000)
  })
})
