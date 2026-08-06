import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Usage } from './providers/types'
import type { ExecutionQuote } from './execution-quote'

export type TokenCoverage = 'complete' | 'partial'

export interface ExecutionUsageSnapshot {
  quoteId: string
  /** Nombre d'agents CLI admis. Optionnel pour relire les checkpoints anterieurs a ce compteur. */
  startedAgents?: number
  startedCalls: number
  completedCalls: number
  failedCalls: number
  activeCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  freshTokens: number
  knownCostUsd: number | null
  unpricedCalls: number
  unmeteredCalls: number
  tokenCoverage: TokenCoverage
  stoppedReason?: string
}

type ComparableExecutionUsage = Omit<ExecutionUsageSnapshot, 'quoteId'> & { quoteId?: string }

/** Comparaison explicite pour dedupliquer les publications terminales sans masquer un compteur. */
export function sameExecutionUsage(
  left: ComparableExecutionUsage | undefined,
  right: ComparableExecutionUsage | undefined
): boolean {
  if (!left || !right) return left === right
  return (
    (left.quoteId === undefined || right.quoteId === undefined || left.quoteId === right.quoteId) &&
    left.startedAgents === right.startedAgents &&
    left.startedCalls === right.startedCalls &&
    left.completedCalls === right.completedCalls &&
    left.failedCalls === right.failedCalls &&
    left.activeCalls === right.activeCalls &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.totalTokens === right.totalTokens &&
    left.freshTokens === right.freshTokens &&
    left.knownCostUsd === right.knownCostUsd &&
    left.unpricedCalls === right.unpricedCalls &&
    left.unmeteredCalls === right.unmeteredCalls &&
    left.tokenCoverage === right.tokenCoverage &&
    left.stoppedReason === right.stoppedReason
  )
}

interface ExecutionRuntime {
  executionId: string
  quote: ExecutionQuote
  deadlineAtMs: number
  controller: AbortController
  signal: AbortSignal
  startedAgents: number
  startedCalls: number
  completedCalls: number
  failedCalls: number
  activeCalls: number
  reservedTotalTokens: number
  reservedFreshTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  freshTokens: number
  knownCostUsd: number
  pricedCalls: number
  unpricedCalls: number
  unmeteredCalls: number
  finished: boolean
  onLateSettlement?: (usage: ExecutionUsageSnapshot) => void
  stoppedReason?: string
}

interface ProviderReservation {
  id: string
  signal: AbortSignal
  complete: (usage?: Usage) => void
  fail: (usage?: Usage) => void
  /** Annule tout le run sans prétendre que le provider sous-jacent s'est déjà arrêté. */
  abort: (reason: string) => void
}

export class ExecutionBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionBudgetExceededError'
  }
}

function combinedSignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const available = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (available.length === 0) return new AbortController().signal
  if (available.length === 1) return available[0]
  return AbortSignal.any(available)
}

function snapshot(runtime: ExecutionRuntime): ExecutionUsageSnapshot {
  return {
    quoteId: runtime.quote.id,
    startedAgents: runtime.startedAgents,
    startedCalls: runtime.startedCalls,
    completedCalls: runtime.completedCalls,
    failedCalls: runtime.failedCalls,
    activeCalls: runtime.activeCalls,
    inputTokens: runtime.inputTokens,
    outputTokens: runtime.outputTokens,
    cacheReadTokens: runtime.cacheReadTokens,
    totalTokens: runtime.totalTokens,
    freshTokens: runtime.freshTokens,
    knownCostUsd: runtime.pricedCalls > 0 ? runtime.knownCostUsd : null,
    unpricedCalls: runtime.unpricedCalls,
    unmeteredCalls: runtime.unmeteredCalls,
    tokenCoverage: runtime.unmeteredCalls > 0 ? 'partial' : 'complete',
    ...(runtime.stoppedReason ? { stoppedReason: runtime.stoppedReason } : {})
  }
}

