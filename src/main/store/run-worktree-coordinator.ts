import { pendantOperation } from '../gel-main'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { VerdictBureau } from './verdict-bureau'
import { WorktreeManager, type FinalizeResult, type WorktreeRunContext } from './worktree-manager'
import { delaiDeReprise, ESSAIS_MAX } from './delai-de-reprise'
import { CAUSES_REESSAYABLES } from './repechage-automatique'
import { INTERVALLE_BALAYAGE_MS, travauxARepecher } from './repechage-automatique'
import { avertissementCollisionProbable } from './avertissement-collision-probable'
import {
  messageSansSigneDeVie,
  runsSansSigneDeVie,
  SILENCE_SUSPECT_MS
} from './run-sans-signe-de-vie'
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
        | 'commitDejaReference'
        | 'commitsDejaReferences'
        | 'travauxNonPublies'
        | 'bureauPeutPorterDuTravail'
        | 'marquerTravailTrie'
        | 'oublierTravailTrie'
        | 'shaTravailTrie'
        | 'apercuTravauxNonPublies'
        | 'patchTravailNonPublie'
        | 'restaurerCopieDepuisSecours'
        // Ranger une copie en PRESERVANT son travail. Absent de cette liste, l'appel compilait
        // quand meme (`?.()`) mais `npm run typecheck` le refusait -- vitest ne typecheck pas, la
        // suite etait donc verte sur du code qui ne compilait pas.
        | 'preserverEtLiberer'
        | 'balayerLesCoquilles'
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
        | 'recensementNonPubliesAsync'
        | 'baseDirtyFiles'
      >
    >
  stateStore?: WorktreeRunStateStore
  nowFn?: () => number
  /** Appelé à chaque changement d'activité → l'app pousse vers le renderer (IPC). */
  onActivity?: (activity: WorktreeAgentActivity[]) => void
  /**
   * Un refus d'integration vient de se produire. Emis a CHAQUE tentative, y compris les reessais :
   * le consommateur distingue incidents (agentId distincts) et churn (evenements). Existe parce que
   * RIEN ne comptait ces refus — cadrage du 2026-08-22, trois instruments essayes, trois invalides.
   */
  /**
   * PREVENIR quand un travail est ABANDONNE apres epuisement des reprises.
   *
   * Verifie le 2026-08-23 : aucune notification n'existait dans toute l'application. Un travail
   * fini pouvait donc mourir en silence, et trois l'ont fait le meme jour. Le seuil est
   * DELIBERE -- l'abandon, jamais un refus ordinaire : les traces comptent 1649 refus, et en
   * notifier une fraction noierait le signal.
   */
  onAbandon?: (info: { runId: string; tache?: string; raison?: string }) => void
  onRefusIntegration?: (refus: {
    cause: string
    agentId: string
    files: readonly string[]
    tentative: number
    detail?: string
  }) => void
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
  /**
   * Dernier signe de vie observe. Ecrit a CHAQUE `persist`, c'est-a-dire a chaque changement d'etat
   * reellement enregistre -- le seul battement dont ce niveau dispose. Sans lui, un run `working`
   * etait indistinguable d'un run mort : mesure le 2026-08-24, un run l'a affiche six minutes.
   */
  derniereVieMs?: number
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

/**
 * Le nombre d'essais n'est plus un chiffre isole : il DECOULE du bareme d'attentes
 * (`delai-de-reprise.ts`). Deux verites separees auraient diverge au premier reglage -- l'une
 * disant « six essais », l'autre en proposant sept delais.
 */
const MAX_AUTOMATIC_RETRIES = ESSAIS_MAX

/**
 * Le repli quand le bareme ne propose plus rien (tous les runs en attente ont epuise leurs essais)
 * : on garde une minuterie COURTE plutot qu'aucune. `waitingForProcess` contient aussi des runs qui
 * attendent la fin d'un processus, pas un reessai -- les laisser sans reveil les figerait.
 */
const DELAIS_REPRISE_PLANCHER = 5_000
/**
 * Les publications qu'une reprise peut encore reveiller — donc dont le manifeste porte encore une
 * information vivante, meme si la copie a disparu du disque.
 */
const ETATS_ENCORE_RECUPERABLES: ReadonlySet<string> = new Set([
  'pending',
  'integrating',
  'published',
  'cleanup-pending',
  'complete',
  'held'
])

/**
 * La copie est-elle encore sur disque ? `undefined` quand la question n'a pas de sens (aucun chemin
 * connu) : on ne repond jamais `false` faute d'information -- ce serait affirmer une disparition.
 */
function copiePresente(worktreePath: string | undefined): boolean | undefined {
  if (!worktreePath) return undefined
  try {
    return existsSync(worktreePath)
  } catch {
    // Un disque qui refuse de repondre ne prouve pas une disparition.
    return undefined
  }
}

/**
 * Les causes de blocage qu'un utilisateur peut REESSAYER a la main.
 *
 * UNE SEULE definition, et c'est le point : la regle vivait en double, recopiee a l'identique dans
 * `retryRun` et `retryRunAsync`. Corriger l'une laissait l'autre — verifie le 2026-08-26, le
 * correctif pose sur la variante synchrone n'a rien change au bouton, qui passe par l'asynchrone.
 *
 * TOUTES ces causes se reparent HORS de l'app, donc toutes doivent rendre la porte. N'en admettre
 * que deux fermait celle du refus LE PLUS FREQUENT : observe en direct, une edition refusee en
 * `base-dirty` laissait un bureau « A reprendre » et un message qui promet « puis « Reprendre » pour
 * republier », alors que le bouton rendait `undefined` et ne faisait RIEN. Le renderer n'en regarde
 * pas le resultat, donc l'ecran ne disait rien non plus : clic reel, aucune erreur, aucun changement.
 * L'app promettait un geste inoperant — et c'est ainsi qu'on refait un travail deja ecrit.
 *
 * `base-dirty` et `base-in-progress` se reparent comme `merge-failed` : l'utilisateur committe ou
 * range sa base, attend la fin de l'operation en cours, puis republie. `delai-de-reprise.ts` note
 * leur frequence — « 216 refus base-in-progress contre 86 base-dirty » : ce sont precisement les
 * deux qui avaient le plus besoin de cette porte.
 *
 * La garde qui compte reste entiere : `verdict === 'red'` interdit toujours, et `discardHeld` — la
 * porte qui DETRUIT — n'est pas touchee. On desserre ce qui RECUPERE, jamais ce qui efface.
 */
