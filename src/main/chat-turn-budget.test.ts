import { describe, expect, it } from 'vitest'
import { chatTurnBudget, estCoupureBudget, CHAT_BUDGET_ABORT_PREFIX } from './chat-turn-budget'

/**
 * Mesuré sur conv-1149 (13/08) : un tour de campagne à 3,06 $ / 3,1 M tokens coupé par le
 * disjoncteur câblé (2 $ / 1,5 M) et affiché `cancelled` — un stop volontaire que personne
 * n'avait demandé. Ces tests fixent la politique : mesure seule sans cap explicite.
 */
describe('budget du tour de chat', () => {
  it('sans cap explicite : mesure seule, les seuils ne servent qu’à OBSERVER', () => {
    const budget = chatTurnBudget({})
    expect(budget.enforcement).toBe('metering-only')
    expect(budget.limits).toEqual({ maxUsd: 2, maxTokens: 1_500_000, maxCalls: 6 })
  })

  it('un cap posé par l’utilisateur est un contrat : coupure armée', () => {
    expect(chatTurnBudget({ AUTOWIN_CHAT_USD_CAP: '5' })).toEqual({
      limits: { maxUsd: 5, maxTokens: 1_500_000, maxCalls: 6 },
      enforcement: 'blocking'
    })
    expect(chatTurnBudget({ AUTOWIN_CHAT_TOKEN_CAP: '900000' }).enforcement).toBe('blocking')
    expect(chatTurnBudget({ AUTOWIN_CHAT_CALL_CAP: '3' }).enforcement).toBe('blocking')
  })

  it('un cap invalide ne vaut pas contrat', () => {
    expect(chatTurnBudget({ AUTOWIN_CHAT_USD_CAP: '0' }).enforcement).toBe('metering-only')
    expect(chatTurnBudget({ AUTOWIN_CHAT_USD_CAP: 'abc' }).enforcement).toBe('metering-only')
  })

  it('une coupure budget est reconnaissable à son motif — jamais confondue avec un stop volontaire', () => {
    expect(estCoupureBudget(`${CHAT_BUDGET_ABORT_PREFIX} : USD 2 dépassés`)).toBe(true)
    expect(estCoupureBudget('interrompu par l’utilisateur')).toBe(false)
    expect(estCoupureBudget(undefined)).toBe(false)
  })
})
