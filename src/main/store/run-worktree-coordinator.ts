import { WorktreeManager, type FinalizeResult } from './worktree-manager'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeState
} from '../../shared/worktree-activity-model'
import {
  WorktreeRunStateStore,
  type WorktreePublicationState,
  type WorktreeRunRecord,
  type WorktreeRunVerdict
} from './worktree-run-state'

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
    | 'describe'
    | 'validateRecoveryContext'
  > &
    Partial<Pick<WorktreeManager, 'reconcileResidues' | 'cleanupPublished' | 'readConflictDiff'>>
  stateStore?: WorktreeRunStateStore
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
  conflictBaseSha?: string
  conflictAgentSha?: string
  publishedSha?: string
  attentionReason?: WorktreeAgentActivity['attentionReason']
  task?: string
  role?: string
  conversationId?: string
  workspacePath?: string
  worktreePath?: string
  worktreeAvailable?: boolean
  baseBranch?: string
  baseSha?: string
  verdict?: WorktreeRunVerdict
  publication?: WorktreePublicationState
  recovered?: boolean
  detail?: string
}

function stateFromFinalize(res: FinalizeResult): WorktreeState {
  if (res.outcome === 'conflict') return 'conflict'
  if (res.outcome === 'blocked') return 'blocked'
  if (res.outcome === 'cleanup-pending' || res.outcome === 'published-residue') return 'ready'
  return 'merged'
}

const MAX_AUTOMATIC_RETRIES = 6

export class RunWorktreeCoordinator {
  private readonly manager: RunWorktreeCoordinatorDeps['manager']
  private readonly now: () => number
  private readonly onActivity?: (a: WorktreeAgentActivity[]) => void
  private readonly stateStore?: WorktreeRunStateStore
  private readonly runs = new Map<string, Tracked>()
  private readonly waitingForProcess = new Set<string>()
  private readonly waitingForRetry = new Set<string>()
  private readonly retryCounts = new Map<string, number>()
  private recoveryTimer?: ReturnType<typeof setTimeout>

  constructor(deps: RunWorktreeCoordinatorDeps) {
    this.manager = deps.manager
    this.now = deps.nowFn ?? Date.now
    this.onActivity = deps.onActivity
    this.stateStore = deps.stateStore
    this.reconcileExisting()
  }

  /** Démarre un run. Renvoie le cwd isolé (mutation) ou undefined (non-mutation → base). */
  begin(
    runId: string,
    agentName: string,
    isMutation: boolean,
    metadata: { task?: string; role?: string; conversationId?: string } = {}
  ): string | undefined {
    const tracked: Tracked = {
      runId,
      agentName,
      isMutation,
      startedAtMs: this.now(),
      state: isMutation ? 'isolated' : 'working',
      files: [],
      ...metadata
    }
    this.runs.set(runId, tracked)
    let cwd: string | undefined
    if (isMutation) {
      const context = this.manager.describe(runId)
      Object.assign(tracked, context)
      this.persist(tracked, 'running', 'not-requested')
      try {
        cwd = this.manager.acquire(runId, context)
        tracked.worktreePath = cwd
        tracked.worktreeAvailable = true
        tracked.state = 'working'
        this.persist(tracked, 'running', 'not-requested')
      } catch (error) {
        tracked.state = 'blocked'
        tracked.endedAtMs = this.now()
        tracked.attentionReason = 'merge-failed'
        this.persist(
          tracked,
          'interrupted',
          'blocked',
          error instanceof Error ? error.message : String(error)
        )
        this.emit()
        throw error
      }
    }
    this.emit()
    return cwd
  }

