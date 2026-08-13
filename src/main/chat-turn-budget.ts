/**
 * Budget d'un TOUR de chat — la POLITIQUE, séparée du mécanisme (`cost-circuit-breaker.ts`).
 *
 * Mesuré sur conv-1149 (13/08) : le disjoncteur chat coupait au seuil câblé (2 $ / 1,5 M tokens)
 * et maquillait la coupure en `cancelled` — le statut d'un STOP VOLONTAIRE, exclu à ce titre de la
 * relance automatique. Une campagne « 1 prompt = 1 réussite » de 3 $ mourait donc en silence,
 * déguisée en renoncement de l'utilisateur. Double contradiction avec la décision du 12/08 :
 * les plafonds de dépense mesurent, ils ne tuent plus.
 *
 * Politique : les compteurs tournent TOUJOURS (ils alimentent le ledger et Observatory) ; la
 * COUPURE n'est armée que si l'utilisateur a posé lui-même un plafond via l'environnement
 * (AUTOWIN_CHAT_USD_CAP / _TOKEN_CAP / _CALL_CAP) — poser un cap explicite est un contrat, un
 * défaut câblé n'en est pas un.
 */
import type { CircuitBreakerLimits } from './cost-circuit-breaker'

export interface ChatTurnBudget {
  limits: CircuitBreakerLimits
  /** `blocking` uniquement sur cap explicite de l'utilisateur ; sinon mesure seule. */
  enforcement: 'blocking' | 'metering-only'
}

const positif = (value: string | undefined): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function chatTurnBudget(env: Record<string, string | undefined>): ChatTurnBudget {
  const usd = positif(env.AUTOWIN_CHAT_USD_CAP)
  const tokens = positif(env.AUTOWIN_CHAT_TOKEN_CAP)
  const calls = positif(env.AUTOWIN_CHAT_CALL_CAP)
  const explicite = usd !== undefined || tokens !== undefined || calls !== undefined
  return {
    // Les défauts restent comme SEUILS D'OBSERVATION : un trip en mesure seule écrit une ligne de
    // ledger (le dépassement reste VISIBLE, réflexe « jamais silencieux ») sans rien couper.
    limits: { maxUsd: usd ?? 2, maxTokens: tokens ?? 1_500_000, maxCalls: calls ?? 6 },
    enforcement: explicite ? 'blocking' : 'metering-only'
  }
}

/** Préfixe du motif d'abort posé par la coupure budget — la seule façon de la requalifier ensuite. */
export const CHAT_BUDGET_ABORT_PREFIX = 'budget du tour dépassé'

/**
 * Une coupure budget n'est PAS un stop volontaire : elle doit finir `failed` avec sa cause, jamais
 * `cancelled`. `signal.reason` est le seul canal qui relie l'abort à son motif.
 */
export function estCoupureBudget(reason: unknown): boolean {
  return typeof reason === 'string' && reason.startsWith(CHAT_BUDGET_ABORT_PREFIX)
}
