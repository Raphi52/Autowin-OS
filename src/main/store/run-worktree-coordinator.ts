import { WorktreeManager, type FinalizeResult, type WorktreeRunContext } from './worktree-manager'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeConflictResolutionChoice,
  WorktreeConflictResolutionResult,
  WorktreeState
} from '../../shared/worktree-activity-model'
import { etatBureauRecupere } from '../../shared/worktree-activity-model'
import {
  WorktreeRunStateStore,
  type WorktreePublicationState,
  type WorktreeRunRecord,
  type WorktreeRunVerdict
} from './worktree-run-state'
import type { WorktreeRecoveryInventory } from './worktree-operation-protocol'

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
    Partial<
      Pick<
        WorktreeManager,
        | 'reconcileResidues'
        | 'reconcileResiduesAsync'
        | 'cleanupPublished'
        | 'readConflictDiff'
        | 'prepareAsync'
        | 'changedFilesAsync'
        | 'finalizeAsync'
        | 'cleanupPublishedAsync'
        | 'acknowledgePublication'
        | 'acknowledgePublicationAsync'
        | 'operationsAreIsolated'
        | 'recoveryInventoryAsync'
        | 'describeAsync'
        | 'describeForLaunch'
        | 'hasActiveProcessesAsync'
        | 'validateRecoveryContextAsync'
        | 'readConflictDiffAsync'
        | 'discardAsync'
        | 'sweepAbandonedAgentCopiesAsync'
      >
    >
  stateStore?: WorktreeRunStateStore
  nowFn?: () => number
  /** Appelé à chaque changement d'activité → l'app pousse vers le renderer (IPC). */
  onActivity?: (activity: WorktreeAgentActivity[]) => void
  /** Publication reprise après redémarrage, quand le callback mémoire du run n'existe plus. */
  onRecoveredPublication?: (publication: {
    runId: string
    task?: string
    conversationId?: string
    turnId?: string
    causalWatchPaths: readonly string[]
    baseSha: string
    agentSha: string
  }) => void | Promise<void>
  /**
   * Reporte la réconciliation des copies existantes jusqu'à la résolution de cette promesse, au lieu
   * de la faire SYNCHRONEMENT dans le constructeur. Absente = comportement inchangé.
   *
   * Pourquoi une option et non un défaut : la réconciliation synchrone est un contrat OBSERVÉ —
   * plusieurs tests construisent ce coordinateur et lisent immédiatement l'état réconcilié. Les
   * basculer en asynchrone reviendrait à réécrire leurs attentes pour accommoder un correctif, ce qui
   * affaiblirait la couverture au lieu de l'adapter.
   *
   * En production le report est vital : ce coordinateur naît de `new AutowinOS()`, au premier niveau
   * du module principal, et la réconciliation énumère synchroniquement les copies git sur disque.
   *
   * Une PROMESSE et non un délai, parce que le délai a été essayé et mesuré : reporté de 1 500 ms, le
   * travail synchrone occupait le fil principal juste avant la micro-tâche de `app.whenReady`, qui
   * arrivait alors à 26 047 ms. Le blocage avait été déplacé, pas supprimé. Voir `startup-gate.ts`.
   */
  deferRecoveryUntil?: Promise<unknown>
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
  publicationAgentSha?: string
  publicationBaseSha?: string
  causalPublicationDeliveredAtMs?: number
  attentionReason?: WorktreeAgentActivity['attentionReason']
  task?: string
  role?: string
  conversationId?: string
  turnId?: string
  causalWatchPaths?: readonly string[]
  workspacePath?: string
  worktreePath?: string
  worktreeAvailable?: boolean
  baseBranch?: string
  baseSha?: string
  sourceSha?: string
  canonicalBaseRef?: string
  excludedDirtyFiles?: string[]
  excludedDirtyFileCount?: number
  excludedDirtyFilesTruncated?: boolean
  verdict?: WorktreeRunVerdict
  publication?: WorktreePublicationState
  recovered?: boolean
  detail?: string
}

interface RunWorktreeBeginMetadata {
  task?: string
  role?: string
  conversationId?: string
  turnId?: string
  causalWatchPaths?: readonly string[]
  sourceWorkspacePath?: string
  sourceBaseSha?: string
  /** Réouvre la copie durable portant ce run ; interdit toute recréation depuis la base courante. */
  resumeExisting?: boolean
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
  private readonly publicationCallbacks = new Map<
    string,
    {
      onPrepared?: (publication: { baseSha: string; agentSha: string }) => void
      onPublished?: (publication: { baseSha: string; agentSha: string }) => void | Promise<void>
    }
  >()
  private readonly now: () => number
  private readonly onActivity?: (a: WorktreeAgentActivity[]) => void
  private readonly onRecoveredPublication?: RunWorktreeCoordinatorDeps['onRecoveredPublication']
  private readonly stateStore?: WorktreeRunStateStore
  private readonly runs = new Map<string, Tracked>()
  private readonly waitingForProcess = new Set<string>()
  private readonly waitingForRetry = new Set<string>()
  private readonly retryCounts = new Map<string, number>()
  private readonly resumeClaims = new Set<string>()
  private recoveryTimer?: ReturnType<typeof setTimeout>

  constructor(deps: RunWorktreeCoordinatorDeps) {
    this.manager = deps.manager
    this.now = deps.nowFn ?? Date.now
    this.onActivity = deps.onActivity
    this.onRecoveredPublication = deps.onRecoveredPublication
    this.stateStore = deps.stateStore
    if (this.manager.operationsAreIsolated?.() && this.manager.recoveryInventoryAsync) {
      void this.manager
        .recoveryInventoryAsync()
        .then((inventory) => this.reconcileExisting(inventory))
        .catch((error) => this.recordRecoveryFailure(error))
    } else {
      /**
       * La réconciliation est DIFFÉRÉE au lieu d'être faite ici, et c'est la correction du démarrage.
       *
       * MESURÉ : ce travail est synchrone et énumère les copies git sur disque. Comme ce coordinateur
       * est construit par `new AutowinOS()`, lui-même au premier niveau du module principal, il
       * bloquait ~24 s AVANT que `app.whenReady` puisse se déclencher — donc avant qu'aucune fenêtre
       * n'existe. `whenReady` arrivait à 26 047 ms ; test d'inversion : 1 545 ms sans ce travail.
       *
       * C'EST un changement de contrat, contrairement à ce qu'affirmait ce commentaire avant : la
       * branche synchrone ci-dessous est lue par des tests qui construisent puis lisent immédiatement
       * l'état réconcilié. Le report est donc opt-in, et la production seule le demande.
       *
       * On attend un ÉVÉNEMENT et non un délai : reporté de 1 500 ms par une minuterie, ce travail
       * tombait juste avant la micro-tâche de `whenReady` et le blocage était DÉPLACÉ, pas supprimé.
       */
      const attendre = deps.deferRecoveryUntil
      if (attendre) {
        // `void` et non `await` : le constructeur ne peut pas attendre, et un rejet de la promesse de
        // garde ne doit pas empêcher la récupération — on réconcilie dans les deux cas.
        void attendre.then(
          () => this.reconcileExistingAsync(),
          () => this.reconcileExistingAsync()
        )
      } else {
        this.reconcileExisting()
      }
    }
  }

