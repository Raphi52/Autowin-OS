// Agregation cout/tokens + budget avec seuil d'alerte.
// Version SIMPLIFIEE : simple compteur cumulatif + alerte sur ratio, sans
// ponderation de risque (pas de scoring par provider/role).
// F1 : persistance append-only optionnelle (JSONL) → le dashboard Cout ne se vide plus
// au redemarrage (avant : compteur en RAM perdu a chaque relance de l'app).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TokenUsage } from '../../shared/token-usage'
import { resolveCostCoverage, type CostCoverage } from '../../shared/cost-estimate'

/** Un tour (turn) d'agent, avec son cout et sa consommation de tokens. */
export interface TurnCost extends TokenUsage {
  provider: string
  role?: string
  /**
   * Modèle concret du tour, COLLECTÉ et HISTORISÉ (il part dans `cost.jsonl`) pour que le tarif
   * d'un tour non chiffré reste reconstituable a posteriori. Aucun agrégat par modèle n'est
   * exposé ici, et c'est intentionnel : cet agrégateur ne garde que les lectures qui ont un
   * lecteur réel.
   */
  model?: string
  inputTokens: number
  outputTokens: number
  costUsd?: number
  /**
   * QUAND ce tour a ete paye (ISO 8601). Pose a l'ecriture quand l'appelant ne la fournit pas :
   * sans elle, `cost.jsonl` etait une pile de montants hors du temps, impossible a rattacher a un
   * tour de conversation. Optionnel dans le type : les lignes ecrites avant n'en portent pas.
   */
  ts?: string
  /** Conversation d'origine, quand elle est REELLEMENT connue — jamais devinee. */
  conversationId?: string
  /** Tour de chat d'origine, quand il est REELLEMENT connu — jamais devine. */
  turnId?: string
}

/** Ce dont un appelant de cout a besoin : enregistrer un tour. */
export interface CostSink {
  add(t: TurnCost): void
}

/**
 * Meme collecteur de cout, mais chaque tour ecrit porte la conversation et le tour d'origine.
 * Un champ deja renseigne par l'appelant gagne : ce contexte complete, il n'ecrase pas.
 */
export function withCostContext(
  sink: CostSink,
  context: { conversationId?: string; turnId?: string }
): CostSink {
  return {
    add(t: TurnCost): void {
      sink.add({
        ...t,
        conversationId: t.conversationId ?? context.conversationId,
        turnId: t.turnId ?? context.turnId
      })
    }
  }
}

/** Agregat cout/tours pour une cle (provider ou role). */
export interface GroupTotal {
  costUsd: number
  turns: number
}

