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
  /** Modèle concret du tour — nécessaire pour distinguer le coût des N modèles d'un fan-out. */
  model?: string
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
  /** Nombre TOTAL de tours agrégés (tarifés ou non). */
  turns: number
  /**
   * Tours SANS `costUsd`, donc comptés 0 dans `spent`. Sur les données réelles la majorité des
   * tours n'est pas tarifée : présenter `spent` comme un total sans ce compteur, c'est afficher
   * un chiffre amputé comme s'il était complet.
   */
  unpricedTurns: number
  /** `true` dès qu'au moins un tour n'est pas tarifé : `spent` est un PLANCHER, pas un total. */
  spentIsPartial: boolean
}

/** Ratio a partir duquel l'alerte se declenche (80% du budget). */
const ALERT_RATIO_THRESHOLD = 0.8

export class CostAggregator {
  private turns: TurnCost[] = []

  /**
   * `budgetUsd` : plafond fixe, ou RESOLVEUR relu à chaque `budgetStatus()`. Le résolveur existe
   * parce que le plafond réel vit dans un réglage persisté modifiable en cours de session : figé à
   * la construction, le seuil d'alerte restait structurellement inatteignable.
   * `persistPath` : fichier JSONL où historiser les tours (rechargé au démarrage).
   */
  constructor(
    private readonly budgetUsd?: number | (() => number | null),
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

  /** Statut budget : ratio et alerte (>= 80% du budget defini). */
  budgetStatus(): BudgetStatus {
    const spent = this.totalUsd()
    const turns = this.turns.length
    const unpricedTurns = this.turns.reduce((n, t) => n + (t.costUsd === undefined ? 1 : 0), 0)
    const coverage = { turns, unpricedTurns, spentIsPartial: unpricedTurns > 0 }
    const budget = this.resolveBudget()
    if (budget === null) {
      return { spent, budget: null, ratio: null, alert: false, ...coverage }
    }
    const ratio = budget > 0 ? spent / budget : 0
    return { spent, budget, ratio, alert: ratio >= ALERT_RATIO_THRESHOLD, ...coverage }
  }

  /** Plafond courant : valeur fixe, appel du résolveur, ou `null` si aucun plafond. */
  private resolveBudget(): number | null {
    if (typeof this.budgetUsd === 'function') {
      try {
        const value = this.budgetUsd()
        return typeof value === 'number' && Number.isFinite(value) ? value : null
      } catch {
        return null // un réglage illisible ne doit pas casser le dashboard
      }
    }
    return this.budgetUsd ?? null
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
