// Agregation cout/tokens + budget avec seuil d'alerte.
// Version SIMPLIFIEE : simple compteur cumulatif + alerte sur ratio, sans
// ponderation de risque (pas de scoring par provider/role).
// F1 : persistance append-only optionnelle (JSONL) → le dashboard Cout ne se vide plus
// au redemarrage (avant : compteur en RAM perdu a chaque relance de l'app).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Un tour (turn) d'agent, avec son cout et sa consommation de tokens. */
export interface TurnCost {
  provider: string
  role?: string
  /** #7 — phase de pipeline (scout/frame/build/clean/judge) pour ventiler cout & latence. */
  phase?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  costUsd?: number
  /** #7 — latence de l'appel (ms) pour les percentiles par phase. */
  durationMs?: number
}

/** Percentiles de latence pour une phase. */
export interface LatencyStat {
  p50: number
  p95: number
  count: number
}

/** Percentile par rang le plus proche (nearest-rank) sur un tableau TRIÉ croissant. */
function nearestRankPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
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

  /** `persistPath` : fichier JSONL où historiser les tours (rechargé au démarrage). */
  constructor(
    private readonly budgetUsd?: number,
    private readonly persistPath?: string
  ) {
    if (persistPath && existsSync(persistPath)) {
      for (const line of readFileSync(persistPath, 'utf8').split(/\r?\n/)) {
        if (!line) continue
        try {
          this.turns.push(JSON.parse(line) as TurnCost)
        } catch {
          /* ligne corrompue — ignorée */
        }
      }
    }
  }

  /** Enregistre un nouveau tour (et l'historise sur disque si `persistPath`). */
  add(t: TurnCost): void {
    this.turns.push(t)
    if (this.persistPath) {
      try {
        mkdirSync(dirname(this.persistPath), { recursive: true })
        appendFileSync(this.persistPath, `${JSON.stringify(t)}\n`, 'utf8')
      } catch {
        /* persistance best-effort : un échec disque ne casse pas l'agrégation en mémoire */
      }
    }
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

  /** #7 — agregation cout/tours par phase de pipeline (les tours sans phase sont ignores). */
  byPhase(): Record<string, GroupTotal> {
    return this.groupBy((t) => t.phase)
  }

  /** #7 — latence p50/p95 par phase (les tours sans durationMs sont ignores). */
  latencyByPhase(): Record<string, LatencyStat> {
    const buckets = new Map<string, number[]>()
    for (const t of this.turns) {
      if (t.phase === undefined || t.durationMs === undefined) continue
      const list = buckets.get(t.phase) ?? []
      list.push(t.durationMs)
      buckets.set(t.phase, list)
    }
    const result: Record<string, LatencyStat> = {}
    for (const [phase, values] of buckets) {
      const sorted = [...values].sort((a, b) => a - b)
      result[phase] = {
        p50: nearestRankPercentile(sorted, 50),
        p95: nearestRankPercentile(sorted, 95),
        count: sorted.length
      }
    }
    return result
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
