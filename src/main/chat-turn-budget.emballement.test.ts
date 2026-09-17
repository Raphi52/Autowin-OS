import { describe, expect, it } from 'vitest'
import { chatTurnBudget } from './chat-turn-budget'
import { CostCircuitBreaker } from './cost-circuit-breaker'

/**
 * Le plafond d'OBSERVATION (2 $ / 1,5 M) reste en mesure seule — decision du 12/08, conv-1149.
 * Ce qui manquait, c'est un plafond d'EMBALLEMENT arme par DEFAUT, calibre sur les tours reels.
 * Mesure du 2026-09-16 sur les 2 749 tours de `.autowin-data` (activity/chat-usage, in+out) :
 * mediane 808 165, p90 4 242 762, p99 11 956 978, max 33 612 006 ; cout max 18,02 $.
 */
describe('plafond d’emballement du tour de chat', () => {
  it('existe par DEFAUT, sans aucune variable d’environnement', () => {
    const budget = chatTurnBudget({})
    expect(budget.emballement.maxTokens).toBe(24_000_000)
    expect(budget.emballement.maxUsd).toBe(25)
  })

  it('laisse passer le p99 mesure (11,96 M) et coupe le tour record (33,6 M)', () => {
    const { emballement } = chatTurnBudget({})
    const passant = new CostCircuitBreaker(emballement)
    expect(
      passant.observe({ step: 'exec', detail: 'chat', tokens: 11_956_978 } as never)
    ).toBeNull()
    const emballe = new CostCircuitBreaker(emballement)
    expect(
      emballe.observe({ step: 'exec', detail: 'chat', tokens: 33_612_006 } as never)
    ).not.toBeNull()
  })

  it('un cap explicite de l’utilisateur reste prioritaire sur le plafond d’emballement', () => {
    const budget = chatTurnBudget({ AUTOWIN_CHAT_TOKEN_CAP: '900000' })
    expect(budget.enforcement).toBe('blocking')
    expect(budget.emballement.maxTokens).toBe(900_000)
  })
})
