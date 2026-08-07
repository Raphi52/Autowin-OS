import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { runWorkflowBench, type WorkflowBenchReport } from './workflow-bench'
import { applyWorkflowProfile } from './workflow-profile-apply'
import { loadWorkflowProfiles } from './workflow-profiles'
import type { OrchestrationResult, WorkflowRunOverride } from './orchestrator'
import type { RoleBinding } from './roles'
import type { WorkflowProfile } from './workflow-profiles'

/**
 * Brancher la confrontation de workflows sur le renderer.
 *
 * Module à part plutôt qu'un bloc de plus dans `index.ts` : le point d'entrée principal fait déjà
 * 3000 lignes et sert de zone de collision entre sessions. Ici la logique est isolée, testable sans
 * lancer Electron, et `index.ts` n'a qu'un appel à porter.
 *
 * Le workflow actif est POSÉ pendant le run puis retiré, comme le devis d'exécution juste à côté :
 * les runs d'une confrontation s'enchaînent en série, donc un seul workflow est actif à la fois.
 * Retirer le workflow dans un `finally` n'est pas de la coquetterie — un run qui échoue laisserait
 * sinon ses réglages contaminer le workflow suivant, et le verdict comparerait deux fois la même
 * chose sans le dire.
 */

export interface WorkflowBenchIpcDeps {
  ipcMain: IpcMain
  assertTrusted: (event: IpcMainInvokeEvent, label: string) => void
  /**
   * Juge de QUALITE de la confrontation. Injecte ici parce que c'est la couche qui possede un
   * provider ; `workflow-bench.ts` reste pur. Absent = le banc ne classe que sur le cout, et le dit.
   */
  judgeQuality?: (prompt: string) => Promise<string>
  runOrchestration: (
    objective: string,
    bindingOverride: RoleBinding | undefined,
    signal: AbortSignal
  ) => Promise<OrchestrationResult>
  /** Pose (ou retire) le workflow actif lu par l'orchestrateur pendant le run. */
  setActiveWorkflow?: (workflow: WorkflowRunOverride | undefined) => void
  loadProfiles?: () => { profiles: WorkflowProfile[]; activeId: string | null }
  /** Rôle dont l'écart est réellement injecté dans le run. */
  benchRole?: string
}

export interface WorkflowBenchIpcRequest {
  objective: string
  /** Ids des workflows à confronter ; `null` désigne la configuration courante. */
  profileIds: (string | null)[]
}

/** Traduit un workflow nommé en ce que l'orchestrateur sait recevoir. */
export function overrideFor(profile: WorkflowProfile | null): WorkflowRunOverride | undefined {
  if (!profile) return undefined
  const effectif = applyWorkflowProfile({ roles: {} }, profile)
  return {
    identity: { name: profile.name, source: 'manuel' },
    ...(effectif.phases?.length ? { phases: effectif.phases } : {}),
    ...(effectif.allocation ? { allocation: effectif.allocation } : {}),
    instructionFor: (phase) => effectif.instructionFor(phase)
  }
}

function bindingFor(profile: WorkflowProfile | null, role: string): RoleBinding | undefined {
  if (!profile) return undefined
  const effectif = applyWorkflowProfile({ roles: {} }, profile)
  return effectif.roles[role as keyof typeof effectif.roles]
}

export function registerWorkflowBenchIpc(deps: WorkflowBenchIpcDeps): void {
  const role = deps.benchRole ?? 'subagent'
  const load = deps.loadProfiles ?? loadWorkflowProfiles

  deps.ipcMain.handle('os:workflowBench:run', async (event, raw: unknown) => {
    deps.assertTrusted(event, 'Workflow bench')
    const request = raw as WorkflowBenchIpcRequest
    const objective = typeof request?.objective === 'string' ? request.objective.trim() : ''
    if (!objective) throw new Error('Objectif manquant : il n’y a rien à confronter.')

    const connus = load().profiles
    // Un id inconnu est signalé, pas silencieusement remplacé par la config courante : sinon deux
    // lignes « Configuration courante » apparaîtraient sans qu'on sache pourquoi.
    const profiles = (request.profileIds ?? []).map((id) => {
      if (id === null || id === '') return null
      const trouve = connus.find((p) => p.id === id)
      if (!trouve) throw new Error(`Workflow inconnu : ${id}`)
      return trouve
    })
    if (profiles.length < 2) {
      throw new Error('Il faut au moins deux workflows pour en comparer un.')
    }

    const controller = new AbortController()
    const sender: WebContents = event.sender
    const onProgress = (done: number, total: number, label: string): void => {
      if (!sender.isDestroyed()) sender.send('os:workflowBench:progress', { done, total, label })
    }

    const report: WorkflowBenchReport = await runWorkflowBench(
      { objective, profiles },
      {
        runOnce: async (obj, profile) => {
          deps.setActiveWorkflow?.(overrideFor(profile))
          try {
            return await deps.runOrchestration(obj, bindingFor(profile, role), controller.signal)
          } finally {
            // Sans ce retrait, un run raté laisserait ses réglages au workflow suivant.
            deps.setActiveWorkflow?.(undefined)
          }
        },
        onProgress,
        judgeQuality: deps.judgeQuality,
        signal: controller.signal
      }
    )

    return report
  })
}