/** Statut budget courant. */
export interface BudgetStatus {
  /**
   * Somme en USD des tours TARIFÉS uniquement — donc un PLANCHER, jamais un total : voir
   * `spentIsPartial`. L'unité est dans le nom parce que tout le domaine la nomme ailleurs
   * (`maxUsd`, `costUsd`, `totalUsd`).
   */
  pricedSpendUsd: number
  /** Plafond courant en USD, ou `null` si aucun plafond n'est défini. */
  budgetUsd: number | null
  ratio: number | null
  alert: boolean
  /** Nombre TOTAL de tours agrégés (tarifés ou non). */
  turns: number
  /**
   * Tours SANS `costUsd`, donc comptés 0 dans `pricedSpendUsd`. Sur les données réelles la majorité des
   * tours n'est pas tarifée : présenter `pricedSpendUsd` comme un total sans ce compteur, c'est afficher
   * un chiffre amputé comme s'il était complet.
   */
  unpricedTurns: number
  /** `true` dès qu'au moins un tour n'est pas tarifé : `pricedSpendUsd` est un PLANCHER, pas un total. */
  spentIsPartial: boolean
  /**
   * Ce que le systeme SAIT dire du cout — la MEME reponse que l'issue d'orchestration et
   * l'indicateur de conversation. Porte l'estimation au tarif public des tours non tarifes quand
   * le modele est connu : `spentIsPartial` disait qu'il manquait quelque chose sans jamais dire
   * combien.
   */
  coverage: CostCoverage
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
          const parsed: unknown = JSON.parse(line)
          // Une ligne JSON VALIDE mais de mauvaise forme passait le cast et devenait un tour
          // fantome : `inputTokens` non numerique agrege en NaN, provider absent casse le
          // regroupement. Le `catch` ne voyait rien — il ne garde que les JSON illisibles.
          if (isTurnCost(parsed)) this.turns.push(parsed)
        } catch {
          /* ligne corrompue — ignorée */
        }
      }
    }
  }

  /** Enregistre un nouveau tour (et l'historise sur disque si `persistPath`). */
  add(turn: TurnCost): void {
    const t: TurnCost = { ...turn, ts: turn.ts ?? new Date().toISOString() }
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

  /**
   * Agregation cout/tours par provider. Lecture d'INSPECTION : unique lecteur reel,
   * `orchestrator.provider-identity.test.ts` (~l.152), qui verifie que le cout est enregistre sous
   * le provider EXECUTANT et jamais sous le provider DEMANDE. L'ecran de cout ne passe pas par ici
   * (il lit `os:costBreakdown`).
   */
  byProvider(): Record<string, GroupTotal> {
    return this.groupBy((t) => t.provider)
  }

  /** Statut budget : ratio et alerte (>= 80% du budget defini). */
  budgetStatus(): BudgetStatus {
    const pricedSpendUsd = this.totalUsd()
    const turns = this.turns.length
    const unpricedTurns = this.turns.reduce((n, t) => n + (t.costUsd === undefined ? 1 : 0), 0)
    const unpriced = this.turns.filter((t) => t.costUsd === undefined)
    // Le tarif n'est reconstituable que si les tours NON TARIFES servent tous le MEME modele :
    // en choisir un parmi plusieurs serait inventer un montant.
    const model = unpriced.every((t) => t.model === unpriced[0]?.model)
      ? unpriced[0]?.model
      : undefined
    const provider = unpriced.every((t) => t.provider === unpriced[0]?.provider)
      ? unpriced[0]?.provider
      : undefined
    const costCoverage = resolveCostCoverage(
      {
        knownCostUsd: turns > unpricedTurns ? pricedSpendUsd : null,
        unpricedCalls: unpricedTurns,
        inputTokens: unpriced.reduce((n, t) => n + (t.inputTokens || 0), 0),
        outputTokens: unpriced.reduce((n, t) => n + (t.outputTokens || 0), 0),
        cacheReadTokens: unpriced.reduce((n, t) => n + (t.cacheReadTokens || 0), 0),
        cacheCreationTokens: unpriced.reduce((n, t) => n + (t.cacheCreationTokens || 0), 0),
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {})
      },
      Date.now()
    )
    const coverage = {
      turns,
      unpricedTurns,
      spentIsPartial: unpricedTurns > 0,
      coverage: costCoverage
    }
    const budgetUsd = this.resolveBudget()
    if (budgetUsd === null) {
      return { pricedSpendUsd, budgetUsd: null, ratio: null, alert: false, ...coverage }
    }
    const ratio = budgetUsd > 0 ? pricedSpendUsd / budgetUsd : 0
    return {
      pricedSpendUsd,
      budgetUsd,
      ratio,
      alert: ratio >= ALERT_RATIO_THRESHOLD,
      ...coverage
    }
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

/**
 * Forme MINIMALE exigee d'une ligne relue : ce dont les agregats ont reellement besoin.
 * `model` reste optionnel — les anciennes lignes n'en portent pas, et les rejeter effacerait
 * de l'historique de cout reel.
 */
function isTurnCost(value: unknown): value is TurnCost {
  if (!value || typeof value !== 'object') return false
  const turn = value as Partial<TurnCost>
  return (
    typeof turn.provider === 'string' &&
    turn.provider.length > 0 &&
    (turn.model === undefined || (typeof turn.model === 'string' && turn.model.length > 0)) &&
    typeof turn.inputTokens === 'number' &&
    Number.isFinite(turn.inputTokens) &&
    typeof turn.outputTokens === 'number' &&
    Number.isFinite(turn.outputTokens)
  )
}