/**
 * Autorite unique d'admission des appels provider d'un run. AsyncLocalStorage garde les compteurs
 * locaux au run, y compris quand plusieurs orchestrations s'entrelacent dans le process principal.
 */
export class ExecutionSupervisor {
  private readonly storage = new AsyncLocalStorage<ExecutionRuntime>()
  private latest?: ExecutionUsageSnapshot
  private latestExecutionId?: string

  currentQuote(): ExecutionQuote | undefined {
    return this.storage.getStore()?.quote
  }

  currentSignal(): AbortSignal | undefined {
    return this.storage.getStore()?.signal
  }

  currentSnapshot(): ExecutionUsageSnapshot | undefined {
    const runtime = this.storage.getStore()
    return runtime ? snapshot(runtime) : undefined
  }

  lastSnapshot(): ExecutionUsageSnapshot | undefined {
    return this.latest ? { ...this.latest } : undefined
  }

  async run<T>(
    quote: ExecutionQuote,
    outerSignal: AbortSignal | undefined,
    execute: () => Promise<T>,
    prior?: ExecutionUsageSnapshot,
    onLateSettlement?: (usage: ExecutionUsageSnapshot) => void
  ): Promise<T> {
    const controller = new AbortController()
    /*
     * L'échéance court depuis le DÉBUT DE CETTE EXÉCUTION, pas depuis la création du devis.
     *
     * Constaté en réel le 2026-08-05 : deux runs repris au démarrage ont échoué INSTANTANÉMENT —
     * « budget duree depasse (7200000 ms) » — sans jouer une seule phase. Le devis étant persisté
     * avec le run, son échéance était calculée depuis sa création d'origine : un run tué à 14 h 10
     * et repris à 17 h avec 2 h de budget était condamné avant de commencer. La durée mesurait le
     * temps écoulé DANS LE MONDE, pas le temps travaillé — donc toute reprise après une longue
     * interruption perdait le travail déjà payé.
     *
     * La sémantique retenue, et elle est cohérente : la DURÉE borne une exécution (elle protège de
     * l'emballement d'un run qui tourne), le COÛT borne le run entier et reste cumulatif à travers
     * les reprises via `prior` (jetons, appels, agents ci-dessous). Une reprise est un acte
     * délibéré de l'utilisateur ; lui rendre son temps de travail ne lui rend pas son budget.
     */
    const deadlineAtMs = Date.now() + quote.limits.maxDurationMs
    const runtime: ExecutionRuntime = {
      executionId: randomUUID(),
      quote,
      deadlineAtMs,
      controller,
      signal: combinedSignal(outerSignal, controller.signal),
      // Les checkpoints antérieurs au compteur agents ne doivent jamais recréer un budget vierge.
      // Dans une orchestration historique, chaque appel payé est une borne haute conservatrice du
      // nombre d'agents déjà admis. Mieux vaut refuser une reprise ambiguë que doubler son fan-out.
      startedAgents: prior ? (prior.startedAgents ?? prior.startedCalls) : 0,
      startedCalls: prior?.startedCalls ?? 0,
      completedCalls: prior?.completedCalls ?? 0,
      failedCalls: prior?.failedCalls ?? 0,
      // Une reprise ne doit jamais effacer un provider encore vivant du checkpoint. Le refus
      // conservateur ci-dessous empeche deux transports de consommer le meme budget en parallele.
      activeCalls: prior?.activeCalls ?? 0,
      reservedTotalTokens: 0,
      reservedFreshTokens: 0,
      inputTokens: prior?.inputTokens ?? 0,
      outputTokens: prior?.outputTokens ?? 0,
      cacheReadTokens: prior?.cacheReadTokens ?? 0,
      totalTokens: prior?.totalTokens ?? 0,
      freshTokens: prior?.freshTokens ?? 0,
      knownCostUsd: prior?.knownCostUsd ?? 0,
      pricedCalls: prior?.knownCostUsd === null || prior?.knownCostUsd === undefined ? 0 : 1,
      unpricedCalls: prior?.unpricedCalls ?? 0,
      unmeteredCalls: prior?.unmeteredCalls ?? 0,
      finished: false,
      onLateSettlement
    }
    if (prior && prior.quoteId !== quote.id) {
      throw new Error('Reprise refusee : le devis ne correspond pas aux compteurs persistants.')
    }
    const publishTerminalSnapshot = (): ExecutionUsageSnapshot => {
      runtime.finished = true
      const terminal = snapshot(runtime)
      this.latestExecutionId = runtime.executionId
      this.latest = terminal
      try {
        runtime.onLateSettlement?.({ ...terminal })
      } catch {
        // L'observation UI/persistance ne doit jamais changer le resultat du run.
      }
      return terminal
    }
    if (prior && prior.activeCalls > 0) {
      runtime.stoppedReason = `Reprise refusee : ${prior.activeCalls} appel(s) provider encore actif(s).`
      controller.abort(runtime.stoppedReason)
      publishTerminalSnapshot()
      throw new ExecutionBudgetExceededError(runtime.stoppedReason)
    }
    const remainingDurationMs = deadlineAtMs - Date.now()
    if (remainingDurationMs <= 0) {
      runtime.stoppedReason = `budget duree depasse (${quote.limits.maxDurationMs} ms)`
      controller.abort(runtime.stoppedReason)
      publishTerminalSnapshot()
      throw new ExecutionBudgetExceededError(runtime.stoppedReason)
    }
    const deadline = setTimeout(() => {
      runtime.stoppedReason = `budget duree depasse (${quote.limits.maxDurationMs} ms)`
      controller.abort(runtime.stoppedReason)
    }, remainingDurationMs)
    deadline.unref?.()
    try {
      return await this.storage.run(runtime, execute)
    } finally {
      clearTimeout(deadline)
      // Publier MEME si le provider s'est regle dans la micro-fenetre entre la cloture
      // orchestrateur et ce finally. Sans cela, la fermeture persistait un faux activeCalls=1.
      publishTerminalSnapshot()
    }
  }

