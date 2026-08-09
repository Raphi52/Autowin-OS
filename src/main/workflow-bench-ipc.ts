import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { runWorkflowBench, type WorkflowBenchReport } from './workflow-bench'
import { applyWorkflowProfile } from './workflow-profile-apply'
import { loadWorkflowProfiles } from './workflow-profiles'
import type { OrchestrationResult, WorkflowRunOverride } from './orchestrator'
import type { Role, RoleBinding } from './roles'
import type { WorkflowProfile } from './workflow-profiles'
import type { CounterfactualCheckpointState } from './workflow-counterfactual'
import type { PersistedCheckpoint, SourceSnapshot } from './wire-checkpoint-fork'

/**
 * Brancher la confrontation de workflows sur le renderer.
 *
 * Module à part plutôt qu'un bloc de plus dans `index.ts` : le point d'entrée principal fait déjà
 * 3000 lignes et sert de zone de collision entre sessions. Ici la logique est isolée, testable sans
 * lancer Electron, et `index.ts` n'a qu'un appel à porter.
 *
 * Chaque workflow est transmis dans le contrat du run. Aucun état global n'est posé : un chat
 * concurrent ne peut donc ni voler le profil du banc, ni être contaminé par lui.
 */

export interface WorkflowBenchIpcDeps {
  ipcMain: IpcMain
  assertTrusted: (event: IpcMainInvokeEvent, label: string) => void
  /**
   * Juge de QUALITE de la confrontation. Injecte ici parce que c'est la couche qui possede un
   * provider ; `workflow-bench.ts` reste pur. Absent = le banc ne classe que sur le cout, et le dit.
   */
  judgeQuality?: (prompt: string) => Promise<string>
  /** Garde catalogue exécutée avant le premier appel provider du profil. */
  assertBindingAvailable: (binding: RoleBinding) => void
  /** Base runtime nécessaire pour résoudre les écarts partiels du profil. */
  currentRoles: () => Partial<Record<Role, RoleBinding>>
  /** Snapshot Git reel capture avant le premier bras contrefactuel. */
  captureCheckpoint?: (
    objective: string
  ) => Promise<PersistedCheckpoint<CounterfactualCheckpointState>>
  runOrchestration: (
    objective: string,
    bindingOverride: RoleBinding | undefined,
    signal: AbortSignal,
    workflowOverride: WorkflowRunOverride | undefined,
    publication: 'auto' | 'hold',
    sourceSnapshot?: SourceSnapshot
  ) => Promise<OrchestrationResult>
  captureWorkspaceState?: (workspace: {
    path: string
    files: readonly string[]
  }) => Promise<Record<string, string | null>>
  loadProfiles?: () => { profiles: WorkflowProfile[]; activeId: string | null }
  /** Rôle dont l'écart est réellement injecté dans le run. */
  benchRole?: Role
}

export interface WorkflowBenchIpcRequest {
  objective: string
  /** Ids des workflows à confronter ; `null` désigne la configuration courante. */
  profileIds: (string | null)[]
  mode?: 'comparison' | 'tournament' | 'counterfactual'
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

function bindingFor(
  profile: WorkflowProfile | null,
  role: Role,
  base: Partial<Record<Role, RoleBinding>>
): RoleBinding | undefined {
  if (!profile?.roles?.[role]) return undefined
  const effectif = applyWorkflowProfile({ roles: base }, profile)
  const binding = effectif.roles[role]
  if (!binding) throw new Error(`Binding workflow incomplet pour le rôle ${role}.`)
  return binding
}

export function registerWorkflowBenchIpc(deps: WorkflowBenchIpcDeps): void {
  const role = deps.benchRole ?? 'subagent'
  const load = deps.loadProfiles ?? loadWorkflowProfiles
  const activeBySender = new WeakMap<WebContents, AbortController>()

  deps.ipcMain.handle('os:workflowBench:cancel', async (event) => {
    deps.assertTrusted(event, 'Workflow bench cancel')
    const controller = activeBySender.get(event.sender)
    if (!controller) return false
    controller.abort()
    return true
  })

  deps.ipcMain.handle('os:workflowBench:run', async (event, raw: unknown) => {
    deps.assertTrusted(event, 'Workflow bench')
    const request = raw as WorkflowBenchIpcRequest
    const mode =
      request?.mode === 'tournament'
        ? 'tournament'
        : request?.mode === 'counterfactual'
          ? 'counterfactual'
          : 'comparison'
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
    if (mode === 'tournament' && profiles.length !== 3) {
      throw new Error('Un tournoi exige exactement trois workflows.')
    }
    if (mode === 'comparison' && profiles.length < 2) {
      throw new Error('Il faut au moins deux workflows pour en comparer un.')
    }
    if (mode === 'counterfactual' && profiles.length !== 2) {
      throw new Error('Un contrefactuel exige exactement deux workflows.')
    }
    if (mode === 'counterfactual' && !deps.captureCheckpoint) {
      throw new Error('La capture du checkpoint contrefactuel est indisponible.')
    }
    const controller = new AbortController()
    const sender: WebContents = event.sender
    if (activeBySender.has(sender)) throw new Error('Une confrontation est déjà en cours.')
    activeBySender.set(sender, controller)
    const onProgress = (done: number, total: number, label: string): void => {
      if (!sender.isDestroyed()) sender.send('os:workflowBench:progress', { done, total, label })
    }
    try {
      const checkpoint =
        mode === 'counterfactual' ? await deps.captureCheckpoint!(objective) : undefined
      const report: WorkflowBenchReport = await runWorkflowBench(
        { objective, profiles, mode, ...(checkpoint ? { checkpoint } : {}) },
        {
          runOnce: async (obj, profile) => {
            const binding = bindingFor(profile, role, deps.currentRoles())
            if (binding) deps.assertBindingAvailable(binding)
            return deps.runOrchestration(
              obj,
              binding,
              controller.signal,
              overrideFor(profile),
              mode === 'tournament' || mode === 'counterfactual' ? 'hold' : 'auto',
              checkpoint?.sourceSnapshot
            )
          },
          ...(deps.captureWorkspaceState
            ? { captureWorkspaceState: deps.captureWorkspaceState }
            : {}),
          onProgress,
          judgeQuality: deps.judgeQuality,
          signal: controller.signal
        }
      )
      return report
    } finally {
      if (activeBySender.get(sender) === controller) activeBySender.delete(sender)
    }
  })
}
