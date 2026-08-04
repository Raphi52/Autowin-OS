import { compareWorkflowRuns, type WorkflowComparison, type WorkflowRunOutcome } from './workflow-comparison'
import type { OrchestrationResult } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'

/**
 * Lancer le MÊME objectif sous plusieurs workflows, puis les comparer.
 *
 * Deux partis pris qui ne sont pas des détails d'implémentation :
 *
 *  - les runs s'enchaînent en SÉRIE. Deux workflows lancés en parallèle travailleraient sur le même
 *    dépôt et se marcheraient dessus : on ne comparerait plus deux façons de faire mais deux façons
 *    de se gêner. Le temps gagné coûterait la validité de la mesure.
 *  - un run qui CRASHE reste une ligne du tableau (non verte). L'omettre ferait disparaître du
 *    classement le workflow le plus fragile — exactement celui qu'on cherche à repérer.
 */

export interface WorkflowBenchRequest {
  objective: string
  /** Les workflows à confronter. `null` = la configuration courante, éligible comme les autres. */
  profiles: readonly (WorkflowProfile | null)[]
}

export interface WorkflowBenchDeps {
  /** Exécute l'objectif sous un workflow donné. Injecté : ce module ne sait pas orchestrer. */
  runOnce: (objective: string, profile: WorkflowProfile | null) => Promise<OrchestrationResult>
  /** Progression, pour que l'attente ne soit pas aveugle. */
  onProgress?: (done: number, total: number, label: string) => void
  signal?: AbortSignal
  now?: () => number
}

export interface WorkflowBenchReport extends WorkflowComparison {
  objective: string
  /** Workflows non lancés parce que l'utilisateur a interrompu — dit, jamais tu. */
  skipped: string[]
}

const CURRENT = { id: '', name: 'Configuration courante' }

function outcomeOf(
  profile: WorkflowProfile | null,
  result: OrchestrationResult,
  durationMs: number
): WorkflowRunOutcome {
  const usage = result.usage
  return {
    profileId: profile?.id ?? CURRENT.id,
    profileName: profile?.name ?? CURRENT.name,
    // Un run bloqué par le gate n'est pas un résultat, quoi qu'il ait écrit.
    green: result.valid && !result.gateBlocked,
    costUsd: usage?.knownCostUsd ?? result.costUsd ?? null,
    totalTokens: usage?.totalTokens,
    unpricedCalls: usage?.unpricedCalls,
    durationMs
  }
}

function crashedOutcome(profile: WorkflowProfile | null, durationMs: number): WorkflowRunOutcome {
  return {
    profileId: profile?.id ?? CURRENT.id,
    profileName: profile?.name ?? CURRENT.name,
    green: false,
    // Un crash n'a pas de coût mesuré : le déclarer nul le ferait passer pour économe.
    costUsd: null,
    durationMs
  }
}

export async function runWorkflowBench(
  request: WorkflowBenchRequest,
  deps: WorkflowBenchDeps
): Promise<WorkflowBenchReport> {
  const now = deps.now ?? (() => Date.now())
  const outcomes: WorkflowRunOutcome[] = []
  const skipped: string[] = []
  const total = request.profiles.length

  for (const [index, profile] of request.profiles.entries()) {
    const label = profile?.name ?? CURRENT.name
    if (deps.signal?.aborted) {
      skipped.push(label)
      continue
    }
    deps.onProgress?.(index, total, label)
    const start = now()
    try {
      const result = await deps.runOnce(request.objective, profile)
      outcomes.push(outcomeOf(profile, result, now() - start))
    } catch {
      outcomes.push(crashedOutcome(profile, now() - start))
    }
  }
  deps.onProgress?.(total - skipped.length, total, 'terminé')

  return { objective: request.objective, skipped, ...compareWorkflowRuns(outcomes) }
}
