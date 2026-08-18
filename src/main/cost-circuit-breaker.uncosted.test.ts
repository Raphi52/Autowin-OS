import { describe, expect, it } from 'vitest'
import { chatTurnBudget } from './chat-turn-budget'
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

/**
 * LE GARDE VOLUMÉTRIQUE EST INATTEIGNABLE EN PRODUCTION, et les tests ci-dessus ne le montraient pas
 * parce qu'ils instancient `{maxUsd}` SEUL. La seule instanciation réelle (`index.ts`) passe par
 * `chatTurnBudget()`, qui pose TOUJOURS `maxTokens: 1_500_000` — or `uncostedTokens <= spentTokens`,
 * donc `maxTokens` mord toujours avant le seuil de 250M. Ces tests sont donc construits sur les
 * limites EXACTES de `chatTurnBudget({})`, sinon ils prouvent la même illusion.
 */
const LIMITES_PROD = chatTurnBudget({}).limits

describe('disjoncteur de coût — montant ESTIMÉ des tours non tarifés (limites de production)', () => {
  it('les limites de référence sont bien celles de la production', () => {
    expect(LIMITES_PROD).toEqual({ maxUsd: 2, maxTokens: 1_500_000, maxCalls: 6 })
  })

  it('coupe sur le MONTANT estimé d’un modèle connu, bien avant les plafonds de volume', () => {
    const breaker = new CostCircuitBreaker(LIMITES_PROD)
    const opus = (): OrchestrationStep => ({
      step: 'exec',
      provider: 'codex',
      model: 'claude-opus-5',
      tokens: 220_000,
      usage: { inputTokens: 200_000, outputTokens: 20_000 }
    })
    expect(breaker.observe(opus())).toBeNull() // 1,50 $ estimés
    const trip = breaker.observe(opus()) // 3,00 $ estimés > 2 $
    expect(trip).not.toBeNull()
    expect(trip!.reason).toMatch(/estim/i)
    // Ni le volume ni le nombre d’appels n’ont mordu : c’est bien le montant qui coupe.
    expect(trip!.spentTokens).toBe(440_000)
    expect(trip!.spentCalls).toBe(2)
    expect(trip!.estimatedUsd).toBeCloseTo(3, 5)
    // Le montant MESURÉ reste à zéro : estimé et mesuré ne se mélangent jamais.
    expect(trip!.spentUsd).toBe(0)
  })

  it('un run entièrement TARIFÉ n’accumule aucun estimé et ne déclenche rien de nouveau', () => {
    const breaker = new CostCircuitBreaker(LIMITES_PROD)
    for (let i = 0; i < 5; i++) {
      expect(
        breaker.observe({
          step: 'exec',
          provider: 'claude',
          model: 'claude-opus-5',
          tokens: 220_000,
          costUsd: 0.1,
          usage: { inputTokens: 200_000, outputTokens: 20_000 }
        })
      ).toBeNull()
    }
    expect(breaker.totals.estimatedUsd).toBe(0)
    expect(breaker.totals.uncostedTokens).toBe(0)
    expect(breaker.totals.usd).toBeCloseTo(0.5)
  })

  it('tarification PARTIELLE sur un même run : le motif nomme les DEUX moitiés', () => {
    const breaker = new CostCircuitBreaker(LIMITES_PROD)
    breaker.observe({
      step: 'exec',
      provider: 'claude',
      model: 'claude-opus-5',
      tokens: 10_000,
      costUsd: 0.75,
      usage: { inputTokens: 9_000, outputTokens: 1_000 }
    })
    const trip = breaker.observe({
      step: 'exec',
      provider: 'codex',
      model: 'claude-opus-5',
      tokens: 440_000,
      usage: { inputTokens: 400_000, outputTokens: 40_000 }
    })
    expect(trip).not.toBeNull()
    expect(trip!.reason).toMatch(/estim/i)
    expect(trip!.reason).toContain('0.75') // la moitié MESURÉE est nommée
    expect(trip!.reason).toContain('3.00') // la moitié ESTIMÉE aussi
    expect(trip!.spentUsd).toBeCloseTo(0.75)
    expect(trip!.estimatedUsd).toBeCloseTo(3, 5)
  })

  it('modèle INCONNU : aucun montant inventé, le repli volumétrique reste la seule garde', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 5 })
    breaker.observe({
      step: 'exec',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      tokens: 400_000,
      usage: { inputTokens: 380_000, outputTokens: 20_000 }
    })
    expect(breaker.totals.estimatedUsd).toBe(0)
    expect(breaker.totals.uncostedTokens).toBe(400_000)
  })
})
