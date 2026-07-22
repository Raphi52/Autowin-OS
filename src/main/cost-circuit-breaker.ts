/**
 * Circuit-breaker de coût (#3) : surveille le coût/tokens CUMULÉ d'un run en cours et signale qu'il
 * faut le COUPER avant de dépasser un seuil déclaré — plutôt que de découvrir la facture en
 * post-mortem. Transforme "à surveiller" en "je peux lancer et partir".
 *
 * Module PUR (aucun effet de bord) : il OBSERVE les steps d'orchestration et rend une décision
 * `{trip, reason}`. L'ARRÊT réel (AbortController) + la notification desktop sont faits par l'appelant
 * (index.ts) — on garde le breaker testable sans Electron.
 *
 * Générique tous providers : ne dépend que des champs coût/tokens communs de `OrchestrationStep`.
 */
import type { OrchestrationStep } from './orchestrator'

export interface CircuitBreakerLimits {
  /** Plafond de coût cumulé en USD (trip si dépassé). Absent → non surveillé sur ce critère. */
  maxUsd?: number
  /** Plafond de tokens cumulés (in+out) (trip si dépassé). Absent → non surveillé. */
  maxTokens?: number
}

export interface CircuitBreakerTrip {
  trip: true
  reason: string
  spentUsd: number
  spentTokens: number
}

export class CostCircuitBreaker {
  private spentUsd = 0
  private spentTokens = 0
  private tripped = false

  constructor(private readonly limits: CircuitBreakerLimits = {}) {}

  get totals(): { usd: number; tokens: number } {
    return { usd: this.spentUsd, tokens: this.spentTokens }
  }

  /**
   * Comptabilise un step et rend une décision de coupure si un seuil est franchi. Ne trip QU'UNE
   * fois (l'appelant coupe au 1er trip ; les steps suivants — le temps que l'abort se propage — ne
   * re-déclenchent pas de notification en boucle).
   */
  observe(step: OrchestrationStep): CircuitBreakerTrip | null {
    if (typeof step.costUsd === 'number') this.spentUsd += step.costUsd
    if (typeof step.tokens === 'number') this.spentTokens += step.tokens
    if (this.tripped) return null
    const reasons: string[] = []
    if (this.limits.maxUsd !== undefined && this.spentUsd > this.limits.maxUsd) {
      reasons.push(`coût ${this.spentUsd.toFixed(2)}$ > seuil ${this.limits.maxUsd.toFixed(2)}$`)
    }
    if (this.limits.maxTokens !== undefined && this.spentTokens > this.limits.maxTokens) {
      reasons.push(`tokens ${this.spentTokens} > seuil ${this.limits.maxTokens}`)
    }
    if (!reasons.length) return null
    this.tripped = true
    return {
      trip: true,
      reason: reasons.join(' ; '),
      spentUsd: this.spentUsd,
      spentTokens: this.spentTokens
    }
  }

  get hasTripped(): boolean {
    return this.tripped
  }
}
