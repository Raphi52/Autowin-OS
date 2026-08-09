import { createHash, randomUUID } from 'node:crypto'
import { classifyRegime, regimePhases, type TaskRegime } from './task-regime'
import type { PipelinePhase } from './skill-pipeline'

export type DecompositionPolicy =
  { mode: 'disabled'; maxNodes: 1 } | { mode: 'build-only'; maxNodes: number }

export interface ExecutionLimits {
  maxProviderCalls: number
  maxFreshTokens: number
  maxTotalTokens: number
  maxAgents: number
  maxConcurrency: number
  maxDurationMs: number
  maxRecoveries: number
  maxUsd: number | null
}

export interface ExecutionQuote {
  schema: 'autowin.execution-quote/v1'
  id: string
  createdAt: string
  taskFingerprint: string
  regime: TaskRegime
  phases: ReturnType<typeof regimePhases>
  decomposition: DecompositionPolicy
  limits: ExecutionLimits
  /** Allocation ex-ante de la topologie, finalisée avant le premier appel provider. */
  allocation?: ExecutionTopologyAllocation
}

export interface ExecutionTopologyAllocation {
  phaseMembers: Partial<Record<PipelinePhase, number>>
  judgeMembers: number
  maxGreedyNodes: number
  reservedMandatoryAgents: number
  estimatedMaxAgents: number
  estimatedMaxCalls: number
}

export interface ExecutionTopologyRequest {
  phases: PipelinePhase[]
  completedPhases: PipelinePhase[]
  startedAgents: number
  startedCalls: number
  mutation: boolean
  hasDecomposer: boolean
  phaseFanOut: Partial<Record<PipelinePhase, number>>
  judgeFanOut: number
  /**
   * Exécutions de nœuds à provisionner quand le workflow est un GRAPHE : un nœud dans une boucle bornée tourne
   * plusieurs fois, et `phases.length` sous-provisionne alors le devis. Absent = pipeline linéaire, on compte
   * les phases comme avant.
   *
   * Ce nombre est exact, pas prudentiel : toute arête de retour porte une borne, donc le pire cas est fini et
   * calculable (`workflow-graph.ts:worstCaseNodeExecutions`). C'est ce qui permet de garder un devis ex-ante
   * avec des boucles au lieu de renoncer à la garantie de clôture.
   */
  worstCaseNodeExecutions?: number
  /**
   * Appels provider exacts du graphe après expansion des panels, synthèses et reprises. Quand il
   * est fourni, ce total est déjà complet : l'allocateur ne doit ni lui ajouter un juge fantôme,
   * ni recompter seulement le fan-out de la première visite d'un nœud rejoué.
   */
  worstCaseProviderCalls?: number
}

export interface ExecutionQuoteCaps {
  maxProviderCalls?: number | null
  maxTotalTokens?: number | null
  maxUsd?: number | null
}

interface RegimePreset {
  maxProviderCalls: number
  maxFreshTokens: number
  maxTotalTokens: number
  maxAgents: number
  maxConcurrency: number
  maxDurationMs: number
  maxRecoveries: number
  decomposition: DecompositionPolicy
}

const PRESETS: Record<TaskRegime, RegimePreset> = {
  trivial: {
    maxProviderCalls: 4,
    maxFreshTokens: 250_000,
    maxTotalTokens: 2_000_000,
    maxAgents: 2,
    maxConcurrency: 1,
    maxDurationMs: 15 * 60_000,
    maxRecoveries: 0,
    decomposition: { mode: 'disabled', maxNodes: 1 }
  },
  standard: {
    maxProviderCalls: 12,
    maxFreshTokens: 750_000,
    maxTotalTokens: 6_000_000,
    // frame + build + juge, puis la reparation et le re-jugement promis par maxRecoveries=1.
    maxAgents: 5,
    maxConcurrency: 3,
    maxDurationMs: 45 * 60_000,
    maxRecoveries: 1,
    decomposition: { mode: 'disabled', maxNodes: 1 }
  },
  critical: {
    maxProviderCalls: 24,
    maxFreshTokens: 2_000_000,
    maxTotalTokens: 15_000_000,
    maxAgents: 10,
    maxConcurrency: 4,
    maxDurationMs: 120 * 60_000,
    maxRecoveries: 1,
    decomposition: { mode: 'build-only', maxNodes: 5 }
  }
}

function positiveInteger(value: number | null | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : undefined
}

function stricter(defaultValue: number, proposed: number | null | undefined): number {
  const cap = positiveInteger(proposed)
  return cap === undefined ? defaultValue : Math.min(defaultValue, cap)
}

function boundedCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0
}

/**
 * Réserve d'abord le chemin qui doit encore pouvoir se fermer : phases mono-modèle, juge, puis
 * réparation + re-jugement promis. Le DAG et les panels ne reçoivent que la capacité restante.
 * Une configuration impossible est refusée ici, avant que le premier provider ne soit touché.
 */
