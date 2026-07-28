import { WorktreeManager, type FinalizeResult } from './worktree-manager'
import type { WorktreeAgentActivity, WorktreeState } from '../../shared/worktree-activity-model'

/**
 * Coordinateur worktree AU NIVEAU RUN (le "flip live" du volet B).
 *
 * L'orchestrateur appelle `begin(runId, agentName, isMutation)` avant d'exécuter un run et
 * `end(runId)` après. Le coordinateur :
 *  - donne à un run de MUTATION une copie isolée (worktree) → cwd renvoyé par begin ;
 *  - à la fin, fusionne AUTOMATIQUEMENT (full-auto) ou, en cas de conflit, ne fusionne pas et
 *    conserve la copie (garde-fou) ;
 *  - tient à jour la liste d'ACTIVITÉ (WorktreeAgentActivity) consommée par le cockpit UI.
 *
 * Un run NON-mutation (lecture/cadrage) ne prend pas de copie : begin renvoie undefined → l'appelant
 * retombe sur son workspace de base (comportement historique, zéro effet de bord).
 *
 * `nowFn` est injectable (tests) ; défaut = Date.now.
 */
export interface RunWorktreeCoordinatorDeps {
  manager: Pick<
    WorktreeManager,
    | 'acquire'
    | 'finalize'
    | 'changedFiles'
    | 'remove'
    | 'listAgentIds'
    | 'markProcess'
    | 'markSpawnIntent'
    | 'confirmSpawn'
    | 'hasActiveProcesses'
  >
  nowFn?: () => number
  /** Appelé à chaque changement d'activité → l'app pousse vers le renderer (IPC). */
  onActivity?: (activity: WorktreeAgentActivity[]) => void
}

interface Tracked {
  runId: string
  agentName: string
  isMutation: boolean
  startedAtMs: number
  endedAtMs?: number
  state: WorktreeState
  files: { path: string; kind: 'add' | 'mod' | 'del' }[]
  conflictWith?: string[]
  conflictFile?: string
  attentionReason?: WorktreeAgentActivity['attentionReason']
}

function stateFromFinalize(res: FinalizeResult): WorktreeState {
  if (res.outcome === 'conflict') return 'conflict'
  if (res.outcome === 'blocked') return 'blocked'
  return 'merged'
}

export class RunWorktreeCoordinator {
  private readonly manager: RunWorktreeCoordinatorDeps['manager']
  private readonly now: () => number
  private readonly onActivity?: (a: WorktreeAgentActivity[]) => void
  private readonly runs = new Map<string, Tracked>()
  private readonly waitingForProcess = new Set<string>()
  private recoveryTimer?: ReturnType<typeof setTimeout>

  constructor(deps: RunWorktreeCoordinatorDeps) {
    this.manager = deps.manager
    this.now = deps.nowFn ?? Date.now
    this.onActivity = deps.onActivity
    this.reconcileExisting()
  }

  /** Démarre un run. Renvoie le cwd isolé (mutation) ou undefined (non-mutation → base). */
  begin(runId: string, agentName: string, isMutation: boolean): string | undefined {
    const tracked: Tracked = {
      runId,
      agentName,
      isMutation,
      startedAtMs: this.now(),
      state: isMutation ? 'isolated' : 'working',
      files: []
    }
    this.runs.set(runId, tracked)
    let cwd: string | undefined
    if (isMutation) {
      cwd = this.manager.acquire(runId)
      tracked.state = 'working'
    }
    this.emit()
    return cwd
  }

  /** Termine un run : fusionne (full-auto) ou bascule conflit. No-op si run inconnu/non-mutation. */
  end(runId: string): FinalizeResult | undefined {
    const tracked = this.runs.get(runId)
    if (!tracked) return undefined
    if (!tracked.isMutation) {
      tracked.endedAtMs = this.now()
      tracked.state = 'merged'
      this.emit()
      return undefined
    }
    if (this.manager.hasActiveProcesses(runId)) {
      tracked.state = 'working'
      this.waitingForProcess.add(runId)
      this.emit()
      this.scheduleRecoveryRetry()
      return undefined
    }
    tracked.endedAtMs = this.now()
    tracked.files = this.changedFiles(runId)
    const res = this.manager.finalize(runId)
    this.applyFinalize(tracked, res)
    this.emit()
    return res
  }