  private resumeCandidate(
    runId: string,
    agentName: string,
    metadata: Omit<
      RunWorktreeBeginMetadata,
      'sourceWorkspacePath' | 'sourceBaseSha' | 'resumeExisting'
    >
  ): Tracked {
    const record = this.stateStore?.get(runId)
    const tracked =
      this.runs.get(runId) ??
      (record
        ? {
            runId,
            agentName: record.agentName,
            isMutation: true,
            startedAtMs: record.createdAtMs,
            endedAtMs: record.updatedAtMs,
            state: 'blocked' as const,
            files: record.files,
            task: record.task,
            role: record.role,
            conversationId: record.conversationId,
            turnId: record.turnId,
            causalWatchPaths: record.causalWatchPaths,
            worktreePath: record.worktreePath,
            worktreeAvailable: record.worktreeAvailable,
            baseBranch: record.baseBranch,
            baseSha: record.baseSha,
            sourceSha: record.sourceSha,
            canonicalBaseRef: record.canonicalBaseRef,
            excludedDirtyFiles: record.excludedDirtyFiles,
            excludedDirtyFileCount: record.excludedDirtyFileCount,
            excludedDirtyFilesTruncated: record.excludedDirtyFilesTruncated,
            verdict: record.verdict,
            publication: record.publication,
            recovered: true,
            detail: record.detail
          }
        : undefined)
    if (
      !tracked?.worktreePath ||
      !tracked.baseBranch ||
      !tracked.baseSha ||
      tracked.worktreeAvailable === false
    ) {
      throw new Error(
        `Reprise du worktree impossible pour ${runId} : copie durable absente ou incomplète.`
      )
    }
    tracked.agentName = agentName
    Object.assign(tracked, metadata)
    this.runs.set(runId, tracked)
    return tracked
  }

  private claimResume(runId: string): void {
    if (this.resumeClaims.has(runId)) {
      throw new Error(`Reprise du worktree déjà en cours pour ${runId}.`)
    }
    this.resumeClaims.add(runId)
  }

  private assertResumePublicationIsOpen(tracked: Tracked): void {
    if (tracked.publication !== 'blocked' && tracked.publication !== 'not-requested') {
      throw new Error(
        `Reprise du worktree refusée pour ${tracked.runId} : publication ${tracked.publication ?? 'inconnue'} déjà engagée.`
      )
    }
  }

  private assertResumeStateAfterProcessCheck(tracked: Tracked): void {
    const recoveredProcessJustEnded =
      tracked.state === 'working' && this.waitingForProcess.has(tracked.runId)
    if (
      tracked.state === 'isolated' ||
      (tracked.state === 'working' && !recoveredProcessJustEnded)
    ) {
      throw new Error(`Reprise du worktree refusée pour ${tracked.runId} : run déjà actif.`)
    }
  }

  private assertNoActiveResumeProcess(runId: string): void {
    if (this.manager.hasActiveProcesses(runId)) {
      throw new Error(`Reprise du worktree refusée pour ${runId} : processus agent encore actif.`)
    }
  }

  private async assertNoActiveResumeProcessAsync(runId: string): Promise<void> {
    const active = this.manager.hasActiveProcessesAsync
      ? await this.manager.hasActiveProcessesAsync(runId)
      : this.manager.hasActiveProcesses(runId)
    if (active) {
      throw new Error(`Reprise du worktree refusée pour ${runId} : processus agent encore actif.`)
    }
  }

  private activateResumed(tracked: Tracked, context: WorktreeRunContext, cwd: string): void {
    Object.assign(tracked, context)
    tracked.worktreePath = cwd
    tracked.worktreeAvailable = true
    tracked.state = 'working'
    tracked.endedAtMs = undefined
    tracked.conflictWith = undefined
    tracked.conflictFile = undefined
    tracked.conflictBaseSha = undefined
    tracked.conflictAgentSha = undefined
    tracked.publishedSha = undefined
    tracked.publicationAgentSha = undefined
    tracked.publicationBaseSha = undefined
    tracked.causalPublicationDeliveredAtMs = undefined
    tracked.attentionReason = undefined
    tracked.detail = undefined
    tracked.recovered = true
    this.waitingForProcess.delete(tracked.runId)
    this.waitingForRetry.delete(tracked.runId)
    this.retryCounts.delete(tracked.runId)
    this.persist(tracked, 'running', 'not-requested')
    this.emit()
  }

  /** Démarre un run. Renvoie le cwd isolé (mutation) ou undefined (non-mutation → base). */
  begin(
    runId: string,
    agentName: string,
    isMutation: boolean,
    metadata: RunWorktreeBeginMetadata = {}
  ): string | undefined {
    const { sourceWorkspacePath, sourceBaseSha, resumeExisting, ...trackedMetadata } = metadata
    if (isMutation && resumeExisting) {
      this.claimResume(runId)
      try {
        const tracked = this.resumeCandidate(runId, agentName, trackedMetadata)
        this.assertResumePublicationIsOpen(tracked)
        this.assertNoActiveResumeProcess(runId)
        this.assertResumeStateAfterProcessCheck(tracked)
        const described = this.manager.describe(runId)
        const context = {
          ...described,
          worktreePath: tracked.worktreePath!,
          baseBranch: tracked.baseBranch!,
          baseSha: tracked.baseSha!,
          sourceSha: tracked.sourceSha,
          canonicalBaseRef: tracked.canonicalBaseRef,
          excludedDirtyFiles: tracked.excludedDirtyFiles,
          excludedDirtyFileCount: tracked.excludedDirtyFileCount,
          excludedDirtyFilesTruncated: tracked.excludedDirtyFilesTruncated
        }
        const validation = this.manager.validateRecoveryContext(runId, {
          worktreePath: context.worktreePath,
          baseBranch: context.baseBranch,
          baseSha: context.baseSha,
          sourceSha: context.sourceSha,
          canonicalBaseRef: context.canonicalBaseRef,
          excludedDirtyFiles: context.excludedDirtyFiles,
          publication: 'pending'
        })
        if (!validation.ok || validation.decision === 'cleanup-only') {
          throw new Error(
            !validation.ok
              ? `Reprise du worktree refusée : ${validation.detail}`
              : 'Reprise du worktree refusée : cette copie est déjà publiée.'
          )
        }
        const cwd = this.manager.acquire(runId, context)
        this.activateResumed(tracked, context, cwd)
        return cwd
      } finally {
        this.resumeClaims.delete(runId)
      }
    }
    const tracked: Tracked = {
      runId,
      agentName,
      isMutation,
      startedAtMs: this.now(),
      state: isMutation ? 'isolated' : 'working',
      files: [],
      ...trackedMetadata
    }
    this.runs.set(runId, tracked)
    let cwd: string | undefined
    if (isMutation) {
      try {
        const described =
          sourceWorkspacePath && sourceBaseSha
            ? this.manager.describe(runId)
            : (this.manager.describeForLaunch?.(runId) ?? this.manager.describe(runId))
        if (Boolean(sourceWorkspacePath) !== Boolean(sourceBaseSha)) {
          throw new Error('Checkpoint worktree incomplet.')
        }
        const context =
          sourceWorkspacePath && sourceBaseSha
            ? {
                ...described,
                workspacePath: sourceWorkspacePath,
                baseSha: sourceBaseSha,
                sourceSha: sourceBaseSha
              }
            : described
        Object.assign(tracked, context)
        this.persist(tracked, 'running', 'not-requested')
        cwd = this.manager.acquire(runId, context)
        tracked.worktreePath = cwd
        tracked.worktreeAvailable = true
        tracked.state = 'working'
        this.persist(tracked, 'running', 'not-requested')
      } catch (error) {
        tracked.state = 'blocked'
        tracked.endedAtMs = this.now()
        tracked.attentionReason = 'merge-failed'
        tracked.detail = error instanceof Error ? error.message : String(error)
        if (tracked.worktreePath && tracked.baseBranch && tracked.baseSha) {
          this.persist(tracked, 'interrupted', 'blocked', tracked.detail)
        }
        this.emit()
        throw error
      }
    }
    this.emit()
    return cwd
  }

