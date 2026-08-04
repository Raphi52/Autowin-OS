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
  /** Maximum provider calls. Useful when usage/cost are unavailable. */
  maxCalls?: number
  /**
   * Plafond des tokens arrivés SANS coût chiffré, quand `maxUsd` est armé. Au-delà, on coupe : le
   * plafond USD ne peut structurellement pas mordre sur ce volume, donc continuer serait dépenser
   * en aveugle. Absent → valeur par défaut ci-dessous.
   */
  maxUncostedTokens?: number
}

/**
 * Seuil par défaut du volume non chiffré quand `maxUsd` est armé sans seuil explicite.
 *
 * Poser un plafond USD est la façon NATURELLE de dire « ne dépense pas plus que ça ». Sans garde-fou
 * ici, ce plafond restait sans effet dès que le provider ne chiffre pas ses tours — le trou mesuré le
 * 2026-08-04 : 532M de tokens codex comptés à zéro sur l'ensemble du journal. (Un premier relevé
 * annonçait 1,0 Md : il sommait `input + cacheRead` alors que chez codex le cache est DÉJÀ inclus dans
 * l'input — cf. l'invariant de `Usage`. Le défaut était réel, sa magnitude surestimée d'un facteur 1,9.)
 *
 * La valeur est CALIBRÉE sur les runs réels, pas choisie au hasard : le plus lourd du journal consomme
 * ~94M tokens non chiffrés (conv-102, 118 appels de sous-agents). Un seuil à 100M l'aurait coupé à 7 %
 * près — un run légitime tué par un garde-fou trop serré, la pire façon de « protéger ». 250M laisse
 * 2,6× de marge au run le plus lourd observé tout en arrêtant une dérive d'un ordre de grandeur.
 */
export const DEFAULT_MAX_UNCOSTED_TOKENS = 250_000_000

export interface CircuitBreakerTrip {
  trip: true
  reason: string
  spentUsd: number
  spentTokens: number
  spentCalls: number
  /** Tokens comptabilisés SANS coût remonté par le provider (donc invisibles pour `maxUsd`). */
  uncostedTokens: number
}

export class CostCircuitBreaker {
  private spentUsd = 0
  private spentTokens = 0
  private spentCalls = 0
  private uncostedTokens = 0
  private uncostedCalls = 0
  private tripped = false

  constructor(private readonly limits: CircuitBreakerLimits = {}) {}

  get totals(): {
    usd: number
    tokens: number
    calls: number
    /**
     * Volume arrivé sans prix. Exposé pour que l'appelant puisse AFFICHER « $X + N tokens non
     * chiffrés » au lieu d'un montant qui se lit comme un total complet — le coût affiché
     * sous-estimait de ~88 % sur les runs mesurés, précisément parce que ce volume était muet.
     */
    uncostedTokens: number
    uncostedCalls: number
  } {
    return {
      usd: this.spentUsd,
      tokens: this.spentTokens,
      calls: this.spentCalls,
      uncostedTokens: this.uncostedTokens,
      uncostedCalls: this.uncostedCalls
    }
  }

  /**
   * Comptabilise un step et rend une décision de coupure si un seuil est franchi. Ne trip QU'UNE
   * fois (l'appelant coupe au 1er trip ; les steps suivants — le temps que l'abort se propage — ne
   * re-déclenchent pas de notification en boucle).
   */
  observe(step: OrchestrationStep): CircuitBreakerTrip | null {
    // Number.isFinite (pas `typeof === 'number'`) : `typeof NaN === 'number'` empoisonnerait le cumul
    // (NaN + x = NaN, comparaisons toujours false → breaker désactivé silencieusement). (Corrector #3.)
    const chiffre = Number.isFinite(step.costUsd)
    if (chiffre) this.spentUsd += step.costUsd as number
    if (Number.isFinite(step.tokens)) this.spentTokens += step.tokens as number
    // Tour arrivé SANS prix : son volume est invisible pour `maxUsd`. On le compte à part plutôt que
    // de le laisser disparaître — c'est ce silence qui rendait le plafond USD inopérant.
    if (!chiffre && Number.isFinite(step.tokens)) {
      this.uncostedTokens += step.tokens as number
      this.uncostedCalls += 1
    }
    this.spentCalls += 1
    if (this.tripped) return null
    const reasons: string[] = []
    if (this.limits.maxUsd !== undefined && this.spentUsd > this.limits.maxUsd) {
      reasons.push(`coût ${this.spentUsd.toFixed(2)}$ > seuil ${this.limits.maxUsd.toFixed(2)}$`)
    }
    if (this.limits.maxTokens !== undefined && this.spentTokens > this.limits.maxTokens) {
      reasons.push(`tokens ${this.spentTokens} > seuil ${this.limits.maxTokens}`)
    }
    if (this.limits.maxCalls !== undefined && this.spentCalls > this.limits.maxCalls) {
      reasons.push(`appels ${this.spentCalls} > seuil ${this.limits.maxCalls}`)
    }
    // Le plafond USD est armé mais une partie du volume n'a PAS de prix : on ne peut pas prétendre le
    // surveiller. Le motif nomme la cause réelle — dire « coût dépassé » mentirait, le coût est inconnu.
    if (this.limits.maxUsd !== undefined) {
      const seuilNonChiffre = this.limits.maxUncostedTokens ?? DEFAULT_MAX_UNCOSTED_TOKENS
      if (this.uncostedTokens > seuilNonChiffre) {
        reasons.push(
          `${this.uncostedTokens} tokens non chiffrés par le provider ` +
            `(> seuil ${seuilNonChiffre}) : le plafond ${this.limits.maxUsd.toFixed(2)}$ ne peut pas ` +
            `mordre dessus`
        )
      }
    }
    if (!reasons.length) return null
    this.tripped = true
    return {
      trip: true,
      reason: reasons.join(' ; '),
      spentUsd: this.spentUsd,
      spentTokens: this.spentTokens,
      spentCalls: this.spentCalls,
      uncostedTokens: this.uncostedTokens
    }
  }

  get hasTripped(): boolean {
    return this.tripped
  }
}
