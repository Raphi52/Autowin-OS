import { applyWorkflowProfile } from './workflow-profile-apply'
import { graphOf } from './workflow-profiles'
import type { WorkflowRunOverride } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'

/**
 * Traduire un workflow nommé en contrat de run.
 *
 * Vivait dans `workflow-bench-ipc.ts` tant que la confrontation existait ; elle a été retirée, mais
 * cette traduction sert AUSSI l'activation normale d'un workflow depuis la vue. Déplacée telle
 * quelle, sans changement de comportement.
 */
export function overrideFor(profile: WorkflowProfile | null): WorkflowRunOverride | undefined {
  if (!profile) return undefined
  const effectif = applyWorkflowProfile({ roles: {} }, profile)
  const graph = graphOf(profile)
  return {
    identity: { name: profile.name, source: 'manuel' },
    ...(graph ? { graph } : {}),
    ...(effectif.phases?.length ? { phases: effectif.phases } : {}),
    ...(effectif.allocation ? { allocation: effectif.allocation } : {}),
    instructionFor: (phase) => effectif.instructionFor(phase)
  }
}
