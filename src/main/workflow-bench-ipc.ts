import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { runWorkflowBench, type WorkflowBenchReport } from './workflow-bench'
import { applyWorkflowProfile } from './workflow-profile-apply'
import { loadWorkflowProfiles } from './workflow-profiles'
import type { OrchestrationResult } from './orchestrator'
import type { RoleBinding } from './roles'
import type { WorkflowProfile } from './workflow-profiles'

/**
 * Brancher la confrontation de workflows sur le renderer.
 *
 * Module à part plutôt qu'un bloc de plus dans `index.ts` : le point d'entrée principal fait déjà
 * 3000 lignes et sert de zone de collision entre sessions. Ici la logique est isolée, testable sans
 * lancer Electron, et `index.ts` n'a qu'un appel à porter.
 *
 * LIMITE ASSUMÉE, à dire plutôt qu'à masquer : seul l'écart de RÔLE (provider, modèle, effort) est
 * réellement appliqué au run, via le binding figé que l'orchestrateur accepte déjà. Les écarts de
 * phases, d'allocation et de consignes sont calculés et rapportés, mais l'orchestrateur ne sait pas
 * encore les recevoir — les comparer aujourd'hui donnerait un verdict sur une différence qui n'a pas
 * eu lieu.
 */

export interface WorkflowBenchIpcDeps {
  ipcMain: IpcMain
  assertTrusted: (event: IpcMainInvokeEvent, label: string) => void
  runOrchestration: (
    objective: string,
    bindingOverride: RoleBinding | undefined,
    signal: AbortSignal
  ) => Promise<OrchestrationResult>
  loadProfiles?: () => { profiles: WorkflowProfile[]; activeId: string | null }
  /** Rôle dont l'écart est réellement injecté dans le run. */
  benchRole?: string
}

export interface WorkflowBenchIpcRequest {
  objective: string
  /** Ids des workflows à confronter ; `null` désigne la configuration courante. */
  profileIds: (string | null)[]
}

/** Écarts calculés mais non transmis à l'orchestrateur — rapportés pour ne pas surinterpréter. */
export function unappliedDeviations(profile: WorkflowProfile | null): string[] {
  if (!profile) return []
  const restants: string[] = []
  if (profile.phases?.length) restants.push('phases')
  if (profile.allocation) restants.push('allocation')
  if (profile.instructions) restants.push('consignes')
  return restants
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
        runOnce: (obj, profile) =>
          deps.runOrchestration(obj, bindingFor(profile, role), controller.signal),
        onProgress,
        signal: controller.signal
      }
    )

    return {
      ...report,
      // Ce que la comparaison n'a PAS fait varier, par workflow — la réserve voyage avec le verdict.
      unapplied: profiles
        .map((p) => ({ profileId: p?.id ?? '', deviations: unappliedDeviations(p) }))
        .filter((entry) => entry.deviations.length > 0)
    }
  })
}
