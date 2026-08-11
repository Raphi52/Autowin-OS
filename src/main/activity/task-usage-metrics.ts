import type { ExecutionUsageSnapshot } from '../execution-supervisor'

export interface TaskUsageMetrics {
  knownCostUsd?: number
  totalTokens?: number
  unpricedCalls?: number
}

/**
 * Adapte le snapshot du superviseur au contrat persiste par les occurrences planifiees.
 * `null` signifie « cout inconnu » : ne jamais le convertir en zero, qui masquerait la depense.
 */
export function taskUsageMetricsFromExecution(
  usage: ExecutionUsageSnapshot | undefined
): TaskUsageMetrics {
  if (!usage) return {}
  return {
    ...(usage.knownCostUsd === null ? {} : { knownCostUsd: usage.knownCostUsd }),
    totalTokens: usage.totalTokens,
    unpricedCalls: usage.unpricedCalls
  }
}
