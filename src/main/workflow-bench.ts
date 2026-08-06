import { compareWorkflowRuns, type WorkflowComparison, type WorkflowRunOutcome } from './workflow-comparison'
import type { OrchestrationResult } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'
import {
  classer,
  lireVerdict,
  promptComparaison,
  type ClassementQualite,
  type Livrable
} from './workflow-bench-quality'

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
  /**
   * Juge de QUALITE : recoit un prompt de comparaison AVEUGLE et rend le verdict brut.
   *
   * Injecte comme `runOnce` : ce module ne sait ni orchestrer ni appeler un modele. Absent =
   * le banc classe comme avant (cout, duree) et le DIT — il ne pretend pas avoir juge la valeur.
   */
  judgeQuality?: (prompt: string) => Promise<string>
  /** Progression, pour que l'attente ne soit pas aveugle. */
  onProgress?: (done: number, total: number, label: string) => void
  signal?: AbortSignal
  now?: () => number
}

export interface WorkflowBenchReport extends WorkflowComparison {
  objective: string
  /**
   * Le verdict de QUALITE, absent si aucun juge n'a pu se prononcer.
   *
   * Son absence est une information : elle dit que le classement rendu ne repose que sur le cout
   * et la duree — ce que le banc faisait en croyant departager la valeur.
   */
  qualite?: ClassementQualite
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
  // Les LIVRABLES, gardes a part : `WorkflowRunOutcome` ne porte que des compteurs, et c'est
  // precisement pourquoi le banc ne jugeait que le prix.
  const livrables: Livrable[] = []
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
      livrables.push({
        profileId: profile?.id ?? null,
        profileName: label,
        texte: result.result ?? '',
        costUsd: result.costUsd ?? 0
      })
    } catch {
      outcomes.push(crashedOutcome(profile, now() - start))
    }
  }
  deps.onProgress?.(total - skipped.length, total, 'terminé')

  // LA QUALITE DECIDE, quand on peut la juger. Le classement par cout reste rendu — il dit ce que
  // la qualite a coute — mais il ne tient plus lieu de verdict.
  let qualite: ClassementQualite | undefined
  if (deps.judgeQuality && livrables.length >= 2) {
    try {
      const brut = await deps.judgeQuality(promptComparaison(request.objective, livrables))
      qualite = classer(livrables, lireVerdict(brut, livrables.length))
    } catch {
      // Un juge injoignable ne fait pas echouer la confrontation : on rend le classement par cout
      // en disant qu'aucune qualite n'a ete jugee, plutot que d'inventer un gagnant.
      qualite = undefined
    }
  }

  return {
    objective: request.objective,
    skipped,
    ...compareWorkflowRuns(outcomes),
    ...(qualite ? { qualite } : {})
  }
}