export function allocateExecutionTopology(
  quote: ExecutionQuote,
  request: ExecutionTopologyRequest
): ExecutionTopologyAllocation {
  const completed = new Set(request.completedPhases)
  const remainingPhases = request.phases.filter((phase) => !completed.has(phase))
  const startedAgents = Math.max(0, Math.floor(request.startedAgents))
  const startedCalls = Math.max(0, Math.floor(request.startedCalls))
  const available = Math.min(
    Math.max(0, quote.limits.maxAgents - startedAgents),
    Math.max(0, quote.limits.maxProviderCalls - startedCalls)
  )
  const recoveries = request.mutation ? quote.limits.maxRecoveries : 0
  const judgePasses = 1 + recoveries
  // Un graphe à boucles rejoue des nœuds : provisionner sa liste de phases reviendrait à laisser le run se faire
  // couper en plein milieu au lieu d'être refusé proprement avant de dépenser quoi que ce soit.
  const nodeExecutions = Math.max(
    remainingPhases.length,
    Math.floor(request.worstCaseNodeExecutions ?? 0)
  )
  // Dans un graphe, chaque visite de nœud est déjà un appel complet : les retours incluent donc les
  // builds de réparation et les nouveaux juges. Les rajouter une seconde fois créait un juge
  // fantôme dans le devis. Le pipeline plat conserve son calcul historique explicite.
  const exactWorkflowCalls = positiveInteger(request.worstCaseProviderCalls)
  const mandatory =
    exactWorkflowCalls ??
    (request.worstCaseNodeExecutions === undefined
      ? nodeExecutions + judgePasses + recoveries
      : nodeExecutions)
  if (mandatory > available) {
    throw new Error(
      `Devis impossible avant exécution : ${mandatory} agent(s) obligatoires pour ${available} place(s) restante(s).`
    )
  }

  if (exactWorkflowCalls !== undefined) {
    const phaseMembers: Partial<Record<PipelinePhase, number>> = {}
    for (const phase of remainingPhases) {
      const configured = boundedCount(request.phaseFanOut[phase])
      if (configured > 0) phaseMembers[phase] = Math.min(configured, quote.limits.maxConcurrency)
    }
    const configuredJudges = boundedCount(request.judgeFanOut)
    const judgeMembers =
      configuredJudges > 0 ? Math.min(configuredJudges, quote.limits.maxConcurrency) : 1
    return {
      phaseMembers,
      judgeMembers,
      // Le graphe décrit déjà ses nœuds parallèles. Lui superposer un DAG dynamique rendrait le
      // nombre d'appels impossible à déduire du canevas qui vient d'être accepté.
      maxGreedyNodes: 1,
      reservedMandatoryAgents: mandatory,
      estimatedMaxAgents: startedAgents + mandatory,
      estimatedMaxCalls: startedCalls + mandatory
    }
  }

  let optional = available - mandatory
  let maxGreedyNodes = 1
  const canDecompose =
    request.hasDecomposer &&
    quote.decomposition.mode === 'build-only' &&
    remainingPhases.includes('build')
  // Activer un DAG de deux nœuds coûte deux places au-delà du pipeline mono : le décomposeur
  // lui-même, puis le second worker. En dessous, ne pas payer un plan que l'on jetterait.
  if (canDecompose && optional >= 2) {
    maxGreedyNodes = Math.min(quote.decomposition.maxNodes, optional)
    optional -= maxGreedyNodes
  }

  const phaseMembers: Partial<Record<PipelinePhase, number>> = {}
  for (const phase of remainingPhases) {
    const configured = boundedCount(request.phaseFanOut[phase])
    if (configured === 0) continue
    // Un build déjà découpé ne cumule jamais DAG × panel : cette multiplication rendrait le devis
    // non bornable sans sacrifier la clôture.
    if (phase === 'build' && maxGreedyNodes >= 2) {
      phaseMembers[phase] = 1
      continue
    }
    if (configured >= 2 && optional >= 2) {
      const admitted = Math.min(configured, optional, quote.limits.maxConcurrency)
      phaseMembers[phase] = admitted
      // N membres + une synthèse remplacent un worker mono : surcoût net = N.
      optional -= admitted
    } else {
      phaseMembers[phase] = 1
    }
  }

  const configuredJudges = boundedCount(request.judgeFanOut)
  let judgeMembers = 1
  if (configuredJudges >= 2) {
    const maxByCapacity = 1 + Math.floor(optional / judgePasses)
    judgeMembers = Math.min(configuredJudges, maxByCapacity, quote.limits.maxConcurrency)
    if (judgeMembers >= 2) optional -= (judgeMembers - 1) * judgePasses
    else judgeMembers = 1
  }

  const used = available - optional
  return {
    phaseMembers,
    judgeMembers,
    maxGreedyNodes,
    reservedMandatoryAgents: mandatory,
    estimatedMaxAgents: startedAgents + used,
    estimatedMaxCalls: startedCalls + used
  }
}

/**
 * Compile le devis avant tout appel provider. Le modele ne choisit jamais ses propres caps : ils
 * viennent du regime deterministe et d'eventuels plafonds utilisateur qui ne peuvent que resserrer.
 */
export function compileExecutionQuote(task: string, caps: ExecutionQuoteCaps = {}): ExecutionQuote {
  const regime = classifyRegime(task)
  const preset = PRESETS[regime]
  const taskFingerprint = createHash('sha256').update(task.trim()).digest('hex').slice(0, 16)
  return {
    schema: 'autowin.execution-quote/v1',
    id: `quote-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    taskFingerprint,
    regime,
    phases: regimePhases(task),
    decomposition: { ...preset.decomposition },
    limits: {
      maxProviderCalls: stricter(preset.maxProviderCalls, caps.maxProviderCalls),
      maxFreshTokens: preset.maxFreshTokens,
      maxTotalTokens: stricter(preset.maxTotalTokens, caps.maxTotalTokens),
      maxAgents: preset.maxAgents,
      maxConcurrency: preset.maxConcurrency,
      maxDurationMs: preset.maxDurationMs,
      maxRecoveries: preset.maxRecoveries,
      maxUsd: positiveNumber(caps.maxUsd) ?? null
    }
  }
}