  reserveProviderCall(
    externalSignal?: AbortSignal,
    launchesAgent = false
  ): ProviderReservation | undefined {
    const runtime = this.storage.getStore()
    if (!runtime) return undefined
    runtime.signal.throwIfAborted()
    const limits = runtime.quote.limits
    const deny = (reason: string): never => {
      runtime.stoppedReason = reason
      runtime.controller.abort(reason)
      throw new ExecutionBudgetExceededError(reason)
    }
    if (Date.now() >= runtime.deadlineAtMs) {
      deny(`Budget duree depasse (${limits.maxDurationMs} ms)`)
    }
    if (
      limits.maxUsd !== null &&
      runtime.pricedCalls > 0 &&
      runtime.knownCostUsd >= limits.maxUsd
    ) {
      deny(`Budget USD atteint (${limits.maxUsd} USD)`)
    }
    if (runtime.startedCalls >= limits.maxProviderCalls) {
      deny(`Budget d'appels provider atteint (${limits.maxProviderCalls})`)
    }
    if (launchesAgent && runtime.startedAgents >= limits.maxAgents) {
      deny(`Budget d'agents atteint (${limits.maxAgents})`)
    }
    if (runtime.activeCalls >= limits.maxConcurrency) {
      deny(`Budget de concurrence atteint (${limits.maxConcurrency})`)
    }
    if (runtime.totalTokens >= limits.maxTotalTokens) {
      deny(`Budget tokens total atteint (${limits.maxTotalTokens})`)
    }
    if (runtime.freshTokens >= limits.maxFreshTokens) {
      deny(`Budget tokens frais atteint (${limits.maxFreshTokens})`)
    }
    const remainingCalls = Math.max(1, limits.maxProviderCalls - runtime.startedCalls)
    const totalReservation = Math.ceil(
      Math.max(0, limits.maxTotalTokens - runtime.totalTokens) / remainingCalls
    )
    const freshReservation = Math.ceil(
      Math.max(0, limits.maxFreshTokens - runtime.freshTokens) / remainingCalls
    )
    if (
      runtime.totalTokens + runtime.reservedTotalTokens + totalReservation >
      limits.maxTotalTokens
    ) {
      deny(`Budget tokens total atteint (${limits.maxTotalTokens})`)
    }
    if (
      runtime.freshTokens + runtime.reservedFreshTokens + freshReservation >
      limits.maxFreshTokens
    ) {
      deny(`Budget tokens frais atteint (${limits.maxFreshTokens})`)
    }

    // Les deux compteurs sont reserves dans la meme section synchrone, avant que l'adaptateur ne
    // voie l'appel. Deux fan-outs concurrents ne peuvent donc pas tous deux franchir le plafond.
    if (launchesAgent) runtime.startedAgents += 1
    runtime.startedCalls += 1
    runtime.activeCalls += 1
    runtime.reservedTotalTokens += totalReservation
    runtime.reservedFreshTokens += freshReservation
    let settled = false
    const settle = (usage: Usage | undefined, failed: boolean): void => {
      if (settled) return
      settled = true
      runtime.activeCalls = Math.max(0, runtime.activeCalls - 1)
      runtime.reservedTotalTokens = Math.max(0, runtime.reservedTotalTokens - totalReservation)
      runtime.reservedFreshTokens = Math.max(0, runtime.reservedFreshTokens - freshReservation)
      if (failed) runtime.failedCalls += 1
      else runtime.completedCalls += 1
      if (!usage) {
        runtime.unmeteredCalls += 1
        runtime.unpricedCalls += 1
        runtime.totalTokens += totalReservation
        runtime.freshTokens += freshReservation
      } else {
        const input = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens) : 0
        const output = Number.isFinite(usage.outputTokens) ? Math.max(0, usage.outputTokens) : 0
        const cache = Number.isFinite(usage.cacheReadTokens)
          ? Math.min(input, Math.max(0, usage.cacheReadTokens as number))
          : 0
        runtime.inputTokens += input
        runtime.outputTokens += output
        runtime.cacheReadTokens += cache
        runtime.totalTokens += input + output
        runtime.freshTokens += Math.max(0, input - cache) + output
        if (Number.isFinite(usage.costUsd)) {
          runtime.knownCostUsd += Math.max(0, usage.costUsd as number)
          runtime.pricedCalls += 1
        } else runtime.unpricedCalls += 1
      }
      if (runtime.totalTokens > limits.maxTotalTokens) {
        runtime.stoppedReason = `Budget tokens total depasse (${runtime.totalTokens}/${limits.maxTotalTokens})`
        runtime.controller.abort(runtime.stoppedReason)
      } else if (runtime.freshTokens > limits.maxFreshTokens) {
        runtime.stoppedReason = `Budget tokens frais depasse (${runtime.freshTokens}/${limits.maxFreshTokens})`
        runtime.controller.abort(runtime.stoppedReason)
      } else if (limits.maxUsd !== null && runtime.knownCostUsd > limits.maxUsd) {
        runtime.stoppedReason = `Budget USD depasse (${runtime.knownCostUsd}/${limits.maxUsd})`
        runtime.controller.abort(runtime.stoppedReason)
      }
      // `run()` peut avoir rendu la main sur un watchdog alors que le provider ignore encore
      // l'abort. Quand sa vraie fin arrive, republier ses compteurs sans laisser cet ancien run
      // écraser le snapshot d'un run plus récent.
      if (runtime.finished) {
        const updated = snapshot(runtime)
        if (this.latestExecutionId === runtime.executionId) this.latest = updated
        try {
          runtime.onLateSettlement?.({ ...updated })
        } catch {
          // L'observation UI/persistance ne doit jamais changer le règlement du provider.
        }
      }
    }
    return {
      id: randomUUID(),
      signal: combinedSignal(runtime.signal, externalSignal),
      complete: (usage) => settle(usage, false),
      fail: (usage) => settle(usage, true),
      abort: (reason) => {
        runtime.stoppedReason = reason
        runtime.controller.abort(reason)
      }
    }
  }
}
