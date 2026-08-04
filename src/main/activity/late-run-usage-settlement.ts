import type { RunLifecycleEvent } from '../../shared/run-execution'
import { sameExecutionUsage, type ExecutionUsageSnapshot } from '../execution-supervisor'

type ClosureLifecycle = Extract<RunLifecycleEvent, { stage: 'closure' }>

/**
 * Réconcilie la clôture publiée par l'orchestrateur avec la vraie fin d'un provider retardataire.
 * Fonction pure pour que tous les points d'entrée appliquent exactement la même déduplication.
 */
export function reconcileLateRunLifecycle(
  lifecycle: ClosureLifecycle | undefined,
  usage: ExecutionUsageSnapshot,
  timestampMs = Date.now()
): ClosureLifecycle | undefined {
  if (!lifecycle || sameExecutionUsage(lifecycle.closure.usage, usage)) return undefined
  return {
    ...lifecycle,
    timestampMs,
    closure: {
      ...lifecycle.closure,
      totalCostUsd: usage.knownCostUsd ?? lifecycle.closure.totalCostUsd,
      usage
    }
  }
}
