// Agregation cout/tokens + budget avec seuil d'alerte.
// Version SIMPLIFIEE : simple compteur cumulatif + alerte sur ratio, sans
// ponderation de risque (pas de scoring par provider/role).

/** Un tour (turn) d'agent, avec son cout et sa consommation de tokens. */
export interface TurnCost {
  provider: string
  role?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  costUsd?: number
}

/** Totaux de tokens cumules. */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
}

/** Agregat cout/tours pour une cle (provider ou role). */
export interface GroupTotal {
  costUsd: number
  turns: number
}

/** Statut budget courant. */
export interface BudgetStatus {
  spent: number
  budget: number | null
  ratio: number | null
  alert: boolean
}

/** Ratio a partir duquel l'alerte se declenche (80% du budget). */
const ALERT_RATIO_THRESHOLD = 0.8

export class CostAggregator {
  private turns: TurnCost[] = []

  constructor(private readonly budgetUsd?: number) {}

  /** Enregistre un nouveau tour. */
  add(t: TurnCost): void {
    this.turns.push(t)
  }

  /** Cout total cumule (0 si aucun tour n'a de costUsd). */
  totalUsd(): number {
    return this.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0)
  }

  /** Totaux de tokens cumules (input/output/cacheRead). */
  totalTokens(): TokenTotals {
    return this.turns.reduce(
      (acc, t) => ({
        input: acc.input + t.inputTokens,
        output: acc.output + t.outputTokens,
        cacheRead: acc.cacheRead + (t.cacheReadTokens ?? 0)
      }),
      { input: 0, output: 0, cacheRead: 0 }
    )
  }

  /** Agregation cout/tours par provider. */
  byProvider(): Record<string, GroupTotal> {
    return this.groupBy((t) => t.provider)
  }

  /** Agregation cout/tours par role (les tours sans role sont ignores). */
  byRole(): Record<string, GroupTotal> {
    return this.groupBy((t) => t.role)
  }

  /** Statut budget : ratio et alerte (>= 80% du budget defini). */
  budgetStatus(): BudgetStatus {
    const spent = this.totalUsd()
    const budget = this.budgetUsd ?? null
    if (budget === null) {
      return { spent, budget: null, ratio: null, alert: false }
    }
    const ratio = budget > 0 ? spent / budget : 0
    return { spent, budget, ratio, alert: ratio >= ALERT_RATIO_THRESHOLD }
  }

  private groupBy(keyFn: (t: TurnCost) => string | undefined): Record<string, GroupTotal> {
    const result: Record<string, GroupTotal> = {}
    for (const t of this.turns) {
      const key = keyFn(t)
      if (key === undefined) continue
      if (!result[key]) {
        result[key] = { costUsd: 0, turns: 0 }
      }
      result[key].costUsd += t.costUsd ?? 0
      result[key].turns += 1
    }
    return result
  }
}