// La liste vit desormais dans `repechage-automatique.ts`, avec le balayage qui la lit aussi :
// une seule definition, donc plus de derive possible entre le bouton et la boucle automatique.

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
  private readonly onAbandon?: RunWorktreeCoordinatorDeps['onAbandon']
  private readonly onRefusIntegration?: RunWorktreeCoordinatorDeps['onRefusIntegration']
  private readonly onRecoveredPublication?: RunWorktreeCoordinatorDeps['onRecoveredPublication']
  private readonly stateStore?: WorktreeRunStateStore
  private readonly runs = new Map<string, Tracked>()
  private readonly waitingForProcess = new Set<string>()
  private readonly waitingForRetry = new Set<string>()
  private readonly retryCounts = new Map<string, number>()
  private readonly resumeClaims = new Set<string>()
  /** Quand chaque run a été repêché AUTOMATIQUEMENT pour la dernière fois, pour ne pas le marteler. */
  private readonly derniersRepechages = new Map<string, number>()
  /**
   * Combien de fois le BALAYAGE a retente chaque run. Distinct de `retryCounts`, que `retryRunAsync`
   * remet a zero a chaque appel -- ce qui privait le balayage de tout plafond et l'a fait recreer
   * 682 Mo de copies pour des travaux impubliables.
   */
  private readonly essaisAutomatiques = new Map<string, number>()
  private recoveryTimer?: ReturnType<typeof setTimeout>
  private balayageTimer?: ReturnType<typeof setInterval>

  constructor(deps: RunWorktreeCoordinatorDeps) {
    this.manager = deps.manager
    this.now = deps.nowFn ?? Date.now
    this.onActivity = deps.onActivity
    this.onRefusIntegration = deps.onRefusIntegration
    this.onAbandon = deps.onAbandon
    this.onRecoveredPublication = deps.onRecoveredPublication
    this.stateStore = deps.stateStore
    /*
     * ARMER LE FILET DES LA CONSTRUCTION, et pas depuis un point de cablage lointain.
     *
     * Le cas reellement observe est « l'app demarre et quatorze travaux dorment deja » : aucun run
     * ne se termine, donc aucun evenement ne viendrait declencher un repechage. Un filet qu'il faut
     * penser a tendre est un filet qu'on oublie de tendre -- c'est exactement ainsi que
     * `retryRunAsync` s'est retrouve sans le moindre appelant automatique.
     */
    this.demarrerLeBalayageAutomatique()
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
        //
        // Le `.catch` final n'est pas décoratif, et son absence a coûté. `reconcileExistingAsync`
        // énumère les copies via `execFileSync('git', ...)` : il PEUT jeter, typiquement quand son
        // `cwd` a disparu. Sans ce maillon, le rejet devenait une rejection NON GÉRÉE — mesuré le
        // 2026-08-20 : `npm run test:unit` sortait en exit 1 avec 7183 tests VERTS et une seule ligne
        // « spawnSync git ENOENT », et en production l'échec passait entièrement sous silence. La
        // branche isolée quelques lignes plus haut chaînait pourtant déjà `recordRecoveryFailure` :
        // c'était une asymétrie, pas une décision.
        //
        // On ENREGISTRE, on n'avale pas : un `catch` vide aurait fait taire le symptôme en laissant
        // la récupération échouer sans trace, soit exactement ce que `recordRecoveryFailure` existe
        // pour empêcher.
        void attendre
          .then(
            () => this.reconcileExistingAsync(),
            () => this.reconcileExistingAsync()
          )
          .catch((error) => this.recordRecoveryFailure(error))
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
          /*
           * NE PAS GARDER UNE COPIE QUE LA GARDE CONDAMNE POUR DE BON.
           *
           * MESURE le 2026-08-24 sur l'app reelle : vingt-et-une copies occupaient le disque et
           * polluaient le Hub, toutes refusees pour ascendance rompue. Le verdict etait connu a
           * CHAQUE tentative, et on n'en faisait rien -- la copie restait, et le demarrage la
           * restaurait meme depuis sa branche de secours. C'est l'« usine a worktrees ».
           *
           * On ne touche PAS au verdict de la garde : elle a raison de refuser, verifie a la main.
           * On agit seulement sur ce qu'on en FAIT. Et on ne perd rien : `preserverEtLiberer` met
           * le travail a l'abri sur `autowin/recovery/<id>` avant de rendre le disque, et garde la
           * copie si la preservation echoue.
           *
           * On refuse toujours la reprise juste apres : elle a genuinement echoue.
           */
          if (!validation.ok && validation.definitif) this.libererLaCopieEnConflit(runId)
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
        // MEME avertissement que dans `beginAsync` : deux chemins de demarrage existent, et n'en
        // cabler qu'un donnerait un avertissement qui apparait ou non selon la route prise — pire
        // qu'une absence, parce qu'on croirait l'arbre propre quand c'est la route qui se taisait.
        const avertissementSync = avertissementCollisionProbable(tracked.excludedDirtyFiles, {
          total: tracked.excludedDirtyFileCount,
          tronquee: tracked.excludedDirtyFilesTruncated
        })
        if (avertissementSync) tracked.detail = avertissementSync
        this.persist(tracked, 'running', 'not-requested', avertissementSync || undefined)
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
          /*
           * NE PAS GARDER UNE COPIE QUE LA GARDE CONDAMNE POUR DE BON.
           *
           * MESURE le 2026-08-24 sur l'app reelle : vingt-et-une copies occupaient le disque et
           * polluaient le Hub, toutes refusees pour ascendance rompue. Le verdict etait connu a
           * CHAQUE tentative, et on n'en faisait rien -- la copie restait, et le demarrage la
           * restaurait meme depuis sa branche de secours. C'est l'« usine a worktrees ».
           *
           * On ne touche PAS au verdict de la garde : elle a raison de refuser, verifie a la main.
           * On agit seulement sur ce qu'on en FAIT. Et on ne perd rien : `preserverEtLiberer` met
           * le travail a l'abri sur `autowin/recovery/<id>` avant de rendre le disque, et garde la
           * copie si la preservation echoue.
           *
           * On refuse toujours la reprise juste apres : elle a genuinement echoue.
           */
          if (!validation.ok && validation.definitif) this.libererLaCopieEnConflit(runId)
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
      /*
       * L'AVERTISSEMENT AU DEMARRAGE — dire maintenant ce qu'on decouvrait a l'arrivee.
       *
       * `excludedDirtyFiles` est deja calcule ici : ce sont les changements non committes que la
       * copie a ECARTES, donc exactement les candidats a la collision. L'information existait,
       * affichee dans un `<details>` du panneau Worktrees qu'il faut penser a ouvrir — le meme
       * defaut que les motifs de blocage, « jamais lus ». On la met dans `detail`, la ou
       * l'interface la lit deja sans qu'on ait rien a deplier.
       *
       * Ni refus ni prediction : voir `avertissement-collision-probable.ts`, qui porte les trois
       * decisions (pas de porte, pas d'affirmation, silence sur un arbre propre).
       */
      const avertissement = avertissementCollisionProbable(tracked.excludedDirtyFiles, {
        total: tracked.excludedDirtyFileCount,
        tronquee: tracked.excludedDirtyFilesTruncated
      })
      if (avertissement) tracked.detail = avertissement
      this.persist(tracked, 'running', 'not-requested', avertissement || undefined)
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
    // TOUTE fin de run change le recensement : un travail retenu y entre, un travail fusionne en
    // sort. On oublie avant de decider quoi que ce soit — l'invalidation ne coute qu'un recalcul.
    this.invaliderRecensement()
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
        /*
         * UN RUN QUI N'A RIEN ECRIT NE LAISSE PAS DE BUREAU DERRIERE LUI.
         *
         * MESURE DANS L'APPLICATION REELLE le 2026-08-24, en lancant trois conversations sur la
         * meme chose comme le fait l'utilisateur : les trois finissent `ready` / `not-requested`
         * avec `files: 0` -- aucun fichier change -- et leurs trois copies restaient sur le disque.
         * L'etat signifie « en attente d'une decision humaine » ; or il n'y a AUCUNE decision a
         * prendre au sujet de rien. Trois dossiers pour zero travail.
         *
         * On ne range QUE le vide, et c'est ce qui rend le geste sur : `retainGreen` (un tournoi
         * conserve sa solution) est exclu, et une copie portant le moindre changement suit le
         * chemin normal, intacte. `preserverEtLiberer` distingue lui-meme les deux cas -- il rend
         * `libere` quand il n'y a rien a sauver et `preserve-et-libere` sinon -- donc meme une
         * erreur d'appreciation ici ne peut pas faire perdre de travail.
         *
         * APPLIQUE AUX DEUX JUMEAUX (`end` et `endAsync`) a dessein : la production emprunte
         * l'asynchrone, mais ce fichier a deja paye le prix d'un correctif pose sur une seule des
         * deux copies.
         */
        if (!options.retainGreen && tracked.files.length === 0) {
          this.libererLaCopieEnConflit(tracked.runId)
        }
        /*
         * UN RUN QUI FINIT ROUGE SE TRIE LUI-MEME, A CHAUD.
         *
         * Demande utilisateur du 2026-09-04 (« je passe ma vie a /salvage »), mesure a l'appui : 30
         * branches de secours, 23 sauvetages, et 134 marqueurs `refs/autowin/trie/` — 134 tris deja
         * faits A LA MAIN pour une file qui repart a chaque run. Une file ne se vide jamais par des
         * tris manuels quand elle se remplit plus vite qu'on ne trie.
         *
         * Le seul instant ou le tri est GRATUIT est celui-ci : le run vient de finir, il y a UN
         * travail, et sa conclusion est connue. `red` / `not-requested` veut dire que le contrat de
         * cloture a REFUSE ce travail — le publier remettrait du rouge dans la base. Le remonter a
         * l'humain trois jours plus tard, en tas, ne change pas ce verdict : il lui fait seulement
         * payer une relecture.
         *
         * RIEN N'EST DETRUIT, et c'est ce qui rend le geste sur : `marquerTravailTrie` POSE une
         * annotation a cote du SHA (ou de l'empreinte, pour un bureau sali). La copie, la branche de
         * secours et le sauvetage restent intacts et ouvrables nommement ; `oublierTravailTrie` rend
         * le travail a la file d'un seul geste. Et le marquage porte le SHA JUGE : un travail qui
         * REPREND ressort de lui-meme — sinon on remplacerait un bandeau qui crie par un bandeau qui
         * se tait, ce qui est pire.
         *
         * `retainGreen` (un tournoi conserve sa solution) est exclu : ce travail-la est vert et
         * attend une vraie decision. Pose sur les DEUX jumeaux (`end` et `endAsync`), comme le
         * commentaire ci-dessus l'exige.
         */
        if (!options.retainGreen && tracked.files.length > 0) {
          this.manager.marquerTravailTrie?.(tracked.runId)
        }
      }
      /*
       * ON REINVALIDE A LA SORTIE, pas seulement a l'entree.
       *
       * Trou trouve au cycle 2 de l'audit, sur le chemin le PLUS important : `merge: false`, le
       * travail RETENU. L'invalidation posee en tete de `endAsync` est suivie de plusieurs `await`,
       * or `snapshotForPrompt()` lit le recensement a CHAQUE tour d'agent : une lecture qui tombe
       * dans cette fenetre re-gele le cache sur l'etat d'AVANT la fin du run, pour 60 s — et l'agent
       * repond « rien a fusionner ». Le defaut d'origine, mot pour mot, par la porte de derriere.
       *
       * L'invariant n'est pas « on oublie avant de commencer » mais « le cache ne survit pas a une
       * transition d'etat ». Cette branche ne passe pas par `applyFinalize`, qui couvre les autres.
       * Pose sur les DEUX jumeaux, comme le demande le commentaire juste au-dessus.
       */
      this.invaliderRecensement()
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
      /*
       * ON NOMME L'ATTENTE — voir `FinalizeResult.deferred`.
       *
       * Rendre `undefined` ici disait la meme chose que « rien a publier » : l'orchestrateur en
       * tirait un rouge « integration locale non terminee » SANS cause, alors que la reprise
       * (`scheduleRecoveryRetry`, arme juste au-dessus) publie ensuite normalement. Mesure
       * conv-1 (2,13 $, 16 fichiers verts) et deja vecu conv-1404 sur `edit_file`.
       *
       * APPLIQUE AUX DEUX JUMEAUX (`end` et `endAsync`), comme le reste de ce fichier.
       */
      return {
        outcome: 'deferred',
        agentId: runId,
        files: tracked.files.map((file) => file.path),
        reason: 'processes-still-running',
        detail:
          'des processus tournent encore dans la copie isolée ; la publication est reprise ' +
          'automatiquement dès leur fin'
      }
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
    // TOUTE fin de run change le recensement : un travail retenu y entre, un travail fusionne en
    // sort. On oublie avant de decider quoi que ce soit — l'invalidation ne coute qu'un recalcul.
    this.invaliderRecensement()
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
        /*
         * UN RUN QUI N'A RIEN ECRIT NE LAISSE PAS DE BUREAU DERRIERE LUI.
         *
         * MESURE DANS L'APPLICATION REELLE le 2026-08-24, en lancant trois conversations sur la
         * meme chose comme le fait l'utilisateur : les trois finissent `ready` / `not-requested`
         * avec `files: 0` -- aucun fichier change -- et leurs trois copies restaient sur le disque.
         * L'etat signifie « en attente d'une decision humaine » ; or il n'y a AUCUNE decision a
         * prendre au sujet de rien. Trois dossiers pour zero travail.
         *
         * On ne range QUE le vide, et c'est ce qui rend le geste sur : `retainGreen` (un tournoi
         * conserve sa solution) est exclu, et une copie portant le moindre changement suit le
         * chemin normal, intacte. `preserverEtLiberer` distingue lui-meme les deux cas -- il rend
         * `libere` quand il n'y a rien a sauver et `preserve-et-libere` sinon -- donc meme une
         * erreur d'appreciation ici ne peut pas faire perdre de travail.
         *
         * APPLIQUE AUX DEUX JUMEAUX (`end` et `endAsync`) a dessein : la production emprunte
         * l'asynchrone, mais ce fichier a deja paye le prix d'un correctif pose sur une seule des
         * deux copies.
         */
        if (!options.retainGreen && tracked.files.length === 0) {
          this.libererLaCopieEnConflit(tracked.runId)
        }
        /*
         * UN RUN QUI FINIT ROUGE SE TRIE LUI-MEME, A CHAUD.
         *
         * Demande utilisateur du 2026-09-04 (« je passe ma vie a /salvage »), mesure a l'appui : 30
         * branches de secours, 23 sauvetages, et 134 marqueurs `refs/autowin/trie/` — 134 tris deja
         * faits A LA MAIN pour une file qui repart a chaque run. Une file ne se vide jamais par des
         * tris manuels quand elle se remplit plus vite qu'on ne trie.
         *
         * Le seul instant ou le tri est GRATUIT est celui-ci : le run vient de finir, il y a UN
         * travail, et sa conclusion est connue. `red` / `not-requested` veut dire que le contrat de
         * cloture a REFUSE ce travail — le publier remettrait du rouge dans la base. Le remonter a
         * l'humain trois jours plus tard, en tas, ne change pas ce verdict : il lui fait seulement
         * payer une relecture.
         *
         * RIEN N'EST DETRUIT, et c'est ce qui rend le geste sur : `marquerTravailTrie` POSE une
         * annotation a cote du SHA (ou de l'empreinte, pour un bureau sali). La copie, la branche de
         * secours et le sauvetage restent intacts et ouvrables nommement ; `oublierTravailTrie` rend
         * le travail a la file d'un seul geste. Et le marquage porte le SHA JUGE : un travail qui
         * REPREND ressort de lui-meme — sinon on remplacerait un bandeau qui crie par un bandeau qui
         * se tait, ce qui est pire.
         *
         * `retainGreen` (un tournoi conserve sa solution) est exclu : ce travail-la est vert et
         * attend une vraie decision. Pose sur les DEUX jumeaux (`end` et `endAsync`), comme le
         * commentaire ci-dessus l'exige.
         */
        if (!options.retainGreen && tracked.files.length > 0) {
          this.manager.marquerTravailTrie?.(tracked.runId)
        }
      }
      /*
       * ON REINVALIDE A LA SORTIE, pas seulement a l'entree.
       *
       * Trou trouve au cycle 2 de l'audit, sur le chemin le PLUS important : `merge: false`, le
       * travail RETENU. L'invalidation posee en tete de `endAsync` est suivie de plusieurs `await`,
       * or `snapshotForPrompt()` lit le recensement a CHAQUE tour d'agent : une lecture qui tombe
       * dans cette fenetre re-gele le cache sur l'etat d'AVANT la fin du run, pour 60 s — et l'agent
       * repond « rien a fusionner ». Le defaut d'origine, mot pour mot, par la porte de derriere.
       *
       * L'invariant n'est pas « on oublie avant de commencer » mais « le cache ne survit pas a une
       * transition d'etat ». Cette branche ne passe pas par `applyFinalize`, qui couvre les autres.
       * Pose sur les DEUX jumeaux, comme le demande le commentaire juste au-dessus.
       */
      this.invaliderRecensement()
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
      /*
       * ON NOMME L'ATTENTE — voir `FinalizeResult.deferred`.
       *
       * Rendre `undefined` ici disait la meme chose que « rien a publier » : l'orchestrateur en
       * tirait un rouge « integration locale non terminee » SANS cause, alors que la reprise
       * (`scheduleRecoveryRetry`, arme juste au-dessus) publie ensuite normalement. Mesure
       * conv-1 (2,13 $, 16 fichiers verts) et deja vecu conv-1404 sur `edit_file`.
       *
       * APPLIQUE AUX DEUX JUMEAUX (`end` et `endAsync`), comme le reste de ce fichier.
       */
      return {
        outcome: 'deferred',
        agentId: runId,
        files: tracked.files.map((file) => file.path),
        reason: 'processes-still-running',
        detail:
          'des processus tournent encore dans la copie isolée ; la publication est reprise ' +
          'automatiquement dès leur fin'
      }
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
      const detail = error instanceof Error ? error.message : String(error)
      /*
       * UNE INTERRUPTION APRES LA FUSION N'EST PAS UNE FUSION ECHOUEE.
       *
       * `finalize` est une SEQUENCE : commit dans la copie, fusion dans la base, crochets, puis
       * rangement du dossier. Le worker signale `integrated` des que la fusion tient ; ce qui suit
       * peut encore etre coupe (budget d'UNE commande git donne a la sequence entiere). Mesure le
       * 2026-08-27 (conv-1423) : `acfe64dd` etait dans `main` a 09:09:50, et le refus
       * `merge-failed / interrompue apres 32000 ms` est trace a 09:10:21 — le rapport CONTREDISAIT
       * le depot, et tous les workflows finissaient sur « ARRETE au controle final ».
       *
       * On ne relit pas le disque pour deviner : on lit le SHA que `onIntegrated` vient d'ecrire.
       * Sans ce SHA, aucune fusion n'a ete annoncee et le refus reste entier.
       */
      const publishedSha = tracked.publishedSha
      if (publishedSha) {
        const merged: FinalizeResult = {
          outcome: 'merged',
          agentId: runId,
          files: tracked.files.map((file) => file.path),
          committed: true,
          publishedSha,
          ...(tracked.publicationAgentSha ? { agentSha: tracked.publicationAgentSha } : {}),
          ...(tracked.publicationBaseSha ? { baseSha: tracked.publicationBaseSha } : {}),
          detail: `Fusion publiée, puis rangement interrompu : ${detail}`
        } as FinalizeResult
        this.applyFinalize(tracked, merged)
        this.persistFinalize(tracked, merged)
        this.emit()
        return merged
      }
      const blocked: FinalizeResult = {
        outcome: 'blocked',
        agentId: runId,
        files: tracked.files.map((file) => file.path),
        reason: 'merge-failed',
        detail
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
    /*
     * TOUTES LES CAUSES DE BLOCAGE SE REPARENT HORS DE L'APP — donc toutes doivent rester
     * reessayables. N'en admettre que deux fermait la porte au refus LE PLUS FREQUENT.
     *
     * Observe en direct le 2026-08-26 : une edition refusee en `base-dirty` laisse un bureau
     * « A reprendre », et le message de refus dit « Ouvre Worktrees … puis « Reprendre » pour
     * republier ». Or `base-dirty` n'etait pas dans cette liste : le bouton rendait `undefined` et ne
     * faisait RIEN. Le renderer n'en regarde pas le resultat, donc l'ecran ne disait rien non plus —
     * clic reel verifie, aucune erreur, aucun changement, le fichier de la base inchange. L'app
     * promettait un geste inoperant, et c'est ainsi qu'on refait un travail deja ecrit.
     *
     * `base-dirty` et `base-in-progress` se reparent exactement comme `merge-failed` : l'utilisateur
     * committe ou range sa base, attend la fin de l'operation en cours, puis republie. Le code note
     * ailleurs leur frequence — « 216 refus base-in-progress contre 86 base-dirty, parce que
     * l'utilisateur travaille en continu » (`delai-de-reprise.ts`) : ce sont les deux causes qui
     * avaient le plus besoin de cette porte.
     *
     * La garde qui compte reste intacte : `verdict === 'red'` interdit toujours, et `discardHeld`
     * — la porte qui DETRUIT — n'est pas touchee.
     */
    const retryBlockedPublication =
      tracked?.publication === 'blocked' && CAUSES_REESSAYABLES.has(tracked.attentionReason ?? '')
    const retryExhaustedPublication =
      !!tracked &&
      ['pending', 'cleanup-pending'].includes(tracked.publication ?? '') &&
      tracked.attentionReason === 'retry-exhausted'
    // Même correction que dans `retryRunAsync` : `unknown` = jamais jugé, pas mauvais.
    if (
      !tracked ||
      tracked.verdict === 'red' ||
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
      tracked?.publication === 'blocked' && CAUSES_REESSAYABLES.has(tracked.attentionReason ?? '')
    const retryExhaustedPublication =
      !!tracked &&
      ['pending', 'cleanup-pending'].includes(tracked.publication ?? '') &&
      tracked.attentionReason === 'retry-exhausted'
    /*
     * `unknown` veut dire « JAMAIS JUGÉ », pas « jugé mauvais » — et confondre les deux fermait la
     * porte à la majorité des travaux bloqués.
     *
     * Mesuré le 2026-08-23 : 14 travaux terminés attendaient sur des branches `autowin/recovery/`,
     * et AUCUN n'était reprenable. Onze sont des `command-edit` — des éditions demandées dans le
     * chat, qui ne passent jamais par un juge, donc qui ne peuvent PAS être vertes. Exiger le vert
     * les condamnait par construction : aucun appel de reprise n'aurait jamais pu les servir.
     *
     * Seul `red` interdit encore : celui-là a été jugé, et négativement. La garde de `discardHeld`
     * reste, elle, sur `green` — on desserre la porte qui RÉCUPÈRE, jamais celle qui DÉTRUIT.
     *
     * La reprise demeure un GESTE DE L'UTILISATEUR, jamais automatique : il décide après avoir lu
     * le diff. On rend une porte, on ne pousse personne à travers.
     */
    if (
      !tracked ||
      tracked.verdict === 'red' ||
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
    /*
     * RECRÉER la copie si le balayeur l'a supprimée. Sans cela, la reprise repartait aussitôt en
     * `merge-failed` — mesuré le 2026-08-23 : desserrer la garde ouvrait la porte sur une route
     * coupée. Le travail vit sur `autowin/recovery/<id>` ; on le remet sur un bureau pour pouvoir le
     * fusionner. Si la restauration échoue, la reprise suit son cours et échouera proprement, comme
     * avant : on n'a rien cassé, on a seulement tenté.
     */
    // On INTERROGE le disque plutôt que de lire `tracked.worktreeAvailable` : ce champ n'est calculé
    // qu'au moment de l'AFFICHAGE (`activity()`), il vaut donc `undefined` ici. Première version de
    // ce correctif : la restauration ne se déclenchait jamais, et la reprise repartait en
    // `merge-failed` sans que rien ne l'explique.
    if (!copiePresente(tracked.worktreePath)) {
      this.manager.restaurerCopieDepuisSecours?.(runId)
    }
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

  /**
   * Pré-vol LECTURE SEULE relayé à la base : fichiers non committés de l'utilisateur. Un manager qui
   * ne l'expose pas (doubles de test au contrat minimal) rend une liste vide — pas de refus inventé.
   */
  baseDirtyFiles(): readonly string[] {
    return this.manager.baseDirtyFiles?.() ?? []
  }

  /** Activité courante, prête pour le modèle du cockpit UI. */
  /**
   * Le lot des travaux non publies, avec un CACHE court.
   *
   * `activity()` est lu a chaque rafraichissement d'interface. Sans ce cache, chaque lecture paierait
   * un appel git pour le compte plus deux par branche affichee -- sept processus, plusieurs fois par
   * minute, pour une reponse qui ne change qu'a la minute. Un ensemble de branches ne bouge pas vite.
   */
  private cacheNonPublies?: {
    a: number
    ids: Set<string>
    apercu: Map<string, { date: string; fichiers: string[] }>
  }

  /**
   * OUBLIER le recensement parce qu'un EVENEMENT l'a rendu faux — pas parce que le temps a passe.
   *
   * Defaut trouve par l'audit du 2026-08-26 : le cache 60 s etait tolerable tant qu'il ne servait
   * qu'au bandeau, qui se redessine. Depuis que `get_state` le lit, `snapshotForPrompt()` le remplit
   * a CHAQUE tour d'agent, donc PENDANT le run — avant que l'agent isole n'ait committe. Le run
   * finit a T, l'utilisateur dit « fusionne » a T+5 s, et l'agent lit l'instantane de T-40 s : `[]`.
   * Il repond « rien a fusionner ». C'est le defaut d'origine, rejoue par sa propre reparation.
   *
   * La TTL est un pari sur le temps ; la fin d'un run est un fait connu d'ici. On invalide dessus.
   */
  invaliderRecensement(): void {
    this.cacheNonPublies = undefined
  }

  private travauxNonPubliesCaches(): {
    ids: Set<string>
    apercu: Map<string, { date: string; fichiers: string[] }>
  } {
    const maintenant = this.now()
    /*
     * AUCUNE EXPIRATION PAR LE TEMPS — le relevé ne se refait que sur un FAIT.
     *
     * Mesure du 2026-08-28 (détecteur de gel, conv-1511) : l'application se figeait 18 secondes
     * TOUTES LES 60 SECONDES pendant que l'utilisateur écrivait dans le chat — sept gels consécutifs
     * journalisés, 45 % du temps d'exécution passé fenêtre morte. La périodicité était exactement
     * celle de la TTL ci-dessous : à son expiration, `snapshot()` (appelé à chaque tour) relançait un
     * recensement git ENTIÈREMENT SYNCHRONE — `execFileSync`, des dizaines de processus — sur le
     * thread main, donc sur la boucle qui pompe les messages de la fenêtre.
     *
     * Allonger la TTL n'aurait fait qu'espacer le gel. Elle est SUPPRIMÉE : les onze appels à
     * `invaliderRecensement()` couvrent déjà tous les faits qui changent la réponse (fin de run,
     * publication, tri d'un travail). Le commentaire de `invaliderRecensement` le dit lui-même —
     * « la TTL est un pari sur le temps ; la fin d'un run est un fait connu d'ici ». Ce pari coûtait
     * 18 secondes de fenêtre morte par minute, pour une réponse que rien n'avait rendue fausse.
     */
    if (this.cacheNonPublies) {
      return { ids: this.cacheNonPublies.ids, apercu: this.cacheNonPublies.apercu }
    }
    /*
     * CACHE FROID = LE GEL DE 14 SECONDES.
     *
     * Supprimer la TTL a tue le gel PERIODIQUE ; restait le gel A FROID. Mesure du 2026-08-29
     * (detecteur de gel) : `ipc:worktree:activity (sync)` a bloque la boucle main 14 403 ms au
     * premier affichage — le recensement git (une commande par branche) etait paye ICI, sur le
     * thread qui pompe les messages de la fenetre.
     *
     * Quand le manager sait recenser hors thread (worker deja en place pour les autres operations
     * git), on ne l'attend PAS : on rend ce qu'on sait — rien — et le releve remonte ensuite, avec
     * une re-emission de l'activite. Aucune information n'est perdue, seulement differee de la
     * duree du recensement. Sans worker, la voie synchrone ci-dessous reste inchangee.
     */
    if (this.manager.recensementNonPubliesAsync) {
      this.demanderRecensement()
      return { ids: new Set<string>(), apercu: new Map() }
    }
    /*
     * UN RUN QUI TOURNE N'EST PAS UN TRAVAIL OUBLIE.
     *
     * Le bandeau dit « travaux TERMINES non fusionnes ». Or un bureau d'agent est SALE par
     * construction pendant que l'agent ecrit dedans : le quatrieme gisement le recensait donc, et
     * le bandeau reclamait le tri d'un travail que personne n'avait encore fini. C'est un faux
     * positif structurel — il n'y a rien a fusionner tant que le run n'a pas rendu.
     *
     * Le filtre porte sur l'etat REEL du run (`isolated`/`working`), pas sur une heuristique de
     * fraicheur : quand le run se termine, `invaliderRecensement()` refait le releve et le travail
     * reapparait aussitot s'il n'a pas ete publie. On ne perd donc rien, on differe.
     */
    const enCours = new Set(
      [...this.runs.values()]
        .filter((t) => t.state === 'isolated' || t.state === 'working')
        .map((t) => t.runId)
    )
    const ids = new Set(
      (this.manager.travauxNonPublies?.() ?? []).filter((agentId) => !enCours.has(agentId))
    )
    const apercu = new Map(
      // SIX apercus pour TROIS lignes affichees : le dedoublonnage consomme des entrees (des reprises
      // du meme travail produisent plusieurs branches), et sans marge la troisieme ligne retombait
      // sur un UUID -- constate a l'ecran. La marge est bornee : six branches, mise en cache 60 s.
      (this.manager.apercuTravauxNonPublies?.('HEAD', 6) ?? []).map((entree) => [
        entree.agentId,
        { date: entree.date, fichiers: entree.fichiers }
      ])
    )
    this.cacheNonPublies = { a: maintenant, ids, apercu }
    return { ids, apercu }
  }

  /**
   * La version BORNEE et CACHEE, pour les chemins CHAUDS (`get_state`, injection de prompt).
   *
   * Defaut mesure le 2026-08-26 : `get_state` avait ete cable sur la variante sans borne ci-dessous,
   * dont le commentaire dit pourtant « geste EXPLICITE de l'utilisateur, pas un rafraichissement
   * d'ecran ». Or `snapshotForPrompt()` appelle `snapshot()` a CHAQUE tour d'agent. Sur ce depot
   * (19 bureaux) : 76 processus git, 10,4 secondes -- par tour.
   *
   * Le cache 60 s et la borne a six entrees sont ceux du bandeau : la meme question, la meme reponse.
   */
  /**
   * Enregistre le verdict TRIE d'un travail non publie — sans rien supprimer.
   *
   * Le bandeau du chat relit `travauxNonPublies` toutes les 30 s. Sans ce geste, un travail juge
   * « deja repris dans la base sous une autre forme » revenait au tick suivant, indefiniment :
   * `git cherry` ne voit pas une reecriture. Mesure du 2026-08-27 (conv-1424).
   */
  marquerTravailTrie(agentId: string): boolean {
    const marque = this.manager.marquerTravailTrie?.(agentId) === true
    if (marque) this.invaliderRecensement()
    return marque
  }

  /** Retire le verdict TRIE : le travail redevient un candidat a part entiere. */
  oublierTravailTrie(agentId: string): boolean {
    const oublie = this.manager.oublierTravailTrie?.(agentId) === true
    if (oublie) this.invaliderRecensement()
    return oublie
  }

  /** Le SHA marque TRIE pour ce travail, ou `undefined`. */
  shaTravailTrie(agentId: string): string | undefined {
    return this.manager.shaTravailTrie?.(agentId)
  }

  travauxNonPubliesBornes(): Array<{ agentId: string; date: string; fichiers: string[] }> {
    const { ids, apercu } = this.travauxNonPubliesCaches()
    /*
     * ON NE REND QUE CE QU'ON SAIT DECRIRE.
     *
     * Defaut du 2026-08-26 : cette methode mappait `ids` (COMPLET) sur `apercu` (borne a six), donc
     * la septieme entree sortait avec `date: ''` et `fichiers: []` -- indistinguable d'un travail
     * vide. Or `commands.ts` promet a l'agent la liste « avec leurs fichiers », et un `fichiers: []`
     * se lit « rien dedans » : le defaut d'origine rejoue, avec une entree presente mais muette.
     *
     * Le COMPTE, lui, reste gratuit (`ids` vient d'une seule commande) : on le garde donc en dernier
     * element plutot que de laisser croire que la liste est complete.
     */
    const decrits = [...ids].filter((agentId) => apercu.has(agentId))
    const restants = ids.size - decrits.length
    const rendu = decrits.map((agentId) => ({
      agentId,
      date: apercu.get(agentId)?.date ?? '',
      fichiers: apercu.get(agentId)?.fichiers ?? []
    }))
    if (restants > 0) {
      rendu.push({
        agentId:
          restants > 1
            ? `… et ${restants} autres travaux non publiés`
            : '… et 1 autre travail non publié',
        date: '',
        fichiers: [
          restants > 1
            ? `${restants} entrées non détaillées — ouvrir le panneau Workspace pour les voir`
            : '1 entrée non détaillée — ouvrir le panneau Workspace pour la voir'
        ]
      })
    }
    return rendu
  }

  /**
   * Ce bureau PRECIS peut-il porter du travail ? Cout borne a UN bureau.
   *
   * Sert la sortie courte d'`edit_file` : sans dossier ni branche pour cet identifiant, inutile de
   * payer le recensement complet (18 699 ms mesures le 2026-09-04 avec 40 copies accumulees).
   * Absent le manager, on repond `true` : on ne saute JAMAIS le recensement sur une ignorance.
   */
  bureauPeutPorterDuTravail(agentId: string): boolean {
    return this.manager.bureauPeutPorterDuTravail?.(agentId) ?? true
  }

  /** Tous les travaux finis mais non publies, avec leurs fichiers. Lecture seule, a la demande. */
  travauxNonPublies(): Array<{
    agentId: string
    date: string
    fichiers: string[]
    verdict?: VerdictBureau
    /** VRAI quand `fichiers` est l'echo d'une lecture ratee, pas une constatation de vide. */
    lectureEchouee?: boolean
  }> {
    // Sans borne ici : c'est un geste EXPLICITE de l'utilisateur, pas un rafraichissement d'ecran.
    return this.manager.apercuTravauxNonPublies?.('HEAD', 100) ?? []
  }

  /**
   * LA MEME LISTE, mais HORS du thread qui dessine la fenetre.
   *
   * Mesure du 2026-09-03 (`gels.jsonl`, 536 entrees) : `ipc:worktree:travaux-non-publies (sync)` a
   * bloque la boucle main 16 099 ms puis 9 793 ms. La cause n'est pas le volume : c'est que ce
   * geste explicite payait le recensement git (une commande par branche, 145 ms par appel) sur le
   * thread principal, alors que la voie hors-thread existe deja et sert le bandeau
   * (`recensementNonPubliesAsync`). Sans worker, on retombe sur la voie synchrone : meme reponse.
   */
  async travauxNonPubliesAsync(): Promise<
    Array<{
      agentId: string
      date: string
      fichiers: string[]
      verdict?: VerdictBureau
      lectureEchouee?: boolean
    }>
  > {
    const releve = await this.manager.recensementNonPubliesAsync?.('HEAD', 100)
    if (!releve) return this.travauxNonPublies()
    const ids = new Set(releve.ids)
    return releve.apercu.filter((entree) => ids.has(entree.agentId))
  }

  /** Le patch d'un travail non publie, pour le lire avant d'en decider. */
  patchTravailNonPublie(agentId: string): { patch: string; tronque: boolean } {
    return this.manager.patchTravailNonPublie?.(agentId) ?? { patch: '', tronque: false }
  }

  activity(): WorktreeAgentActivity[] {
    // UNE seule interrogation git pour tout le lot, pas une par entree : la question est posee a
    // chaque affichage, elle doit rester gratuite.
    const { ids: nonPublies, apercu } = this.travauxNonPubliesCaches()
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
      /*
       * DIRE si la copie est encore la, au lieu de laisser `undefined` -- « on n'a jamais regarde ».
       * Ce champ n'etait ecrit qu'a `true`, sur les chemins heureux : rien ne le mettait jamais a
       * `false`. Mesure sur l'app le 2026-08-23 : 21 des 22 entrees « bloquees » le portaient a
       * `undefined`, donc rien ne distinguait une copie presente d'une copie balayee depuis deux
       * jours -- et l'app annoncait 26 worktrees pour 4 dossiers reels.
       *
       * On NE SUPPRIME rien : ni la branche de secours (elle porte peut-etre du travail), ni
       * l'entree (elle reste l'adresse d'une reprise). On repond juste honnetement a la question.
       * Une valeur deja posee par le flux normal gagne toujours : on ne comble qu'un silence.
       */
      worktreeAvailable: t.worktreeAvailable ?? copiePresente(t.worktreePath),
      travailNonPublie: nonPublies.has(t.runId) || undefined,
      fichiersNonPublies: apercu.get(t.runId)?.fichiers,
      dateNonPublie: apercu.get(t.runId)?.date,
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
   * Issues des runs TERMINÉS, lues sur disque et non dans la mémoire du coordinateur.
   *
   * `this.runs` n'est peuplé qu'après la réconciliation, elle-même reportée jusqu'à l'affichage en
   * production. Au chargement des conversations — bien avant — seul l'état persisté répond.
   */
  runRecords(): WorktreeRunRecord[] {
    return this.stateStore?.list() ?? []
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
    /*
     * REMETTRE LA COPIE avant d'arbitrer. Depuis que `applyFinalize` libère le disque sur un
     * conflit — le travail étant à l'abri sur `autowin/recovery/<id>` —, le bureau n'est plus là
     * quand l'utilisateur tranche. Sans cette ligne, ranger le disque casserait le bouton de
     * résolution : c'est la contrepartie qui rend la libération légitime, pas une précaution.
     *
     * Même geste que `retryRunAsync`, et pour la même raison : on interroge le DISQUE, car
     * `worktreeAvailable` n'est calculé qu'à l'affichage et vaut `undefined` ici.
     */
    if (!copiePresente(tracked.worktreePath)) {
      this.manager.restaurerCopieDepuisSecours?.(runId)
    }
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
    // Jeter un travail retenu le fait SORTIR du recensement : meme raison qu'en `applyFinalize`.
    this.invaliderRecensement()
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

  /** Un seul recensement en vol a la fois : l'ecran le redemande a chaque affichage. */
  private recensementEnVol?: Promise<void>

  private demanderRecensement(): void {
    if (this.recensementEnVol) return
    const releve = this.manager.recensementNonPubliesAsync?.('HEAD', 6)
    if (!releve) return
    this.recensementEnVol = releve
      .then((r) => {
        const enCours = new Set(
          [...this.runs.values()]
            .filter((t) => t.state === 'isolated' || t.state === 'working')
            .map((t) => t.runId)
        )
        this.cacheNonPublies = {
          a: this.now(),
          ids: new Set(r.ids.filter((agentId) => !enCours.has(agentId))),
          apercu: new Map(
            r.apercu.map((e) => [e.agentId, { date: e.date, fichiers: e.fichiers }])
          )
        }
        this.emit()
      })
      .catch(() => {
        // Un depot qui ne repond pas ne prouve AUCUNE perte : on n'annonce rien, et le prochain
        // affichage redemandera. Surtout : on ne retombe pas en synchrone, ce serait le gel.
      })
      .finally(() => {
        this.recensementEnVol = undefined
      })
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

  /**
   * Range la copie d'un run parti en conflit, en mettant son travail à l'abri d'abord.
   *
   * Muet en cas d'échec À DESSEIN : ranger le disque ne doit jamais faire échouer la publication
   * qu'on est en train de conclure. Une copie non libérée reste visible dans le Hub, ce qui est
   * exactement l'état d'avant — on ne régresse sur rien.
   */
  private libererLaCopieEnConflit(runId: string): void {
    try {
      this.manager.preserverEtLiberer?.(runId)
    } catch (error) {
      this.recordRecoveryFailure(error)
    }
  }

  private applyFinalize(tracked: Tracked, res: FinalizeResult): void {
    /*
     * LE COTE SORTIE DU RECENSEMENT, oublie au cycle 1.
     *
     * Mon commentaire disait « un travail retenu y ENTRE, un travail fusionne en SORT » et je
     * n'avais cable que l'entree (`end`/`endAsync`). Deux chemins prouves passaient a cote : la
     * resolution de conflit appelle `finalizeAsync` DIRECTEMENT sans passer par `endAsync`, et une
     * fusion reussie depuis le Hub laissait donc le cache annoncer jusqu'a 60 s un travail deja
     * integre. C'est le defaut d'origine EN MIROIR : l'agent propose de fusionner ce qui n'existe
     * plus. `applyFinalize` est le point de passage que TOUS les chemins traversent.
     */
    this.invaliderRecensement()
    // Point de passage UNIQUE de tout refus d'integration : c'est donc ici qu'on le COMPTE, une fois
    // par tentative. Le tracage ne doit jamais casser l'action tracee — d'ou le try muet.
    if (res.outcome === 'blocked' || res.outcome === 'conflict') {
      try {
        this.onRefusIntegration?.({
          cause: res.outcome === 'conflict' ? 'conflict' : res.reason,
          agentId: tracked.runId,
          files: res.files,
          tentative: (this.retryCounts.get(tracked.runId) ?? 0) + 1,
          ...(res.outcome === 'blocked' && res.detail ? { detail: res.detail } : {})
        })
      } catch {
        /* un puits d'observation defaillant ne fait pas echouer une publication */
      }
    }
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
      /*
       * LIBÉRER LE DISQUE SANS PERDRE LE TRAVAIL.
       *
       * Mesuré le 2026-08-24 en jouant le scénario réel de l'utilisateur — trois conversations sur
       * la même chose : la première publie, les deux autres partent en `conflict`, et LEURS COPIES
       * RESTAIENT SUR LE DISQUE. C'est l'« usine à worktrees » qu'il signale depuis longtemps ;
       * vingt-deux commits ont visé ce thème sans jamais jouer ce scénario de bout en bout.
       *
       * Supprimer la copie serait une PERTE : `resolveConflictAsync` en a besoin pour arbitrer.
       * `preserverEtLiberer` fait exactement le bon geste — le travail part d'abord sur
       * `autowin/recovery/<id>`, et le dossier n'est retiré QUE si la préservation a réussi ; sinon
       * il rend `refuse` et la copie reste. On ne peut donc pas perdre du travail ici.
       *
       * L'arbitrage, lui, restaure la copie depuis la branche de secours au moment où on en a
       * besoin — comme `retryRunAsync` le fait déjà.
       */
      this.libererLaCopieEnConflit(tracked.runId)
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
    /*
     * BATTEMENT. Estampiller ICI et pas ailleurs : `persist` est le seul point par lequel passe tout
     * changement d'etat reellement enregistre, donc le seul battement fiable de ce niveau. Pose avant
     * le retour anticipe ci-dessous, sinon un run non-mutation n'en aurait jamais.
     */
    tracked.derniereVieMs = this.now()
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
    const issue = manager.preserverEtLiberer(agentId)
    // LIBERER DOIT LEVER LE BLOCAGE. Vecu le 2026-08-27 : cette methode rendait `libere` et
    // supprimait la copie du disque, mais l'activite continuait d'annoncer `blocked / base-dirty` —
    // pour une copie disparue, donc qu'aucun geste ne pouvait plus debloquer (un retry n'a plus de
    // copie a republier). Le meme geste que `discardHeldAsync`, a ceci pres que le travail est
    // PRESERVE sur sa branche avant de rendre le disque. Un `refuse` ne clot rien : la copie est
    // toujours la, son blocage est reel.
    if (issue.outcome === 'libere' || issue.outcome === 'preserve-et-libere') {
      this.invaliderRecensement()
      this.runs.delete(agentId)
      this.stateStore?.remove(agentId)
      this.emit()
    }
    return issue
  }

  async balayerLesCopiesAbandonnees(): Promise<string[]> {
    try {
      return (await this.manager.sweepAbandonedAgentCopiesAsync?.()) ?? []
    } catch {
      return []
    }
  }

  private async reconcileExistingAsync(): Promise<void> {
    // Les coquilles vides d'abord : elles MENTENT a tout ce qui les mesure ensuite. Un `git status`
    // lance dans l'une d'elles ne repond pas « vide » -- git remonte l'arborescence et rapporte
    // l'etat du depot PARENT. Reconcilier avant de les retirer, c'est reconcilier sur douze faux
    // rapports (mesure le 2026-08-25).
    try {
      this.manager.balayerLesCoquilles?.()
    } catch {
      /* Menage best-effort : ne jamais empecher un demarrage pour un dossier vide. */
    }
    const residues = this.manager.reconcileResiduesAsync
      ? await this.manager.reconcileResiduesAsync()
      : this.manager.reconcileResidues?.()
    this.reconcileExisting(undefined, residues)
  }

  /**
   * REFERMER CE QUI A FINI SON OFFICE — la fuite qui remplissait le dossier d'etat.
   *
   * Mesure du 2026-08-21 : 381 manifestes pour 17 copies vivantes. La cause n'etait pas un cas
   * limite mais le chemin NOMINAL — `save` a chaque persistance, `remove` a une seule ligne du
   * depot, derriere une porte exigeant `green` + `held` et un clic humain. 219 des 381 manifestes
   * venaient de runs sans le moindre incident. Le cout n'est pas le disque (2,3 Mo) : c'est qu'un
   * badge d'attention noye parmi 380 entrees mortes ne sera jamais vu.
   *
   * POURQUOI ICI, et pas a la fermeture du run : pendant la session, le manifeste `complete` est ce
   * qui permet de rejouer la publication si l'app meurt entre la fusion Git et l'acquittement du
   * callback — des tests anterieurs le garantissent, et une premiere version de ce correctif s'y est
   * cassee en le supprimant trop tot. Au REDEMARRAGE suivant, en revanche, la livraison est prouvee
   * (`causalPublicationDeliveredAtMs` pose) : plus personne n'attend d'etre prevenu, et le travail
   * est dans l'historique par construction (`complete` = `merged` ou `nothing`).
   *
   * Deux gardes dures, aucune heuristique — ni age, ni quota : la publication doit etre ACQUITTEE,
   * et aucun processus ne doit tenir la copie. Ce qui ne remplit pas les deux reste sur disque.
   */
  private refermerLesManifestesAccomplis(records: Map<string, WorktreeRunRecord>): void {
    if (!this.stateStore) return
    for (const [runId, record] of [...records]) {
      if (record.publication !== 'complete') continue
      if (record.causalPublicationDeliveredAtMs === undefined) continue
      if (this.manager.hasActiveProcesses?.(runId)) continue
      this.stateStore.remove(runId)
      records.delete(runId)
    }
  }

  /**
   * DONNER UNE FIN AUX RUNS QUE PLUS PERSONNE NE REPRENDRA.
   *
   * Apres six reprises, `applyFinalize` posait `attentionReason = 'retry-exhausted'` mais laissait
   * `publication` sur `cleanup-pending` ou `blocked`. Le run n'etait alors ni repris — la
   * reconciliation le saute justement a cause de ce budget epuise — ni abandonne. SUSPENDU pour
   * toujours, et hors de portee des deux nettoyages existants : l'un exige un HEAD deja reference,
   * l'autre exige `held`. C'est ainsi que 153 manifestes `blocked` se sont accumules.
   *
   * Terminal ne veut pas dire silencieux : `attentionReason` est conserve tel quel. On nomme la fin,
   * on ne l'efface pas — un run abandonne doit rester lisible par l'humain qui le cherchera.
   *
   * Et le marqueur vit A COTE de `publication`, jamais A SA PLACE : une premiere version ecrivait
   * `publication = 'abandoned'` et cassait `retryRun`, qui lit ce champ pour router la reprise
   * MANUELLE. Nommer une fin ne doit pas confisquer la main a l'humain.
   */
  private abandonnerLesRunsABoutDeReprises(records: Map<string, WorktreeRunRecord>): void {
    if (!this.stateStore) return
    for (const [runId, record] of [...records]) {
      if (record.abandoned) continue
      if (record.attentionReason !== 'retry-exhausted') continue
      if ((record.retryCount ?? 0) < MAX_AUTOMATIC_RETRIES) continue
      if (this.manager.hasActiveProcesses?.(runId)) continue
      const abandonne: WorktreeRunRecord = { ...record, abandoned: true }
      this.stateStore.save(abandonne)
      // Une seule fois : `abandoned: true` est persiste, et la boucle saute deja les records
      // portant ce marqueur. Une reconciliation suivante ne re-sonnera donc pas.
      this.onAbandon?.({ runId, tache: record.task, raison: record.attentionReason })
      records.set(runId, abandonne)
    }
  }

  /**
   * QUAND LE BALAYAGE EMPORTE UNE COPIE, SON MANIFESTE PART AVEC ELLE.
   *
   * Le balayage savait deja decider qu'une copie est abandonnee, et ses quatre conditions cumulees
   * SONT les gardes de surete de ce chantier : aucun processus vivant, arbre de travail vide, HEAD
   * deja contenu dans une reference — donc le travail est dans l'historique, jamais une adresse
   * unique perdue — et copie plus vieille que la fenetre de spawn. Il ne lui manquait que le droit
   * d'emporter le manifeste.
   *
   * On le fait ICI plutot que dans le manager, volontairement : `worktree-manager.ts` ne contient
   * aucune reference au store d'etat, et lui en injecter un creerait un couplage entre deux modules
   * aujourd'hui independants. Sa liste `swept` etait deja rendue — elle n'etait simplement pas lue.
   */
  private oublierLesCopiesBalayees(
    swept: readonly string[] | undefined,
    records: Map<string, WorktreeRunRecord>
  ): void {
    if (!this.stateStore || !swept?.length) return
    for (const balayee of swept) {
      // La liste porte des chemins de copies ; l'identifiant du run est le suffixe du dossier.
      // `basename` plutot qu'une regex de separateurs : il gere les deux formes de chemin, et
      // aucune regex a echapper ne peut le casser silencieusement.
      const nom = basename(balayee)
      const runId = nom.startsWith('agent__') ? nom.slice('agent__'.length) : nom
      if (!runId || !records.has(runId)) continue
      this.stateStore.remove(runId)
      records.delete(runId)
    }
  }

  /**
   * UN MANIFESTE DONT LA COPIE A DISPARU NE SURVIT PLUS TOUT SEUL.
   *
   * Variante residuelle trouvee le 2026-08-22 en verifiant la derniere case de la DoD : 22
   * manifestes subsistaient pour ZERO dossier de copie. Le balayage ne peut emporter un manifeste
   * que lorsqu'il emporte SA COPIE ; une copie disparue par un autre chemin — nettoyage manuel,
   * suppression externe, disque remis a plat — laissait donc son manifeste orphelin pour toujours.
   *
   * Trois gardes, toutes falsifiables : la copie doit reellement avoir disparu du disque, aucun
   * processus ne doit la revendiquer, et si le manifeste cite un commit, ce commit doit deja etre
   * retenu par une reference du depot. Ce dernier point reutilise `commitDejaReference`, la SEULE
   * definition de « deja dans l'historique » — en avoir deux qui divergent serait pire qu'aucune.
   *
   * Le cas sans commit cite est sur lui aussi : un manifeste qui ne nomme aucun commit n'est
   * l'adresse de rien. Et quand git ne repond pas, `commitDejaReference` rend `undefined` : on
   * s'abstient, parce que l'ignorance n'est pas une reponse negative.
   */
  private oublierLesEtatsSansCopie(
    records: Map<string, WorktreeRunRecord>,
    managerIds: readonly string[]
  ): void {
    if (!this.stateStore) return
    /*
     * UNE SEULE INTERROGATION GIT POUR TOUS LES MANIFESTES.
     *
     * Mesure du 2026-09-03 (gel de demarrage, `gels.jsonl`) : `for-each-ref --contains` etait pose
     * ici UNE FOIS PAR MANIFESTE — 27 appels, 2 252 ms de fenetre morte, sur le thread qui dessine.
     * La question ne change pas ; seule sa forme change : `commitsDejaReferences` y repond pour
     * tout le lot d'un coup. Sans manager capable du lot, la voie unitaire reste inchangee.
     */
    const commitsAVerifier = [...records.values()]
      .map((record) => record.sourceSha ?? record.publishedSha)
      .filter((commit): commit is string => Boolean(commit))
    const referencesDuLot = this.manager.commitsDejaReferences?.(commitsAVerifier)
    for (const [runId, record] of [...records]) {
      /*
       * DEUX signaux independants, jamais un seul. Un `existsSync` transitoirement faux — disque
       * lent, chemin reseau, copie en cours de creation — suffirait a detruire le manifeste d'un run
       * bien vivant : c'est trop mince pour autoriser une suppression definitive. On exige donc AUSSI
       * que le gestionnaire de copies ne connaisse pas ce run : deux sources qui se trompent en meme
       * temps, de la meme facon, c'est un autre ordre d'improbabilite.
       */
      if (managerIds.includes(runId)) continue
      if (!record.worktreePath || existsSync(record.worktreePath)) continue
      if (this.manager.hasActiveProcesses?.(runId)) continue
      /*
       * Et seuls les etats qui ne participent A AUCUNE reprise sont concernes.
       *
       * Deux tests l'ont impose, chacun sur un cas different : un `complete` non acquitte est
       * l'adresse de rejeu d'un callback perdu, et un run interrompu en pleine publication reste
       * reconnaissable apres un crash par sa reference de recuperation — dans les deux cas la copie
       * n'a rien a voir dans l'affaire, le manifeste seul porte l'information. « Copie disparue » ne
       * dit donc rien sur la recuperabilite : il faut le verifier a part.
       */
      if (ETATS_ENCORE_RECUPERABLES.has(record.publication)) continue
      const commit = record.sourceSha ?? record.publishedSha
      if (commit) {
        const deja = referencesDuLot
          ? referencesDuLot.get(commit)
          : this.manager.commitDejaReference?.(commit)
        if (deja !== true) continue
      }
      this.stateStore.remove(runId)
      records.delete(runId)
    }
  }

  private reconcileExisting(
    inventory?: WorktreeRecoveryInventory,
    residuesPrecalcules?: ReturnType<WorktreeManager['reconcileResidues']>
  ): void {
    // `??` et non `||` : des résidus déjà calculés mais VIDES ne doivent pas relancer le balayage.
    const residues =
      inventory?.residues ?? residuesPrecalcules ?? this.manager.reconcileResidues?.()
    const records = new Map((this.stateStore?.list() ?? []).map((record) => [record.runId, record]))
    this.oublierLesCopiesBalayees(residues?.swept, records)
    this.refermerLesManifestesAccomplis(records)
    this.abandonnerLesRunsABoutDeReprises(records)
    const observed = new Map(inventory?.agents.map((agent) => [agent.agentId, agent]) ?? [])
    const managerIds =
      inventory?.agents.map((agent) => agent.agentId) ?? this.manager.listAgentIds()
    this.oublierLesEtatsSansCopie(records, managerIds)
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
          // `?.` sur `files` AUSSI : l'optionnel ne protegeait que `record`, donc un manifeste sans
          // ce champ (ecrit par une version anterieure, ou tronque) faisait planter TOUTE la
          // reconciliation -- et avec elle l'inventaire de reprise. Trouve en ecrivant le test voisin.
          files: record?.files?.length
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
    } catch (error) {
      // La classification `merge-failed` ne dit PAS quoi reparer. Le `catch` nu jetait la cause
      // reelle : on la conserve EN PLUS d'elle, par le canal `detail` que `persist` porte deja
      // jusqu'a l'activite, au manifeste durable et au recu Git terminal.
      tracked.state = 'blocked'
      tracked.attentionReason = 'merge-failed'
      this.persist(
        tracked,
        'green',
        'blocked',
        error instanceof Error ? error.message : String(error)
      )
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
    } catch (error) {
      // La classification `merge-failed` ne dit PAS quoi reparer. Le `catch` nu jetait la cause
      // reelle : on la conserve EN PLUS d'elle, par le canal `detail` que `persist` porte deja
      // jusqu'a l'activite, au manifeste durable et au recu Git terminal.
      tracked.state = 'blocked'
      tracked.attentionReason = 'merge-failed'
      this.persist(
        tracked,
        'green',
        'blocked',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /**
   * Repêcher, sans qu'on le demande, les travaux qui dorment.
   *
   * LE DÉFAUT : republier n'existait QUE comme un bouton — aucun appelant automatique de
   * `retryRunAsync` dans tout `src/main`. Quatorze travaux terminés attendaient donc sur des
   * branches `autowin/recovery/` qu'un humain devine qu'il faut ouvrir le bon panneau et clique,
   * une fois par travail.
   *
   * Le tri est délégué à `travauxARepecher`, testé à part : c'est lui qui est risqué. Ici on ne
   * fait qu'exécuter, en série — chaque reprise touche l'arbre git, les lancer en parallèle les
   * ferait se refuser mutuellement pour arbre occupé.
   *
   * Un échec n'interrompt pas le lot : un travail définitivement incapable de passer ne doit pas
   * condamner les treize autres.
   */
  async repecherLesTravauxEnAttente(): Promise<string[]> {
    /*
     * L'OBSERVATEUR — sans lui, l'attente active serait exposee et jamais alimentee.
     *
     * Il repond exactement a « la cause de CE blocage est-elle toujours la ? » : l'intersection entre
     * les fichiers que ce run voulait publier (conserves sur le run au moment du refus) et les
     * fichiers actuellement sales de la base. Cette precision est ce qui evite les deux pieges
     * symetriques : un arbre sale sur un fichier SANS RAPPORT ne doit pas faire attendre ce run
     * (l'attente serait sans fin pour rien), et un fichier encore en collision ne doit pas declencher
     * une tentative qui echouerait a l'identique.
     *
     * Lecture seule (`git status`), et une base illisible rend une liste VIDE : dans ce cas
     * `travauxARepecher` retombe sur plafond + delai, jamais sur une conclusion inventee.
     */
    const causeEncoreLa = (candidat: { runId: string; attentionReason?: string }): boolean => {
      if (candidat.attentionReason !== 'base-dirty') return true
      const bloquants = (this.runs.get(candidat.runId)?.files ?? []).map((fichier) => fichier.path)
      if (bloquants.length === 0) return true
      const sales = new Set(this.baseDirtyFiles())
      return bloquants.some((chemin) => sales.has(chemin))
    }
    const aRepecher = travauxARepecher(
      [...this.runs.values()],
      this.derniersRepechages,
      this.now(),
      this.essaisAutomatiques,
      causeEncoreLa
    )
    const tentes: string[] = []
    for (const runId of aRepecher) {
      // Marquer AVANT de tenter : si la reprise jette, le run doit quand même respecter le délai,
      // sinon le balayage suivant le reprend aussitôt et boucle sur le même échec.
      this.derniersRepechages.set(runId, this.now())
      this.essaisAutomatiques.set(runId, (this.essaisAutomatiques.get(runId) ?? 0) + 1)
      tentes.push(runId)
      try {
        await this.retryRunAsync(runId)
      } catch (error) {
        this.recordRecoveryFailure(error)
      }
    }
    this.signalerLesRunsSansSigneDeVie()
    return tentes
  }

  /**
   * DIRE qu'un run affiche « en cours » alors que plus rien ne le porte.
   *
   * Greffe sur le balayage existant plutot que sur une minuterie de plus : le probleme n'est pas la
   * cadence, c'est que personne ne posait la question.
   *
   * On n'annule RIEN et on ne conclut pas a la mort -- un run peut attendre le modele sans processus.
   * On ecrit un fait verifiable dans `detail`, la ou l'interface le lit deja, et l'humain tranche.
   * Le defaut a corriger etait le silence : l'utilisateur a demande « ca tourne la ? on dirait pas »
   * sur un run mort depuis six minutes, et rien dans l'app ne pouvait lui repondre.
   */
  private signalerLesRunsSansSigneDeVie(): void {
    const suspects = runsSansSigneDeVie(
      [...this.runs.values()],
      (runId) => {
        try {
          return this.manager.hasActiveProcesses?.(runId) === true
        } catch {
          // Une sonde de processus indisponible ne doit pas transformer un run sain en suspect.
          return true
        }
      },
      this.now()
    )
    if (!suspects.length) return
    const message = messageSansSigneDeVie(SILENCE_SUSPECT_MS)
    for (const runId of suspects) {
      const tracked = this.runs.get(runId)
      // Ne pas ecraser un detail deja pose, ni re-signaler en boucle le meme run.
      if (!tracked || tracked.detail) continue
      tracked.detail = message
    }
    this.emit()
  }

  /**
   * Arme le filet. Idempotent : deux appels ne créent pas deux minuteries.
   *
   * `unref()` pour la même raison que la minuterie de reprise : ce balayage ne doit JAMAIS retenir
   * l'application ouverte. Un filet de fond n'est pas une raison de ne pas pouvoir quitter.
   */
  demarrerLeBalayageAutomatique(): void {
    if (this.balayageTimer) return
    this.balayageTimer = setInterval(() => {
      // DECLARE au detecteur de gel : un balayage periodique est un candidat naturel aux gels en
      // rafale, et un gel anonyme ne se corrige pas.
      void pendantOperation('timer:coordinator:repecherTravauxEnAttente', () =>
        this.repecherLesTravauxEnAttente().catch((error) => this.recordRecoveryFailure(error))
      )
    }, INTERVALLE_BALAYAGE_MS)
    this.balayageTimer.unref?.()
  }

  /** Désarme le filet — fermeture de l'application, ou test qui ne veut pas d'une minuterie vivante. */
  arreterLeBalayageAutomatique(): void {
    if (!this.balayageTimer) return
    clearInterval(this.balayageTimer)
    this.balayageTimer = undefined
  }

  private scheduleRecoveryRetry(): void {
    if (
      (this.waitingForProcess.size === 0 && this.waitingForRetry.size === 0) ||
      this.recoveryTimer
    )
      return
    /*
     * L'ATTENTE CROÎT avec le nombre d'essais déjà faits, au lieu des 5 s fixes d'avant.
     *
     * La minuterie est PARTAGÉE par tous les runs en attente : on prend donc le délai du MOINS
     * avancé d'entre eux. Sinon un run patient (30 min) retarderait un run tout frais qui n'a
     * besoin que de cinq secondes — la file entière avancerait au rythme du plus lent.
     */
    const essaisDuMoinsAvance = Math.min(
      ...[...this.waitingForRetry, ...this.waitingForProcess].map(
        (runId) => this.retryCounts.get(runId) ?? 0
      )
    )
    const attente = delaiDeReprise(essaisDuMoinsAvance) ?? DELAIS_REPRISE_PLANCHER
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      if (this.manager.operationsAreIsolated?.()) {
        void this.retryRecoveryAsync().catch((error) => this.recordRecoveryFailure(error))
      } else this.retryRecovery()
    }, attente)
    this.recoveryTimer.unref?.()
  }
}