  /** Variante production : les commandes Git lourdes vivent dans un Worker et ne figent pas main. */
  async beginAsync(
    runId: string,
    agentName: string,
    isMutation: boolean,
    metadata: RunWorktreeBeginMetadata = {}
  ): Promise<string | undefined> {
    if (!isMutation || !this.manager.prepareAsync) {
      return this.begin(runId, agentName, isMutation, metadata)
    }
    const { sourceWorkspacePath, sourceBaseSha, resumeExisting, ...trackedMetadata } = metadata
    if (resumeExisting) {
      this.claimResume(runId)
      try {
        const tracked = this.resumeCandidate(runId, agentName, trackedMetadata)
        this.assertResumePublicationIsOpen(tracked)
        await this.assertNoActiveResumeProcessAsync(runId)
        this.assertResumeStateAfterProcessCheck(tracked)
        const described = this.manager.describeAsync
          ? await this.manager.describeAsync(runId)
          : this.manager.describe(runId)
        const context = {
          ...described,
          worktreePath: tracked.worktreePath!,
          baseBranch: tracked.baseBranch!,
          baseSha: tracked.baseSha!,
          sourceSha: tracked.sourceSha,
          canonicalBaseRef: tracked.canonicalBaseRef,
          excludedDirtyFiles: tracked.excludedDirtyFiles,
          excludedDirtyFileCount: tracked.excludedDirtyFileCount,
          excludedDirtyFilesTruncated: tracked.excludedDirtyFilesTruncated
        }
        const validation = this.manager.validateRecoveryContextAsync
          ? await this.manager.validateRecoveryContextAsync(runId, {
              worktreePath: context.worktreePath,
              baseBranch: context.baseBranch,
              baseSha: context.baseSha,
              sourceSha: context.sourceSha,
              canonicalBaseRef: context.canonicalBaseRef,
              excludedDirtyFiles: context.excludedDirtyFiles,
              publication: 'pending'
            })
          : this.manager.validateRecoveryContext(runId, {
              worktreePath: context.worktreePath,
              baseBranch: context.baseBranch,
              baseSha: context.baseSha,
              sourceSha: context.sourceSha,
              canonicalBaseRef: context.canonicalBaseRef,
              excludedDirtyFiles: context.excludedDirtyFiles,
              publication: 'pending'
            })
        if (!validation.ok || validation.decision === 'cleanup-only') {
          throw new Error(
            !validation.ok
              ? `Reprise du worktree refusée : ${validation.detail}`
              : 'Reprise du worktree refusée : cette copie est déjà publiée.'
          )
        }
        const prepared = await this.manager.prepareAsync(runId, context)
        this.activateResumed(tracked, prepared.context, prepared.path)
        return prepared.path
      } finally {
        this.resumeClaims.delete(runId)
      }
    }
    const tracked: Tracked = {
      runId,
      agentName,
      isMutation,
      startedAtMs: this.now(),
      state: 'isolated',
      files: [],
      ...trackedMetadata
    }
    this.runs.set(runId, tracked)
    try {
      if (Boolean(sourceWorkspacePath) !== Boolean(sourceBaseSha)) {
        throw new Error('Checkpoint worktree incomplet.')
      }
      const explicitContext =
        sourceWorkspacePath && sourceBaseSha
          ? {
              ...(this.manager.describeAsync
                ? await this.manager.describeAsync(runId)
                : this.manager.describe(runId)),
              workspacePath: sourceWorkspacePath,
              baseSha: sourceBaseSha,
              sourceSha: sourceBaseSha
            }
          : undefined
      const prepared = await this.manager.prepareAsync(runId, explicitContext)
      Object.assign(tracked, prepared.context)
      tracked.worktreePath = prepared.path
      tracked.worktreeAvailable = true
      tracked.state = 'working'
      this.persist(tracked, 'running', 'not-requested')
      this.emit()
      return prepared.path
    } catch (error) {
      tracked.state = 'blocked'
      tracked.endedAtMs = this.now()
      tracked.attentionReason = 'merge-failed'
      tracked.detail = error instanceof Error ? error.message : String(error)
      // `describeAsync` peut échouer avant que le contexte durable existe. Dans ce cas, persister
      // fabriquerait trois chaînes vides et masquerait l'erreur Git par « manifeste invalide ».
      if (tracked.worktreePath && tracked.baseBranch && tracked.baseSha) {
        this.persist(tracked, 'interrupted', 'blocked', tracked.detail)
      }
      this.emit()
      throw error
    }
  }