  /** Termine un run : fusionne (full-auto) ou bascule conflit. No-op si run inconnu/non-mutation. */
  /**
   * Clôt un run. `merge: false` ⇒ le travail n'est PAS fusionné dans la base et la copie isolée est
   * CONSERVÉE : c'est le cas d'un run non vert (jugé rouge, annulé, planté). Avant, `end()` fusionnait
   * dans tous les cas (appelé depuis un `finally`), donc un run RATÉ atterrissait quand même dans la
   * base. Défaut `true` = comportement historique (rétrocompat des appelants existants).
   */
  end(runId: string, options: { merge?: boolean } = {}): FinalizeResult | undefined {
    const tracked = this.runs.get(runId)
    if (!tracked) return undefined
    if (options.merge === false) {
      tracked.endedAtMs = this.now()
      // 'ready' = travail terminé, isolé, en attente d'une décision humaine (ni fusionné, ni perdu).
      tracked.state = tracked.isMutation ? 'ready' : 'merged'
      if (tracked.isMutation) this.persist(tracked, 'red', 'not-requested')
      this.emit()
      return undefined
    }
    if (!tracked.isMutation) {
      tracked.endedAtMs = this.now()
      tracked.state = 'merged'
      this.emit()
      return undefined
    }
    this.persist(tracked, 'green', 'pending')
    if (this.manager.hasActiveProcesses(runId)) {
      tracked.state = 'working'
      this.waitingForProcess.add(runId)
      this.emit()
      this.scheduleRecoveryRetry()
      return undefined
    }
    tracked.endedAtMs = this.now()
    tracked.files = this.changedFiles(runId)
    this.persist(tracked, 'green', 'integrating')
    const res = this.manager.finalize(runId, {
      baseBranch: tracked.baseBranch,
      onPrepared: (agentSha) => {
        tracked.publishedSha = agentSha
        this.persist(tracked, 'green', 'integrating')
      }
    })
    this.applyFinalize(tracked, res)
    this.persistFinalize(tracked, res)
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
    for (const runId of [...this.waitingForRetry]) {
      if (this.manager.hasActiveProcesses(runId)) continue
      this.waitingForRetry.delete(runId)
      this.finalizeRecovered(runId)
    }
    this.emit()
    this.scheduleRecoveryRetry()
  }

