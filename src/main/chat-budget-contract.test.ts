import { describe, expect, it } from 'vitest'
import { zoneDuTourDeChat } from './source-process-principal.test-helpers'
import { chatTurnBudget } from './chat-turn-budget'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import type { OrchestrationStep } from './orchestrator'

/**
 * BUDGET D'UN TOUR DE CHAT.
 *
 * Le circuit-breaker de coût ne protegeait que les runs orchestres. Mesure du 2026-07-28 : un seul
 * tour a coute 2,109 $ (40 iterations d'outils) sans qu'aucune borne n'existe cote chat, dans une
 * session facturee 26,65 $/h. Ces assertions garantissent que le tour de chat est borne ET coupe.
 */
/*
 * La ZONE du tour de chat, lue la ou elle vit : le tour pilote a ete extrait d'`index.ts` vers
 * `src/main/chat/run-pilot-chat.ts` le 2026-09-02, et cette tranche codee en dur ne bornait plus
 * rien — 4 controles rouges alors que le budget etait INTACT.
 */
const chatRunner = zoneDuTourDeChat()

describe('tour de chat — budget applique', () => {
  it('instancie un breaker dans le runner partagé du tour de chat', () => {
    expect(chatRunner).toContain('new CostCircuitBreaker(')
    expect(chatRunner).toContain('AUTOWIN_CHAT_USD_CAP')
  })

  it('compte CHAQUE appel du tour (et pas seulement le total final)', () => {
    expect(chatRunner).toContain('chatBreaker.observe(')
    expect(chatRunner).toMatch(/prompt-call.*callUsage|callUsage[\s\S]{0,200}chatBreaker\.observe/)
  })

  it('COUPE reellement le tour au depassement — quand un cap explicite l’exige', () => {
    const tripBlock = chatRunner.slice(chatRunner.indexOf('chatBreaker.observe('))
    expect(tripBlock).toContain('controller.abort(')
    // ... et la coupure est conditionnee au contrat explicite, jamais au defaut cable.
    expect(tripBlock).toContain("budgetDuTour.enforcement === 'blocking'")
  })

  it('a un seuil d’OBSERVATION par DEFAUT (une variable d’env absente ne desarme pas la mesure)', () => {
    // Politique extraite dans chat-turn-budget.ts (conv-1149) : sans cap explicite les seuils
    // restent armes pour OBSERVER (ledger), et seule la coupure est desarmee.
    const budget = chatTurnBudget({})
    expect(budget.limits).toEqual({ maxUsd: 2, maxTokens: 1_500_000, maxCalls: 6 })
    expect(budget.enforcement).toBe('metering-only')
  })

  it('place tout le tour dans le supervisor avant le premier appel provider', () => {
    expect(chatRunner).toContain('os.runChatTurn(')
  })
})

describe('breaker — comportement sur des usages de CHAT reels', () => {
  const step = (costUsd: number): OrchestrationStep =>
    ({ step: 'exec', detail: 'chat', costUsd, tokens: 1000 }) as OrchestrationStep

  it('laisse passer un tour normal (mesure post-correctif : ~0,05 $)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 2 })
    expect(breaker.observe(step(0.05))).toBeNull()
    expect(breaker.observe(step(0.05))).toBeNull()
    expect(breaker.hasTripped).toBe(false)
  })

  it('coupe le tour a 40 iterations qui derapent (cas mesure a 2,109 $)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 2 })
    let trippedAt = 0
    for (let i = 1; i <= 40; i++) {
      if (breaker.observe(step(0.0527)) && !trippedAt) trippedAt = i
    }
    expect(trippedAt).toBeGreaterThan(0)
    expect(trippedAt).toBeLessThan(40) // coupe AVANT la fin, pas en post-mortem
  })

  it('ne trip qu’une fois (pas de coupure en boucle pendant la propagation de l’abort)', () => {
    const breaker = new CostCircuitBreaker({ maxUsd: 0.1 })
    expect(breaker.observe(step(0.5))).not.toBeNull()
    expect(breaker.observe(step(0.5))).toBeNull()
  })
})