  /** Lie la durée de vie réelle du CLI au worktree, y compris entre deux processus Autowin. */
  process(runId: string, pid: number, active: boolean): void {
    this.manager.markProcess(runId, pid, active)
  }

  spawnIntent(runId: string, token: string, active: boolean): void {
    this.manager.markSpawnIntent(runId, token, active)
  }

  spawned(runId: string, token: string, pid: number): void {
    this.manager.confirmSpawn(runId, token, pid)
  }

  /** Rejouable par le timer et les tests : reprend uniquement les copies dont le CLI est terminé. */
  retryRecovery(): void {
    for (const runId of [...this.waitingForProcess]) {
      if (this.manager.hasActiveProcesses(runId)) continue
      this.waitingForProcess.delete(runId)
      this.finalizeRecovered(runId)
    }
    this.emit()
    this.scheduleRecoveryRetry()
  }

  /** Activité courante, prête pour le modèle du cockpit UI. */
  activity(): WorktreeAgentActivity[] {
    return [...this.runs.values()].map((t) => ({
      agentId: t.runId,
      agentName: t.agentName,
      state: t.state,
      files: t.files,
      startedAtMs: t.startedAtMs,
      endedAtMs: t.endedAtMs,
      conflictWith: t.conflictWith,
      conflictFile: t.conflictFile,
      attentionReason: t.attentionReason
    }))
  }

  private emit(): void {
    this.onActivity?.(this.activity())
  }

  private changedFiles(runId: string): Tracked['files'] {
    try {
      return this.manager.changedFiles(runId).map((path) => ({ path, kind: 'mod' as const }))
    } catch {
      return []
    }
  }

  private applyFinalize(tracked: Tracked, res: FinalizeResult): void {
    tracked.state = stateFromFinalize(res)
    if (res.outcome === 'conflict') {
      tracked.conflictFile = res.files[0]
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
    }
    if (res.outcome === 'blocked') {
      tracked.attentionReason = res.reason
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
    }
  }

  /**
   * Au redémarrage, le worktree Git est la source durable : on reprend chaque copie agent.
   * Une copie intégrable est fusionnée/nettoyée ; un conflit reste intact et redevient visible.
   */
  private reconcileExisting(): void {
    for (const runId of this.manager.listAgentIds()) {
      if (this.manager.hasActiveProcesses(runId)) {
        const timestamp = this.now()
        this.runs.set(runId, {
          runId,
          agentName: 'Agent récupéré',
          isMutation: true,
          startedAtMs: timestamp,
          state: 'working',
          files: this.changedFiles(runId)
        })
        this.waitingForProcess.add(runId)
      } else {
        this.finalizeRecovered(runId)
      }
    }
    this.emit()
    this.scheduleRecoveryRetry()
  }

  private finalizeRecovered(runId: string): void {
    const timestamp = this.now()
    const tracked: Tracked = {
      runId,
      agentName: 'Agent récupéré',
      isMutation: true,
      startedAtMs: timestamp,
      endedAtMs: timestamp,
      state: 'working',
      files: this.changedFiles(runId)
    }
    this.runs.set(runId, tracked)
    try {
      this.applyFinalize(tracked, this.manager.finalize(runId))
    } catch {
      tracked.state = 'blocked'
      tracked.attentionReason = 'merge-failed'
    }
  }

  private scheduleRecoveryRetry(): void {
    if (this.waitingForProcess.size === 0 || this.recoveryTimer) return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      this.retryRecovery()
    }, 5_000)
    this.recoveryTimer.unref?.()
  }
}