  /** Termine un run : fusionne (full-auto) ou bascule conflit. No-op si run inconnu/non-mutation. */
  /**
   * Clôt un run. `merge: false` ⇒ le travail n'est PAS fusionné dans la base et la copie isolée est
   * CONSERVÉE : c'est le cas d'un run non vert (jugé rouge, annulé, planté). Avant, `end()` fusionnait
   * dans tous les cas (appelé depuis un `finally`), donc un run RATÉ atterrissait quand même dans la
   * base. Défaut `true` = comportement historique (rétrocompat des appelants existants).
   */
  end(
    runId: string,
    options: {
      merge?: boolean
      retainGreen?: boolean
      onPrepared?: (publication: { baseSha: string; agentSha: string }) => void
      onPublished?: (publication: { baseSha: string; agentSha: string }) => void | Promise<void>
    } = {}
  ): FinalizeResult | undefined {
    const tracked = this.runs.get(runId)
    if (!tracked) return undefined
    if (options.onPrepared || options.onPublished) this.publicationCallbacks.set(runId, options)
    if (options.merge === false) {
      this.publicationCallbacks.delete(runId)
      tracked.endedAtMs = this.now()
      tracked.files = tracked.isMutation ? this.changedFiles(runId) : []
      // 'ready' = travail terminé, isolé, en attente d'une décision humaine (ni fusionné, ni perdu).
      tracked.state = tracked.isMutation ? 'ready' : 'merged'
      if (tracked.isMutation) {
        this.persist(
          tracked,
          options.retainGreen ? 'green' : 'red',
          options.retainGreen ? 'held' : 'not-requested',
          options.retainGreen
            ? 'Solution conservée par un tournoi ; aucune publication automatique.'
            : undefined
        )
      }
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
    let preparedPublication: { baseSha: string; agentSha: string } | undefined
    const res = this.manager.finalize(runId, {
      baseBranch: tracked.baseBranch,
      onPrepared: (agentSha, baseSha) => {
        tracked.publicationAgentSha = agentSha
        tracked.publicationBaseSha = baseSha
        this.persist(tracked, 'green', 'integrating')
        preparedPublication = { baseSha, agentSha }
        this.publicationCallbacks.get(runId)?.onPrepared?.(preparedPublication)
      },
      onIntegrated: (integratedSha, agentSha, baseSha) => {
        tracked.publishedSha = integratedSha
        tracked.publicationAgentSha = agentSha
        tracked.publicationBaseSha = baseSha
        this.persist(tracked, 'green', 'integrating')
        preparedPublication = { baseSha, agentSha: integratedSha }
      }
    })
    this.applyFinalize(tracked, res)
    this.persistFinalize(tracked, res)
    this.acknowledgePublication(tracked, res)
    void this.finishPublicationCallbacks(tracked, res, preparedPublication)
    this.emit()
    return res
  }

  async endAsync(
    runId: string,
    options: {
      merge?: boolean
      retainGreen?: boolean
      onPrepared?: (publication: { baseSha: string; agentSha: string }) => void
      onPublished?: (publication: { baseSha: string; agentSha: string }) => void | Promise<void>
    } = {}
  ): Promise<FinalizeResult | undefined> {
    if (!this.manager.finalizeAsync || !this.manager.changedFilesAsync) {
      return this.end(runId, options)
    }
    const tracked = this.runs.get(runId)
    if (!tracked) return undefined
    if (options.onPrepared || options.onPublished) this.publicationCallbacks.set(runId, options)
    if (options.merge === false) {
      this.publicationCallbacks.delete(runId)
      tracked.endedAtMs = this.now()
      tracked.files = tracked.isMutation
        ? (await this.manager.changedFilesAsync(runId)).map((path) => ({
            path,
            kind: 'mod' as const
          }))
        : []
      tracked.state = tracked.isMutation ? 'ready' : 'merged'
      if (tracked.isMutation) {
        this.persist(
          tracked,
          options.retainGreen ? 'green' : 'red',
          options.retainGreen ? 'held' : 'not-requested',
          options.retainGreen
            ? 'Solution conservée par un tournoi ; aucune publication automatique.'
            : undefined
        )
      }
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
    const active = this.manager.hasActiveProcessesAsync
      ? await this.manager.hasActiveProcessesAsync(runId)
      : this.manager.hasActiveProcesses(runId)
    if (active) {
      tracked.state = 'working'
      this.waitingForProcess.add(runId)
      this.emit()
      this.scheduleRecoveryRetry()
      return undefined
    }
    tracked.endedAtMs = this.now()
    try {
      tracked.files = (await this.manager.changedFilesAsync(runId)).map((path) => ({
        path,
        kind: 'mod' as const
      }))
      this.persist(tracked, 'green', 'integrating')
      let preparedPublication: { baseSha: string; agentSha: string } | undefined
      const res = await this.manager.finalizeAsync(runId, {
        baseBranch: tracked.baseBranch,
        onPrepared: (agentSha, baseSha) => {
          tracked.publicationAgentSha = agentSha
          tracked.publicationBaseSha = baseSha
          this.persist(tracked, 'green', 'integrating')
          preparedPublication = { baseSha, agentSha }
          this.publicationCallbacks.get(runId)?.onPrepared?.(preparedPublication)
        },
        onIntegrated: (integratedSha, agentSha, baseSha) => {
          tracked.publishedSha = integratedSha
          tracked.publicationAgentSha = agentSha
          tracked.publicationBaseSha = baseSha
          this.persist(tracked, 'green', 'integrating')
          preparedPublication = { baseSha, agentSha: integratedSha }
        }
      })
      this.applyFinalize(tracked, res)
      this.persistFinalize(tracked, res)
      await this.acknowledgePublicationAsync(tracked, res)
      await this.finishPublicationCallbacks(tracked, res, preparedPublication)
      this.emit()
      return res
    } catch (error) {
      const blocked: FinalizeResult = {
        outcome: 'blocked',
        agentId: runId,
        files: tracked.files.map((file) => file.path),
        reason: 'merge-failed',
        detail: error instanceof Error ? error.message : String(error)
      }
      this.applyFinalize(tracked, blocked)
      this.persistFinalize(tracked, blocked)
      this.emit()
      return blocked
    }
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

  /** Variante production : chaque sonde/finalisation Git passe par le worker dédié. */
  async retryRecoveryAsync(): Promise<void> {
    for (const runId of [...this.waitingForProcess]) {
      const active = this.manager.hasActiveProcessesAsync
        ? await this.manager.hasActiveProcessesAsync(runId)
        : this.manager.hasActiveProcesses(runId)
      if (active) continue
      this.waitingForProcess.delete(runId)
      await this.finalizeRecoveredAsync(runId)
    }
    for (const runId of [...this.waitingForRetry]) {
      const active = this.manager.hasActiveProcessesAsync
        ? await this.manager.hasActiveProcessesAsync(runId)
        : this.manager.hasActiveProcesses(runId)
      if (active) continue
      this.waitingForRetry.delete(runId)
      await this.finalizeRecoveredAsync(runId)
    }
    this.emit()
    this.scheduleRecoveryRetry()
  }

  /** Réarme manuellement un seul rangement épuisé, sans jamais republier sa SHA. */
  retryRun(runId: string): WorktreeAgentActivity | undefined {
    const tracked = this.runs.get(runId)
    const retryBlockedPublication =
      tracked?.publication === 'blocked' && tracked.attentionReason === 'merge-failed'
    const retryExhaustedPublication =
      !!tracked &&
      ['pending', 'cleanup-pending'].includes(tracked.publication ?? '') &&
      tracked.attentionReason === 'retry-exhausted'
    if (
      !tracked ||
      tracked.verdict !== 'green' ||
      (!retryBlockedPublication && !retryExhaustedPublication)
    ) {
      return undefined
    }
    const retryPublication: WorktreePublicationState =
      retryBlockedPublication || tracked.publication === 'pending' ? 'pending' : 'cleanup-pending'
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

  async retryRunAsync(runId: string): Promise<WorktreeAgentActivity | undefined> {
    const tracked = this.runs.get(runId)
    const retryBlockedPublication =
      tracked?.publication === 'blocked' && tracked.attentionReason === 'merge-failed'
    const retryExhaustedPublication =
      !!tracked &&
      ['pending', 'cleanup-pending'].includes(tracked.publication ?? '') &&
      tracked.attentionReason === 'retry-exhausted'
    if (
      !tracked ||
      tracked.verdict !== 'green' ||
      (!retryBlockedPublication && !retryExhaustedPublication)
    ) {
      return undefined
    }
    const retryPublication: WorktreePublicationState =
      retryBlockedPublication || tracked.publication === 'pending' ? 'pending' : 'cleanup-pending'
    this.retryCounts.set(runId, 0)
    tracked.attentionReason = undefined
    this.waitingForRetry.delete(runId)
    this.persist(
      tracked,
      'green',
      retryPublication,
      'Nouvel essai de recréation demandé depuis le Hub.'
    )
    const active = this.manager.hasActiveProcessesAsync
      ? await this.manager.hasActiveProcessesAsync(runId)
      : this.manager.hasActiveProcesses(runId)
    if (active) {
      this.waitingForProcess.add(runId)
      this.scheduleRecoveryRetry()
    } else {
      await this.finalizeRecoveredAsync(runId)
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
      conversationId: t.conversationId,
      turnId: t.turnId,
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
      sourceSha: t.sourceSha,
      canonicalBaseRef: t.canonicalBaseRef,
      excludedDirtyFiles: t.excludedDirtyFiles,
      excludedDirtyFileCount: t.excludedDirtyFileCount,
      excludedDirtyFilesTruncated: t.excludedDirtyFilesTruncated,
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

  async conflictDiffAsync(agentId: string): Promise<WorktreeConflictDiffResult> {
    const tracked = this.runs.get(agentId)
    if (
      !tracked ||
      tracked.state !== 'conflict' ||
      tracked.publication !== 'blocked' ||
      !tracked.conflictBaseSha ||
      !tracked.conflictAgentSha ||
      tracked.files.length === 0 ||
      !this.manager.readConflictDiffAsync
    ) {
      return { available: false, reason: 'not-conflict' }
    }
    return this.manager.readConflictDiffAsync(agentId, {
      files: tracked.files.map((file) => file.path),
      baseSha: tracked.conflictBaseSha,
      agentSha: tracked.conflictAgentSha
    })
  }

  /**
   * Résolution HUMAINE d'un conflit depuis le Hub : rejoue l'intégration protégée en tranchant
   * les zones en conflit, soit pour l'agent (`agent` → `-X theirs`), soit pour le workspace
   * (`mine` → `-X ours`). Aucune écriture directe dans le workspace : on repasse par `finalize`,
   * donc par la même transaction de publication (merge éphémère + fast-forward).
   */
  async resolveConflictAsync(
    runId: string,
    choice: WorktreeConflictResolutionChoice
  ): Promise<WorktreeConflictResolutionResult> {
    const tracked = this.runs.get(runId)
    if (!tracked) return { resolved: false, reason: 'invalid-agent' }
    if (tracked.state !== 'conflict' || tracked.publication !== 'blocked') {
      return { resolved: false, reason: 'not-conflict' }
    }
    const finalizeAsync = this.manager.finalizeAsync
    if (!finalizeAsync) return { resolved: false, reason: 'unsupported' }
    // Les SHA de conflit décrivent l'état BLOQUÉ. `isRecord` ne les autorise QU'avec
    // `publication: 'blocked'` ; les garder en passant à `integrating` faisait échouer le tout
    // premier `save()` de la résolution — « Manifeste de bureau invalide », mesuré le 2026-08-12
    // sur les trois conflits en attente. Le bouton de résolution ne pouvait donc JAMAIS aboutir.
    // Les SHA utiles à la fusion vivent ailleurs (`publicationAgentSha`/`publicationBaseSha`,
    // remplis par `onIntegrated`), rien n'est perdu.
    tracked.conflictBaseSha = undefined
    tracked.conflictAgentSha = undefined
    tracked.conflictFile = undefined
    this.persist(tracked, 'green', 'integrating', 'Résolution de conflit demandée depuis le Hub.')
    try {
      const res = await finalizeAsync.call(this.manager, runId, {
        baseBranch: tracked.baseBranch,
        conflictStrategy: choice === 'agent' ? 'theirs' : 'ours',
        onIntegrated: (integratedSha, agentSha, baseSha) => {
          tracked.publishedSha = integratedSha
          tracked.publicationAgentSha = agentSha
          tracked.publicationBaseSha = baseSha
        }
      })
      this.applyFinalize(tracked, res)
      this.persistFinalize(tracked, res)
      await this.acknowledgePublicationAsync(tracked, res)
      this.emit()
      if (res.outcome === 'merged') return { resolved: true, agentId: runId, outcome: 'merged' }
      if (res.outcome === 'nothing') return { resolved: true, agentId: runId, outcome: 'nothing' }
      if (res.outcome === 'conflict') return { resolved: false, reason: 'still-conflicting' }
      return {
        resolved: false,
        reason: 'blocked',
        ...(res.outcome === 'blocked' && res.detail ? { detail: res.detail } : {})
      }
    } catch (error) {
      const blocked: FinalizeResult = {
        outcome: 'blocked',
        agentId: runId,
        files: tracked.files.map((file) => file.path),
        reason: 'merge-failed',
        detail: error instanceof Error ? error.message : String(error)
      }
      this.applyFinalize(tracked, blocked)
      this.persistFinalize(tracked, blocked)
      this.emit()
      return { resolved: false, reason: 'blocked', detail: blocked.detail }
    }
  }

  async discardHeldAsync(runId: string): Promise<boolean> {
    const tracked = this.runs.get(runId)
    if (
      !tracked ||
      tracked.verdict !== 'green' ||
      tracked.publication !== 'held' ||
      !this.manager.discardAsync
    ) {
      return false
    }
    await this.manager.discardAsync(runId)
    this.runs.delete(runId)
    this.stateStore?.remove(runId)
    this.emit()
    return true
  }

  private emit(): void {
    this.onActivity?.(this.activity())
  }

  private changedFiles(runId: string): Tracked['files'] {
    try {
      return this.fileRecords(this.manager.changedFiles(runId))
    } catch {
      return []
    }
  }

  private fileRecords(paths: readonly string[]): Tracked['files'] {
    return paths.map((path) => ({ path, kind: 'mod' as const }))
  }

  private async changedFilesAsync(runId: string): Promise<Tracked['files']> {
    try {
      const paths = this.manager.changedFilesAsync
        ? await this.manager.changedFilesAsync(runId)
        : this.manager.changedFiles(runId)
      return this.fileRecords(paths)
    } catch {
      return []
    }
  }

  private async finishPublicationCallbacks(
    tracked: Tracked,
    result: FinalizeResult,
    preparedPublication: { baseSha: string; agentSha: string } | undefined
  ): Promise<void> {
    const runId = tracked.runId
    const callbacks = this.publicationCallbacks.get(runId)
    const published =
      result.outcome === 'merged' ||
      result.outcome === 'nothing' ||
      result.outcome === 'cleanup-pending' ||
      result.outcome === 'published-residue'
    const exactPublication =
      result.outcome === 'merged' && result.baseSha && result.publishedSha
        ? { baseSha: result.baseSha, agentSha: result.publishedSha }
        : result.outcome === 'cleanup-pending' || result.outcome === 'published-residue'
          ? (result.baseSha ?? preparedPublication?.baseSha ?? tracked.publicationBaseSha)
            ? {
                baseSha:
                  result.baseSha ?? preparedPublication?.baseSha ?? tracked.publicationBaseSha!,
                agentSha: result.publishedSha
              }
            : undefined
          : preparedPublication
    if (published && exactPublication && tracked.causalPublicationDeliveredAtMs === undefined) {
      try {
        if (callbacks?.onPublished) {
          await callbacks.onPublished(exactPublication)
        } else if (this.onRecoveredPublication) {
          await this.onRecoveredPublication({
            runId,
            ...(tracked.task ? { task: tracked.task } : {}),
            conversationId: tracked.conversationId,
            turnId: tracked.turnId,
            causalWatchPaths: tracked.causalWatchPaths ?? [],
            ...exactPublication
          })
        } else {
          return
        }
      } catch {
        // Le manifeste reste non acquitté : le prochain démarrage rejouera la publication.
        return
      }
      tracked.causalPublicationDeliveredAtMs = this.now()
      this.persistFinalize(tracked, result)
    }
    const retryable =
      result.outcome === 'cleanup-pending' ||
      (result.outcome === 'blocked' && result.reason === 'base-in-progress')
    if (published || !retryable) this.publicationCallbacks.delete(runId)
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
    if (res.outcome === 'merged' && res.publishedSha) tracked.publishedSha = res.publishedSha
    if (res.outcome === 'cleanup-pending') {
      tracked.publishedSha = res.publishedSha
      tracked.publicationAgentSha = res.agentSha ?? tracked.publicationAgentSha ?? res.publishedSha
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
      tracked.publicationAgentSha = res.agentSha ?? tracked.publicationAgentSha ?? res.publishedSha
      tracked.worktreeAvailable = true
      tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
      tracked.attentionReason = 'post-publish-change'
    }
    if (res.outcome === 'blocked') {
      tracked.attentionReason = res.reason
      if (res.reason !== 'base-in-progress' && !res.preserveAgentFiles) {
        tracked.files = res.files.map((path) => ({ path, kind: 'mod' as const }))
      }
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
      ...(tracked.turnId ? { turnId: tracked.turnId } : {}),
      ...(tracked.causalWatchPaths?.length
        ? { causalWatchPaths: [...tracked.causalWatchPaths] }
        : {}),
      worktreePath: tracked.worktreePath ?? previous?.worktreePath ?? '',
      worktreeAvailable: tracked.worktreeAvailable ?? previous?.worktreeAvailable,
      baseBranch: tracked.baseBranch ?? previous?.baseBranch ?? '',
      baseSha: tracked.baseSha ?? previous?.baseSha ?? '',
      ...((tracked.sourceSha ?? previous?.sourceSha)
        ? { sourceSha: tracked.sourceSha ?? previous?.sourceSha }
        : {}),
      ...((tracked.canonicalBaseRef ?? previous?.canonicalBaseRef)
        ? { canonicalBaseRef: tracked.canonicalBaseRef ?? previous?.canonicalBaseRef }
        : {}),
      ...((tracked.excludedDirtyFiles ?? previous?.excludedDirtyFiles)?.length
        ? { excludedDirtyFiles: tracked.excludedDirtyFiles ?? previous?.excludedDirtyFiles }
        : {}),
      ...((tracked.excludedDirtyFileCount ?? previous?.excludedDirtyFileCount) !== undefined
        ? {
            excludedDirtyFileCount:
              tracked.excludedDirtyFileCount ?? previous?.excludedDirtyFileCount
          }
        : {}),
      ...((tracked.excludedDirtyFilesTruncated ?? previous?.excludedDirtyFilesTruncated) !==
      undefined
        ? {
            excludedDirtyFilesTruncated:
              tracked.excludedDirtyFilesTruncated ?? previous?.excludedDirtyFilesTruncated
          }
        : {}),
      verdict,
      publication,
      files: tracked.files,
      ...(tracked.conflictFile ? { conflictFile: tracked.conflictFile } : {}),
      ...(tracked.conflictBaseSha ? { conflictBaseSha: tracked.conflictBaseSha } : {}),
      ...(tracked.conflictAgentSha ? { conflictAgentSha: tracked.conflictAgentSha } : {}),
      ...(tracked.publishedSha ? { publishedSha: tracked.publishedSha } : {}),
      ...(tracked.publicationAgentSha ? { publicationAgentSha: tracked.publicationAgentSha } : {}),
      ...(tracked.publicationBaseSha ? { publicationBaseSha: tracked.publicationBaseSha } : {}),
      ...(tracked.causalPublicationDeliveredAtMs !== undefined
        ? { causalPublicationDeliveredAtMs: tracked.causalPublicationDeliveredAtMs }
        : {}),
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

  private publicationShaToAcknowledge(
    tracked: Tracked,
    result: FinalizeResult
  ): string | undefined {
    if (
      result.outcome !== 'merged' &&
      result.outcome !== 'cleanup-pending' &&
      result.outcome !== 'published-residue'
    ) {
      return undefined
    }
    return result.publishedSha ?? tracked.publishedSha
  }

  private acknowledgePublication(tracked: Tracked, result: FinalizeResult): void {
    const publishedSha = this.publicationShaToAcknowledge(tracked, result)
    if (!publishedSha || !this.manager.acknowledgePublication) return
    try {
      this.manager.acknowledgePublication(tracked.runId, publishedSha)
    } catch {
      // L'ancre restante est sûre et sera acquittée lors d'une reprise ultérieure.
    }
  }

  private async acknowledgePublicationAsync(
    tracked: Tracked,
    result: FinalizeResult
  ): Promise<void> {
    const publishedSha = this.publicationShaToAcknowledge(tracked, result)
    if (!publishedSha) return
    try {
      if (this.manager.acknowledgePublicationAsync) {
        await this.manager.acknowledgePublicationAsync(tracked.runId, publishedSha)
      } else {
        this.manager.acknowledgePublication?.(tracked.runId, publishedSha)
      }
    } catch {
      // L'ancre restante est sûre et sera acquittée lors d'une reprise ultérieure.
    }
  }

  /**
   * Au redémarrage, le worktree Git est la source durable : on reprend chaque copie agent.
   * Une copie intégrable est fusionnée/nettoyée ; un conflit reste intact et redevient visible.
   */
  /**
   * La réconciliation avec son étape coûteuse rendue non bloquante.
   *
   * MESURÉ sur 52 copies : le balayage des copies abandonnées pesait 19,7 s des 23 s totales, et
   * balayait 0 copie — du ramassage opportuniste dont rien n'attend le résultat. La boucle des runs,
   * elle, ne pèse que ~4 s et reste synchrone : la découper n'aurait acheté qu'un sixième du gain
   * pour un contrat bien plus large à casser.
   */
  /**
   * Le balayage des copies abandonnées, appelable HORS du démarrage.
   *
   * Le correctif de préservation (2026-08-14) rend les copies porteuses de travail enfin libérables,
   * mais il ne changeait pas le MOMENT où on les regarde : le balayage ne tournait qu'au lancement,
   * donc une copie abandonnée à 9 h attendait le prochain démarrage. Sur une session qui dure la
   * journée, le disque se remplissait pendant qu'un mécanisme capable de le rendre existait et dormait.
   *
   * Aucune garde n'est assouplie au passage. Le démarrage était sûr par construction — aucun run ne
   * tourne — mais ce qui protège un run vivant EN SESSION, c'est le balayage lui-même : âge minimal de
   * 24 h calculé sur la mtime du dossier (un run qui écrit ne peut donc jamais paraître abandonné) et
   * lease PID par-dessus. Ces gardes sont des prédicats en lecture seule ; les consulter plus souvent
   * change la date du verdict, pas le verdict.
   *
   * Les erreurs sont AVALÉES et rendues comme « rien balayé » : c'est du ramassage opportuniste dont
   * rien n'attend le résultat, et un rejet remontant dans un minuteur deviendrait un rejet non capturé
   * à chaque tour d'horloge.
   */
  /**
   * Libere UNE copie en PRESERVANT son travail — la voie sure, exposee a l'interface.
   *
   * `discard` existe deja mais SUPPRIME sans preserver : il ne passe pas par la branche de
   * recuperation. Pour un menage a l'initiative de l'utilisateur (« fais le tri »), c'est le mauvais
   * outil : 11 des copies mesurees le 2026-08-17 portaient des fichiers non committes.
   *
   * Ici le travail est d'abord committe sur `autowin/recovery/<agentId>`, donc restaurable par
   * `git worktree add`, et la copie n'est liberee qu'ensuite. Un refus (processus vivant, depot
   * etranger, preservation impossible) laisse la copie INTACTE.
   */
  preserverEtLiberer(agentId: string): { outcome: string; branche?: string; detail?: string } {
    const manager = this.manager as unknown as {
      preserverEtLiberer?: (id: string) => { outcome: string; branche?: string; detail?: string }
    }
    if (!manager.preserverEtLiberer) return { outcome: 'refuse', detail: 'capacite indisponible' }
    return manager.preserverEtLiberer(agentId)
  }

  async balayerLesCopiesAbandonnees(): Promise<string[]> {
    try {
      return (await this.manager.sweepAbandonedAgentCopiesAsync?.()) ?? []
    } catch {
      return []
    }
  }

  private async reconcileExistingAsync(): Promise<void> {
    const residues = this.manager.reconcileResiduesAsync
      ? await this.manager.reconcileResiduesAsync()
      : this.manager.reconcileResidues?.()
    this.reconcileExisting(undefined, residues)
  }

  private reconcileExisting(
    inventory?: WorktreeRecoveryInventory,
    residuesPrecalcules?: ReturnType<WorktreeManager['reconcileResidues']>
  ): void {
    // `??` et non `||` : des résidus déjà calculés mais VIDES ne doivent pas relancer le balayage.
    const residues =
      inventory?.residues ?? residuesPrecalcules ?? this.manager.reconcileResidues?.()
    const records = new Map((this.stateStore?.list() ?? []).map((record) => [record.runId, record]))
    const observed = new Map(inventory?.agents.map((agent) => [agent.agentId, agent]) ?? [])
    const managerIds =
      inventory?.agents.map((agent) => agent.agentId) ?? this.manager.listAgentIds()
    const ids = [
      ...managerIds,
      ...[...records.keys()].filter((runId) => !managerIds.includes(runId))
    ]
    for (const runId of ids) {
      const record = records.get(runId)
      let orphanContext = observed.get(runId)?.context
      if (!record && !inventory) {
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
      if (
        inventory ? (observed.get(runId)?.active ?? false) : this.manager.hasActiveProcesses(runId)
      ) {
        const timestamp = record?.createdAtMs ?? this.now()
        this.runs.set(runId, {
          runId,
          agentName: record?.agentName ?? 'Agent récupéré',
          isMutation: true,
          startedAtMs: timestamp,
          state: 'working',
          files: inventory
            ? this.fileRecords(observed.get(runId)?.changedFiles ?? [])
            : this.changedFiles(runId),
          task: record?.task,
          role: record?.role,
          conversationId: record?.conversationId,
          turnId: record?.turnId,
          causalWatchPaths: record?.causalWatchPaths,
          worktreePath: record?.worktreePath ?? orphanContext?.worktreePath,
          worktreeAvailable: record?.worktreeAvailable,
          workspacePath: orphanContext?.workspacePath,
          baseBranch: record?.baseBranch ?? orphanContext?.baseBranch,
          baseSha: record?.baseSha ?? orphanContext?.baseSha,
          sourceSha: record?.sourceSha ?? orphanContext?.sourceSha,
          canonicalBaseRef: record?.canonicalBaseRef ?? orphanContext?.canonicalBaseRef,
          excludedDirtyFiles: record?.excludedDirtyFiles ?? orphanContext?.excludedDirtyFiles,
          excludedDirtyFileCount:
            record?.excludedDirtyFileCount ?? orphanContext?.excludedDirtyFileCount,
          excludedDirtyFilesTruncated:
            record?.excludedDirtyFilesTruncated ?? orphanContext?.excludedDirtyFilesTruncated,
          conflictBaseSha: record?.conflictBaseSha,
          conflictAgentSha: record?.conflictAgentSha,
          publishedSha: record?.publishedSha,
          publicationAgentSha: record?.publicationAgentSha,
          publicationBaseSha: record?.publicationBaseSha,
          causalPublicationDeliveredAtMs: record?.causalPublicationDeliveredAtMs,
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
        if (inventory)
          void this.finalizeRecoveredAsync(runId)
            .catch((error) => this.recordRecoveryFailure(error))
            .finally(() => {
              this.emit()
              this.scheduleRecoveryRetry()
            })
        else this.finalizeRecovered(runId)
      } else {
        const timestamp = record?.createdAtMs ?? this.now()
        const tracked: Tracked = {
          runId,
          agentName: record?.agentName ?? 'Agent récupéré',
          isMutation: true,
          startedAtMs: timestamp,
          endedAtMs: record?.updatedAtMs ?? timestamp,
          // L'etat suivait `publication` en IGNORANT le verdict : un run coupe par un arret de
          // l'application (verdict `interrupted`, publication `blocked`) devenait « bloque ».
          // Mesure du 2026-08-12 : 118 bureaux sur 218 dans ce cas, pour 7 vrais cas a traiter.
          state: !record
            ? 'blocked'
            : record.publication === 'complete'
              ? 'merged'
              : record.publication === 'blocked' &&
                  record.conflictBaseSha &&
                  record.conflictAgentSha
                ? 'conflict'
                : record.verdict === 'interrupted' || record.verdict === 'running'
                  ? 'interrupted'
                  : record.publication === 'blocked'
                    ? 'blocked'
                    : 'ready',
          files: record?.files.length
            ? record.files
            : inventory
              ? this.fileRecords(observed.get(runId)?.changedFiles ?? [])
              : this.changedFiles(runId),
          task: record?.task,
          role: record?.role,
          conversationId: record?.conversationId,
          turnId: record?.turnId,
          causalWatchPaths: record?.causalWatchPaths,
          worktreePath: record?.worktreePath ?? orphanContext?.worktreePath,
          worktreeAvailable: record?.worktreeAvailable,
          workspacePath: orphanContext?.workspacePath,
          baseBranch: record?.baseBranch ?? orphanContext?.baseBranch,
          baseSha: record?.baseSha ?? orphanContext?.baseSha,
          sourceSha: record?.sourceSha ?? orphanContext?.sourceSha,
          canonicalBaseRef: record?.canonicalBaseRef ?? orphanContext?.canonicalBaseRef,
          excludedDirtyFiles: record?.excludedDirtyFiles ?? orphanContext?.excludedDirtyFiles,
          excludedDirtyFileCount:
            record?.excludedDirtyFileCount ?? orphanContext?.excludedDirtyFileCount,
          excludedDirtyFilesTruncated:
            record?.excludedDirtyFilesTruncated ?? orphanContext?.excludedDirtyFilesTruncated,
          conflictFile: record?.conflictFile,
          conflictBaseSha: record?.conflictBaseSha,
          conflictAgentSha: record?.conflictAgentSha,
          publishedSha: record?.publishedSha,
          publicationAgentSha: record?.publicationAgentSha,
          publicationBaseSha: record?.publicationBaseSha,
          causalPublicationDeliveredAtMs: record?.causalPublicationDeliveredAtMs,
          // Un run interrompu n'a subi AUCUNE fusion : ne lui invente pas `merge-failed`.
          attentionReason: !record
            ? 'merge-failed'
            : ((record.attentionReason as Tracked['attentionReason']) ??
              (record.publication === 'blocked' &&
              record.verdict !== 'interrupted' &&
              record.verdict !== 'running'
                ? 'merge-failed'
                : undefined)),
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
        if (record?.verdict === 'green' && record.publication === 'complete') {
          this.finishRecoveredCompletedPublication(tracked)
        }
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

  private recordRecoveryFailure(error: unknown): void {
    const timestamp = this.now()
    this.runs.set('recovery-inventory', {
      runId: 'recovery-inventory',
      agentName: 'Récupération Git',
      isMutation: true,
      startedAtMs: timestamp,
      endedAtMs: timestamp,
      state: 'blocked',
      files: [],
      attentionReason: 'merge-failed',
      verdict: 'unknown',
      publication: 'blocked',
      recovered: true,
      detail: error instanceof Error ? error.message : String(error)
    })
    this.emit()
  }

  private finishRecoveredCompletedPublication(tracked: Tracked): void {
    if (
      tracked.causalPublicationDeliveredAtMs !== undefined ||
      !tracked.publicationBaseSha ||
      !tracked.publishedSha ||
      !this.onRecoveredPublication
    )
      return
    try {
      const delivery = this.onRecoveredPublication({
        runId: tracked.runId,
        ...(tracked.task ? { task: tracked.task } : {}),
        conversationId: tracked.conversationId,
        turnId: tracked.turnId,
        causalWatchPaths: tracked.causalWatchPaths ?? [],
        baseSha: tracked.publicationBaseSha,
        agentSha: tracked.publishedSha
      })
      const acknowledge = (): void => {
        tracked.causalPublicationDeliveredAtMs = this.now()
        this.persist(tracked, 'green', 'complete', tracked.detail)
        this.emit()
      }
      if (delivery && typeof delivery.then === 'function') {
        void delivery.then(acknowledge).catch(() => undefined)
      } else {
        acknowledge()
      }
    } catch {
      // L'absence d'acquittement garde la publication rejouable au prochain démarrage.
    }
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
        // Source unique partagée avec la vue : un run coupé par un arrêt de l'app est
        // « interrompu », pas « bloqué · merge-failed » — aucune fusion n'a été tentée.
        const etat = etatBureauRecupere({
          verdict: record.verdict,
          attentionReason: record.attentionReason as Tracked['attentionReason']
        })
        tracked.state = etat.state
        tracked.attentionReason = etat.attentionReason
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
      turnId: record?.turnId,
      causalWatchPaths: record?.causalWatchPaths,
      worktreePath: record?.worktreePath,
      worktreeAvailable: record?.worktreeAvailable,
      baseBranch: record?.baseBranch,
      baseSha: record?.baseSha,
      sourceSha: record?.sourceSha,
      canonicalBaseRef: record?.canonicalBaseRef,
      excludedDirtyFiles: record?.excludedDirtyFiles,
      excludedDirtyFileCount: record?.excludedDirtyFileCount,
      excludedDirtyFilesTruncated: record?.excludedDirtyFilesTruncated,
      conflictBaseSha: record?.conflictBaseSha,
      conflictAgentSha: record?.conflictAgentSha,
      publishedSha: record?.publishedSha,
      publicationAgentSha: record?.publicationAgentSha,
      publicationBaseSha: record?.publicationBaseSha,
      causalPublicationDeliveredAtMs: record?.causalPublicationDeliveredAtMs,
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
        sourceSha: record.sourceSha,
        canonicalBaseRef: record.canonicalBaseRef,
        excludedDirtyFiles: record.excludedDirtyFiles,
        publication: recoveryPublication as
          'pending' | 'integrating' | 'published' | 'cleanup-pending',
        ...(recoveryPublishedSha ? { publishedSha: recoveryPublishedSha } : {}),
        ...(record.publicationAgentSha ? { agentSha: record.publicationAgentSha } : {})
      })
      if (!validation.ok) {
        tracked.state = 'blocked'
        tracked.attentionReason = 'merge-failed'
        this.persist(tracked, 'green', 'blocked', validation.detail)
        return
      }
      if (validation.publishedSha) {
        tracked.publishedSha = validation.publishedSha
        this.persist(tracked, 'green', 'integrating')
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
      let preparedPublication: { baseSha: string; agentSha: string } | undefined =
        publicationCanOnlyNeedCleanup && publishedSha
          ? {
              baseSha: record?.publicationBaseSha ?? tracked.publicationBaseSha ?? '',
              agentSha: publishedSha
            }
          : undefined
      if (!preparedPublication?.baseSha) preparedPublication = undefined
      const cleanupAgentSha =
        record?.publicationAgentSha ?? tracked.publicationAgentSha ?? publishedSha
      const result =
        (publicationCanOnlyNeedCleanup ||
          tracked.publication === 'cleanup-pending' ||
          tracked.publication === 'published') &&
        publishedSha &&
        this.manager.cleanupPublished
          ? this.manager.cleanupPublished(
              runId,
              publishedSha,
              record?.baseBranch ?? tracked.baseBranch,
              ...(cleanupAgentSha && cleanupAgentSha !== publishedSha ? [cleanupAgentSha] : [])
            )
          : this.manager.finalize(runId, {
              ...((record?.baseBranch ?? tracked.baseBranch)
                ? { baseBranch: record?.baseBranch ?? tracked.baseBranch }
                : {}),
              ...((record?.publicationAgentSha ?? tracked.publicationAgentSha)
                ? {
                    expectedAgentSha: record?.publicationAgentSha ?? tracked.publicationAgentSha
                  }
                : {}),
              onPrepared: (agentSha, baseSha) => {
                tracked.publicationAgentSha = agentSha
                tracked.publicationBaseSha = baseSha
                this.persist(tracked, 'green', 'integrating')
                preparedPublication = { baseSha, agentSha }
                this.publicationCallbacks.get(runId)?.onPrepared?.(preparedPublication)
              },
              onIntegrated: (integratedSha, agentSha, baseSha) => {
                tracked.publishedSha = integratedSha
                tracked.publicationAgentSha = agentSha
                tracked.publicationBaseSha = baseSha
                this.persist(tracked, 'green', 'integrating')
                preparedPublication = { baseSha, agentSha: integratedSha }
              }
            })
      this.applyFinalize(tracked, result)
      this.persistFinalize(tracked, result)
      this.acknowledgePublication(tracked, result)
      void this.finishPublicationCallbacks(tracked, result, preparedPublication)
    } catch {
      tracked.state = 'blocked'
      tracked.attentionReason = 'merge-failed'
      this.persist(tracked, 'green', 'blocked')
    }
  }

  private async finalizeRecoveredAsync(runId: string): Promise<void> {
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
        // Source unique partagée avec la vue : un run coupé par un arrêt de l'app est
        // « interrompu », pas « bloqué · merge-failed » — aucune fusion n'a été tentée.
        const etat = etatBureauRecupere({
          verdict: record.verdict,
          attentionReason: record.attentionReason as Tracked['attentionReason']
        })
        tracked.state = etat.state
        tracked.attentionReason = etat.attentionReason
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
      files: await this.changedFilesAsync(runId),
      task: record?.task,
      role: record?.role,
      conversationId: record?.conversationId,
      turnId: record?.turnId,
      causalWatchPaths: record?.causalWatchPaths,
      worktreePath: record?.worktreePath,
      worktreeAvailable: record?.worktreeAvailable,
      baseBranch: record?.baseBranch,
      baseSha: record?.baseSha,
      sourceSha: record?.sourceSha,
      canonicalBaseRef: record?.canonicalBaseRef,
      excludedDirtyFiles: record?.excludedDirtyFiles,
      excludedDirtyFileCount: record?.excludedDirtyFileCount,
      excludedDirtyFilesTruncated: record?.excludedDirtyFilesTruncated,
      conflictBaseSha: record?.conflictBaseSha,
      conflictAgentSha: record?.conflictAgentSha,
      publishedSha: record?.publishedSha,
      publicationAgentSha: record?.publicationAgentSha,
      publicationBaseSha: record?.publicationBaseSha,
      causalPublicationDeliveredAtMs: record?.causalPublicationDeliveredAtMs,
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
      const context = {
        worktreePath: record.worktreePath,
        baseBranch: record.baseBranch,
        baseSha: record.baseSha,
        sourceSha: record.sourceSha,
        canonicalBaseRef: record.canonicalBaseRef,
        excludedDirtyFiles: record.excludedDirtyFiles,
        publication: recoveryPublication as
          'pending' | 'integrating' | 'published' | 'cleanup-pending',
        ...(recoveryPublishedSha ? { publishedSha: recoveryPublishedSha } : {}),
        ...(record.publicationAgentSha ? { agentSha: record.publicationAgentSha } : {})
      }
      const validation = this.manager.validateRecoveryContextAsync
        ? await this.manager.validateRecoveryContextAsync(runId, context)
        : this.manager.validateRecoveryContext(runId, context)
      if (!validation.ok) {
        tracked.state = 'blocked'
        tracked.attentionReason = 'merge-failed'
        this.persist(tracked, 'green', 'blocked', validation.detail)
        return
      }
      if (validation.publishedSha) {
        tracked.publishedSha = validation.publishedSha
        this.persist(tracked, 'green', 'integrating')
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
      let preparedPublication: { baseSha: string; agentSha: string } | undefined =
        publicationCanOnlyNeedCleanup && publishedSha
          ? {
              baseSha: record?.publicationBaseSha ?? tracked.publicationBaseSha ?? '',
              agentSha: publishedSha
            }
          : undefined
      if (!preparedPublication?.baseSha) preparedPublication = undefined
      const baseBranch = record?.baseBranch ?? tracked.baseBranch
      const cleanupAgentSha =
        record?.publicationAgentSha ?? tracked.publicationAgentSha ?? publishedSha
      const result =
        (publicationCanOnlyNeedCleanup ||
          tracked.publication === 'cleanup-pending' ||
          tracked.publication === 'published') &&
        publishedSha &&
        this.manager.cleanupPublishedAsync
          ? await this.manager.cleanupPublishedAsync(
              runId,
              publishedSha,
              baseBranch,
              ...(cleanupAgentSha && cleanupAgentSha !== publishedSha ? [cleanupAgentSha] : [])
            )
          : this.manager.finalizeAsync
            ? await this.manager.finalizeAsync(runId, {
                ...(baseBranch ? { baseBranch } : {}),
                ...((record?.publicationAgentSha ?? tracked.publicationAgentSha)
                  ? {
                      expectedAgentSha: record?.publicationAgentSha ?? tracked.publicationAgentSha
                    }
                  : {}),
                onPrepared: (agentSha, baseSha) => {
                  tracked.publicationAgentSha = agentSha
                  tracked.publicationBaseSha = baseSha
                  this.persist(tracked, 'green', 'integrating')
                  preparedPublication = { baseSha, agentSha }
                  this.publicationCallbacks.get(runId)?.onPrepared?.(preparedPublication)
                },
                onIntegrated: (integratedSha, agentSha, baseSha) => {
                  tracked.publishedSha = integratedSha
                  tracked.publicationAgentSha = agentSha
                  tracked.publicationBaseSha = baseSha
                  this.persist(tracked, 'green', 'integrating')
                  preparedPublication = { baseSha, agentSha: integratedSha }
                }
              })
            : this.manager.finalize(runId, {
                ...(baseBranch ? { baseBranch } : {}),
                ...(publishedSha ? { expectedAgentSha: publishedSha } : {})
              })
      this.applyFinalize(tracked, result)
      this.persistFinalize(tracked, result)
      await this.acknowledgePublicationAsync(tracked, result)
      await this.finishPublicationCallbacks(tracked, result, preparedPublication)
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
      if (this.manager.operationsAreIsolated?.()) {
        void this.retryRecoveryAsync().catch((error) => this.recordRecoveryFailure(error))
      } else this.retryRecovery()
    }, 5_000)
    this.recoveryTimer.unref?.()
  }
}