  /** Réarme manuellement un seul rangement épuisé, sans jamais republier sa SHA. */
  retryRun(runId: string): WorktreeAgentActivity | undefined {
    const tracked = this.runs.get(runId)
    if (
      !tracked ||
      tracked.verdict !== 'green' ||
      !['pending', 'cleanup-pending'].includes(tracked.publication ?? '') ||
      tracked.attentionReason !== 'retry-exhausted'
    ) {
      return undefined
    }
    const retryPublication: WorktreePublicationState =
      tracked.publication === 'pending' ? 'pending' : 'cleanup-pending'
    this.retryCounts.set(runId, 0)
    tracked.attentionReason = undefined
    this.waitingForRetry.delete(runId)
    this.persist(
      tracked,
      'green',
      retryPublication,
      'Nouvel essai de recréation demandé depuis le Hub.'
    )
    if (this.manager.hasActiveProcesses(runId)) {
      this.waitingForProcess.add(runId)
      this.scheduleRecoveryRetry()
    } else {
      this.finalizeRecovered(runId)
    }
    this.emit()
    this.scheduleRecoveryRetry()
    return this.activity().find((activity) => activity.agentId === runId)
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
      attentionReason: t.attentionReason,
      task: t.task,
      role: t.role,
      workspacePath: t.workspacePath,
      worktreePath: t.worktreePath,
      worktreeAvailable: t.worktreeAvailable,
      baseBranch: t.baseBranch,
      baseSha: t.baseSha,
      publishedSha: t.publishedSha,
      verdict: t.verdict,
      publication: t.publication,
      recovered: t.recovered,
      detail: t.detail,
      retryCount: this.retryCounts.get(t.runId)
    }))
  }

  /**
   * Copies isolées laissées par un run INTERROMPU (l'app est morte pendant son travail).
   *
   * Le redémarrage marque déjà ces runs `interrupted`, mais rien ne permettait de les RETROUVER :
   * elles restaient noyées dans l'activité générale, donc invisibles et jamais nettoyées. On les
   * énumère ici — et seulement ça. Supprimer serait irréversible alors que le travail de l'agent
   * est récupérable : le nettoyage reste une décision humaine, prise sur cette liste.
   */
  interruptedWorktrees(): Array<{
    runId: string
    worktreePath?: string
    task?: string
    conversationId?: string
  }> {
    return [...this.runs.values()]
      .filter((tracked) => tracked.isMutation && tracked.verdict === 'interrupted')
      .map((tracked) => ({
        runId: tracked.runId,
        ...(tracked.worktreePath ? { worktreePath: tracked.worktreePath } : {}),
        ...(tracked.task ? { task: tracked.task } : {}),
        ...(tracked.conversationId ? { conversationId: tracked.conversationId } : {})
      }))
  }

  conflictDiff(agentId: string): WorktreeConflictDiffResult {
    const tracked = this.runs.get(agentId)
    if (
      !tracked ||
      tracked.state !== 'conflict' ||
      tracked.publication !== 'blocked' ||
      !tracked.conflictBaseSha ||
      !tracked.conflictAgentSha ||
      tracked.files.length === 0 ||
      !this.manager.readConflictDiff
    ) {
      return { available: false, reason: 'not-conflict' }
    }
    return this.manager.readConflictDiff(agentId, {
      files: tracked.files.map((file) => file.path),
      baseSha: tracked.conflictBaseSha,
      agentSha: tracked.conflictAgentSha
    })
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
    tracked.attentionReason = undefined
    const retryable =
      res.outcome === 'cleanup-pending' ||
      (res.outcome === 'blocked' && res.reason === 'base-in-progress')
    if (!retryable) {
      this.waitingForRetry.delete(tracked.runId)
      this.retryCounts.delete(tracked.runId)
    }
    if (res.outcome === 'conflict') {
      tracked.conflictFile = res.files[0]
      tracked.conflictBaseSha = res.baseSha
      tracked.conflictAgentSha = res.agentSha
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
    }
    if (res.outcome === 'cleanup-pending') {
      tracked.publishedSha = res.publishedSha
      tracked.worktreeAvailable = res.worktreeAvailable ?? true
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
      const retries = (this.retryCounts.get(tracked.runId) ?? 0) + 1
      this.retryCounts.set(tracked.runId, retries)
      if (retries < MAX_AUTOMATIC_RETRIES) {
        this.waitingForRetry.add(tracked.runId)
        this.scheduleRecoveryRetry()
      } else {
        tracked.attentionReason = 'retry-exhausted'
      }
    }
    if (res.outcome === 'published-residue') {
      tracked.publishedSha = res.publishedSha
      tracked.worktreeAvailable = true
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
      tracked.attentionReason = 'post-publish-change'
    }
    if (res.outcome === 'blocked') {
      tracked.attentionReason = res.reason
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
      if (res.reason === 'base-in-progress') {
        const retries = (this.retryCounts.get(tracked.runId) ?? 0) + 1
        this.retryCounts.set(tracked.runId, retries)
        if (retries < MAX_AUTOMATIC_RETRIES) {
          this.waitingForRetry.add(tracked.runId)
          this.scheduleRecoveryRetry()
        } else {
          tracked.attentionReason = 'retry-exhausted'
        }
      }
    }
  }

  private persist(
    tracked: Tracked,
    verdict: WorktreeRunVerdict,
    publication: WorktreePublicationState,
    detail?: string
  ): void {
    tracked.verdict = verdict
    tracked.publication = publication
    tracked.detail = detail
    if (!this.stateStore || !tracked.isMutation) return
    const previous = this.stateStore.get(tracked.runId)
    const now = this.now()
    const record: WorktreeRunRecord = {
      version: 1,
      repoId: previous?.repoId ?? '',
      runId: tracked.runId,
      agentName: tracked.agentName,
      ...(tracked.role ? { role: tracked.role } : {}),
      ...(tracked.task ? { task: tracked.task } : {}),
      ...(tracked.conversationId ? { conversationId: tracked.conversationId } : {}),
      worktreePath: tracked.worktreePath ?? previous?.worktreePath ?? '',
      worktreeAvailable: tracked.worktreeAvailable ?? previous?.worktreeAvailable,
      baseBranch: tracked.baseBranch ?? previous?.baseBranch ?? '',
      baseSha: tracked.baseSha ?? previous?.baseSha ?? '',
      verdict,
      publication,
      files: tracked.files,
      ...(tracked.conflictFile ? { conflictFile: tracked.conflictFile } : {}),
      ...(tracked.conflictBaseSha ? { conflictBaseSha: tracked.conflictBaseSha } : {}),
      ...(tracked.conflictAgentSha ? { conflictAgentSha: tracked.conflictAgentSha } : {}),
      ...(tracked.publishedSha ? { publishedSha: tracked.publishedSha } : {}),
      ...(tracked.attentionReason ? { attentionReason: tracked.attentionReason } : {}),
      ...(detail ? { detail } : {}),
      retryCount: this.retryCounts.get(tracked.runId) ?? 0,
      createdAtMs: previous?.createdAtMs ?? tracked.startedAtMs,
      updatedAtMs: now
    }
    // Le store remplace toujours l'identité par celle de son namespace lors d'un save local.
    this.stateStore.save(record)
  }

  private persistFinalize(tracked: Tracked, result: FinalizeResult): void {
    const publication =
      result.outcome === 'merged' || result.outcome === 'nothing'
        ? 'complete'
        : result.outcome === 'cleanup-pending'
          ? 'cleanup-pending'
          : result.outcome === 'published-residue'
            ? 'published'
            : result.outcome === 'blocked' && result.reason === 'base-in-progress'
              ? 'pending'
              : 'blocked'
    this.persist(
      tracked,
      'green',
      publication,
      result.outcome === 'blocked' ||
        result.outcome === 'cleanup-pending' ||
        result.outcome === 'published-residue'
        ? result.detail
        : undefined
    )
  }

  /**
   * Au redémarrage, le worktree Git est la source durable : on reprend chaque copie agent.
   * Une copie intégrable est fusionnée/nettoyée ; un conflit reste intact et redevient visible.
   */
  private reconcileExisting(): void {
    const residues = this.manager.reconcileResidues?.()
    const records = new Map((this.stateStore?.list() ?? []).map((record) => [record.runId, record]))
    const managerIds = this.manager.listAgentIds()
    const ids = [
      ...managerIds,
      ...[...records.keys()].filter((runId) => !managerIds.includes(runId))
    ]
    for (const runId of ids) {
      const record = records.get(runId)
      let orphanContext: ReturnType<RunWorktreeCoordinatorDeps['manager']['describe']> | undefined
      if (!record) {
        try {
          orphanContext = this.manager.describe(runId)
        } catch {
          orphanContext = undefined
        }
      }
      const retryBudgetExhausted =
        record?.attentionReason === 'retry-exhausted' &&
        (record.retryCount ?? 0) >= MAX_AUTOMATIC_RETRIES
      if ((record?.retryCount ?? 0) > 0) {
        this.retryCounts.set(runId, record!.retryCount!)
      }
      if (this.manager.hasActiveProcesses(runId)) {
        const timestamp = record?.createdAtMs ?? this.now()
        this.runs.set(runId, {
          runId,
          agentName: record?.agentName ?? 'Agent récupéré',
          isMutation: true,
          startedAtMs: timestamp,
          state: 'working',
          files: this.changedFiles(runId),
          task: record?.task,
          role: record?.role,
          conversationId: record?.conversationId,
          worktreePath: record?.worktreePath ?? orphanContext?.worktreePath,
          worktreeAvailable: record?.worktreeAvailable,
          workspacePath: orphanContext?.workspacePath,
          baseBranch: record?.baseBranch ?? orphanContext?.baseBranch,
          baseSha: record?.baseSha ?? orphanContext?.baseSha,
          conflictBaseSha: record?.conflictBaseSha,
          conflictAgentSha: record?.conflictAgentSha,
          publishedSha: record?.publishedSha,
          attentionReason: record?.attentionReason as Tracked['attentionReason'],
          verdict: record?.verdict,
          publication: record?.publication,
          recovered: true,
          detail: record?.detail
        })
        if (!record && orphanContext) {
          this.persist(
            this.runs.get(runId)!,
            'unknown',
            'blocked',
            'Copie récupérée sans manifeste durable.'
          )
        }
        this.waitingForProcess.add(runId)
      } else if (
        record?.verdict === 'green' &&
        (['pending', 'integrating', 'published', 'cleanup-pending'].includes(record.publication) ||
          (record.publication === 'complete' && managerIds.includes(runId))) &&
        !retryBudgetExhausted
      ) {
        this.finalizeRecovered(runId)
      } else {
        const timestamp = record?.createdAtMs ?? this.now()
        const tracked: Tracked = {
          runId,
          agentName: record?.agentName ?? 'Agent récupéré',
          isMutation: true,
          startedAtMs: timestamp,
          endedAtMs: record?.updatedAtMs ?? timestamp,
          state: !record
            ? 'blocked'
            : record.publication === 'complete'
              ? 'merged'
              : record.publication === 'blocked' &&
                  record.conflictBaseSha &&
                  record.conflictAgentSha
                ? 'conflict'
                : record.publication === 'blocked'
                  ? 'blocked'
                  : 'ready',
          files: record?.files.length ? record.files : this.changedFiles(runId),
          task: record?.task,
          role: record?.role,
          conversationId: record?.conversationId,
          worktreePath: record?.worktreePath ?? orphanContext?.worktreePath,
          worktreeAvailable: record?.worktreeAvailable,
          workspacePath: orphanContext?.workspacePath,
          baseBranch: record?.baseBranch ?? orphanContext?.baseBranch,
          baseSha: record?.baseSha ?? orphanContext?.baseSha,
          conflictFile: record?.conflictFile,
          conflictBaseSha: record?.conflictBaseSha,
          conflictAgentSha: record?.conflictAgentSha,
          publishedSha: record?.publishedSha,
          attentionReason: !record
            ? 'merge-failed'
            : ((record.attentionReason as Tracked['attentionReason']) ??
              (record.publication === 'blocked' ? 'merge-failed' : undefined)),
          verdict: record?.verdict ?? 'unknown',
          publication: record?.publication ?? 'blocked',
          recovered: true,
          detail:
            record?.detail ?? (!record ? 'Copie récupérée sans manifeste durable.' : undefined)
        }
        this.runs.set(runId, tracked)
        if (!record && orphanContext) {
          this.persist(tracked, 'unknown', 'blocked', tracked.detail)
        }
        if (record?.verdict === 'running') this.persist(tracked, 'interrupted', 'blocked')
      }
    }
    for (const [index, residue] of (residues?.blocked ?? []).entries()) {
      const timestamp = this.now()
      this.runs.set(`residue-${index}`, {
        runId: `residue-${index}`,
        agentName: 'Copie à vérifier',
        isMutation: true,
        startedAtMs: timestamp,
        endedAtMs: timestamp,
        state: 'blocked',
        files: [],
        worktreePath: residue.path,
        attentionReason: 'merge-failed',
        verdict: 'unknown',
        publication: 'blocked',
        recovered: true,
        detail: residue.detail
      })
    }
    this.emit()
    this.scheduleRecoveryRetry()
  }

  private finalizeRecovered(runId: string): void {
    const record = this.stateStore?.get(runId)
    const recoveredWithoutRecord = this.runs.get(runId)
    if (!record && recoveredWithoutRecord?.recovered) {
      const tracked = recoveredWithoutRecord
      tracked.endedAtMs = this.now()
      tracked.state = 'blocked'
      tracked.attentionReason = 'merge-failed'
      tracked.verdict = 'unknown'
      tracked.publication = 'blocked'
      tracked.detail = 'Copie récupérée sans manifeste durable.'
      return
    }
    if (
      this.stateStore &&
      record &&
      (record.verdict !== 'green' ||
        (record.attentionReason === 'retry-exhausted' &&
          (record.retryCount ?? 0) >= MAX_AUTOMATIC_RETRIES))
    ) {
      const tracked = this.runs.get(runId)
      if (!tracked) return
      tracked.endedAtMs = this.now()
      if (record.verdict === 'red' || record.verdict === 'cancelled') {
        tracked.state = 'ready'
        tracked.attentionReason = undefined
      } else if (record.verdict === 'green') {
        tracked.state = 'ready'
        tracked.attentionReason = 'retry-exhausted'
      } else {
        tracked.state = 'blocked'
        tracked.attentionReason =
          (record.attentionReason as Tracked['attentionReason']) ?? 'merge-failed'
      }
      if (record.verdict === 'running') {
        this.persist(tracked, 'interrupted', 'blocked', 'Processus interrompu après redémarrage')
      }
      return
    }
    if (this.stateStore && record?.verdict !== 'green') return
    const timestamp = this.now()
    const existing = this.runs.get(runId)
    const tracked: Tracked = existing ?? {
      runId,
      agentName: record?.agentName ?? 'Agent récupéré',
      isMutation: true,
      startedAtMs: record?.createdAtMs ?? timestamp,
      state: 'working',
      files: this.changedFiles(runId),
      task: record?.task,
      role: record?.role,
      conversationId: record?.conversationId,
      worktreePath: record?.worktreePath,
      worktreeAvailable: record?.worktreeAvailable,
      baseBranch: record?.baseBranch,
      baseSha: record?.baseSha,
      conflictBaseSha: record?.conflictBaseSha,
      conflictAgentSha: record?.conflictAgentSha,
      publishedSha: record?.publishedSha,
      attentionReason: record?.attentionReason as Tracked['attentionReason'],
      verdict: record?.verdict,
      publication: record?.publication,
      recovered: true,
      detail: record?.detail
    }
    tracked.endedAtMs = timestamp
    this.runs.set(runId, tracked)
    let recoveryDecision: 'resume-publication' | 'cleanup-only' | undefined
    if (record) {
      const recoveryPublication =
        record.publication === 'complete' ? 'published' : record.publication
      const recoveryPublishedSha =
        record.publishedSha ?? (record.publication === 'complete' ? record.baseSha : undefined)
      const validation = this.manager.validateRecoveryContext(runId, {
        worktreePath: record.worktreePath,
        baseBranch: record.baseBranch,
        baseSha: record.baseSha,
        publication: recoveryPublication as
          'pending' | 'integrating' | 'published' | 'cleanup-pending',
        ...(recoveryPublishedSha ? { publishedSha: recoveryPublishedSha } : {})
      })
      if (!validation.ok) {
        tracked.state = 'blocked'
        tracked.attentionReason = 'merge-failed'
        this.persist(tracked, 'green', 'blocked', validation.detail)
        return
      }
      recoveryDecision = validation.decision
    }
    try {
      const publishedSha =
        record?.publishedSha ??
        tracked.publishedSha ??
        (record?.publication === 'complete' ? record.baseSha : undefined)
      const publicationCanOnlyNeedCleanup =
        recoveryDecision === 'cleanup-only' ||
        (recoveryDecision === undefined &&
          Boolean(publishedSha) &&
          Boolean(
            record && ['published', 'cleanup-pending', 'complete'].includes(record.publication)
          ))
      const result =
        (publicationCanOnlyNeedCleanup ||
          tracked.publication === 'cleanup-pending' ||
          tracked.publication === 'published') &&
        publishedSha &&
        this.manager.cleanupPublished
          ? this.manager.cleanupPublished(
              runId,
              publishedSha,
              record?.baseBranch ?? tracked.baseBranch
            )
          : this.manager.finalize(runId, {
              ...((record?.baseBranch ?? tracked.baseBranch)
                ? { baseBranch: record?.baseBranch ?? tracked.baseBranch }
                : {}),
              ...(publishedSha ? { expectedAgentSha: publishedSha } : {}),
              onPrepared: (agentSha) => {
                tracked.publishedSha = agentSha
                this.persist(tracked, 'green', 'integrating')
              }
            })
      this.applyFinalize(tracked, result)
      this.persistFinalize(tracked, result)
    } catch {
      tracked.state = 'blocked'
      tracked.attentionReason = 'merge-failed'
      this.persist(tracked, 'green', 'blocked')
    }
  }

  private scheduleRecoveryRetry(): void {
    if (
      (this.waitingForProcess.size === 0 && this.waitingForRetry.size === 0) ||
      this.recoveryTimer
    )
      return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      this.retryRecovery()
    }, 5_000)
    this.recoveryTimer.unref?.()
  }
}
