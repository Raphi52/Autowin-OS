import type { VerdictBureau } from './verdict-bureau'
import { existsSync, linkSync, rmSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { WorktreeConflictDiffResult } from '../../shared/worktree-activity-model'
import { WorktreeOperationClient } from './worktree-operation-client'
import { donneesDuWorker, type WorktreeRecoveryInventory } from './worktree-operation-protocol'
import type { LiaisonDependances } from './dependances-copie-agent'
import { supprimerArbre, supprimerArbreAsync } from '../fichiers/fs-supprimer'
import { cheminAncienDeCopieAgent, cheminNeufDeCopieAgent } from '../copies/chemins-de-copies'
import {
  defaultProcessIdentity,
  prechargerEmpreintesProcessus
} from './worktree-manager-empreintes'
import type {
  FinalizeResult,
  WorktreeRecoveryContext,
  WorktreeRunContext
} from './worktree-manager-types'
export {
  autoriserSondageBloquant,
  defaultProcessIdentity,
  empreinteConnue,
  oublierEmpreintesProcessus,
  prechargerEmpreintesProcessus
} from './worktree-manager-empreintes'
export type {
  FinalizeResult,
  WorktreeRecoveryContext,
  WorktreeRunContext
} from './worktree-manager-types'
// Outils de module et méthodes de la classe découpés en modules voisins (lot 3).
import {
  attacherMethodes,
  GIT_COMMAND_TIMEOUT_MS,
  INVENTAIRE_RECUPERATION_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  assertSafeId,
  canonicalPath,
  type GitRunner,
  defaultGit,
  tryGit,
  tryGitAsync,
  type WorktreeManagerOptions,
  resoudreCheminWorker
} from './worktree-manager-outils'
import * as travaux from './worktree-manager-travaux'
import * as copies from './worktree-manager-copies'
import * as compensation from './worktree-manager-compensation'
import * as cycle from './worktree-manager-cycle'
import * as finalisation from './worktree-manager-finalisation'
export {
  messageCommitAgent,
  tryGitAsync,
  ARGS_REFS_RETENTION,
  resoudreCheminWorker,
  cheminDeStatutPorcelain
} from './worktree-manager-outils'
export type { GitRunner, VerdictRetention, WorktreeManagerOptions } from './worktree-manager-outils'

/** La sonde d'appartenance d'une copie : `--git-common-dir` et `--show-toplevel` en UN lancement. */
const ARGS_SONDE_APPARTENANCE = ['rev-parse', '--git-common-dir', '--show-toplevel']

/**
 * LE VERDICT D'APPARTENANCE, sans aucune E/S : la forme synchrone (`ownershipIssue`) et la forme
 * asynchrone (`ownershipIssueAsync`) le partagent mot pour mot, seules leurs sondes diffèrent.
 * Il ne relance JAMAIS git : une sonde ratée est un refus, pas une invitation à resonder.
 *
 * 1. IDENTITÉ — la copie appartient-elle bien à CE dépôt de base ? Un worktree légitime partage
 *    l'object-store de la base : son `--git-common-dir` résout vers le MÊME `.git`. Une copie laissée
 *    par un autre workspace (le dossier de copies est partagé) a son propre `.git` — écrire dedans
 *    muterait l'index et le HEAD d'un dépôt tiers, aspirant au passage le travail non commité d'un
 *    développeur dans un commit `agent <id>` sur un HEAD détaché. Vérification d'IDENTITÉ et non de
 *    révision : `cat-file -e` ne se déclenche qu'APRÈS le commit, donc trop tard.
 *
 * 2. RACINE PROPRE — la copie est-elle SA PROPRE racine de travail, et non un simple dossier DANS le
 *    dépôt ? MESURE le 2026-08-21 : une copie `agent__command-edit-*` s'est retrouvée SANS fichier
 *    `.git` (création interrompue, ou balayage partiel). Un répertoire sans `.git` fait remonter git
 *    dans l'arborescence, et comme la racine des copies vit DANS le dépôt
 *    (`.autowin-data/autowin-os/worktrees/...`), le dépôt trouvé est l'arbre principal PARTAGÉ. Le
 *    contrôle d'identité ne peut rien voir : les `--git-common-dir` sont identiques par construction.
 *    Dégât réel constaté : `switch -C` a fait basculer la branche de l'utilisateur sur
 *    `autowin/recovery/<agentId>`, puis `add -A` a committé le travail non committé de TROIS sessions
 *    concurrentes dans un seul commit « travail préservé » (32849a15) — rendant tout push contaminant.
 *    Le discriminant : pour une copie légitime, `--show-toplevel` rend la copie elle-même ; pour un
 *    dossier amputé, il rend le dépôt de base.
 *
 * 3. Indéterminable (git muet, chemin absent) → refus : le code appelant bloque avant toute écriture.
 *
 * Les libellés sont lus par `resume-refusal.ts` : ne pas les reformuler.
 */
function verdictAppartenance(
  path: string,
  baseCommon: string | undefined,
  sonde: { code: number; stdout: string }
): string | undefined {
  const [commonBrut, topBrut] =
    sonde.code === 0 ? sonde.stdout.split(String.fromCharCode(10)).map((l) => l.trim()) : []
  const copyCommon = commonBrut
    ? isAbsolute(commonBrut)
      ? commonBrut
      : resolve(path, commonBrut)
    : undefined
  if (baseCommon && copyCommon && canonicalPath(baseCommon) !== canonicalPath(copyCommon)) {
    return `La copie appartient à un autre dépôt (${copyCommon}) que la base (${baseCommon}) : aucune écriture n’y est faite.`
  }
  if (!topBrut) {
    return `Impossible de prouver la racine de travail de la copie ${path} : aucune écriture n’y est faite.`
  }
  const racine = canonicalPath(topBrut)
  if (racine !== canonicalPath(path)) {
    return `La copie ${path} n’est pas une racine de travail : git remonte sur ${racine} (arbre partagé) — aucune écriture n’y est faite.`
  }
  if (!copyCommon || !baseCommon) {
    return `Impossible de prouver l’appartenance Git de la copie ${path} : aucune écriture n’y est faite.`
  }
  return undefined
}

/**
 * Moteur worktree "par défaut, sans intervention" (volet B du cockpit worktree).
 *
 * Donne à CHAQUE agent une copie isolée (git worktree), puis à la fin FUSIONNE son travail dans le
 * repo de base AUTOMATIQUEMENT (full-auto) — SAUF si un conflit est détecté, auquel cas il NE fusionne
 * PAS (garde-fou reco inversée : jamais d'écrasement silencieux), garde la copie intacte et remonte
 * les fichiers en cause pour un merge assisté côté UI. La copie n'est supprimée que si le merge a
 * réussi (réversibilité).
 *
 * S'appuie sur les worktrees détachés partageant le même object-store que le repo de base : un commit
 * fait dans la copie est atteignable par SHA depuis la base, qui peut alors le merger.
 */

export class WorktreeManager {
  /**
   * Ce qu'a donné la dernière liaison des dépendances d'une copie, pour que la trace du run puisse
   * le DIRE. Un lien posé en silence ne s'explique pas le jour où il manque.
   */
  derniereLiaisonDependances?: LiaisonDependances
  readonly baseRepo: string
  readonly worktreeRoot: string
  /** La racine unique des copies de tâche : toute copie d'agent y naît (voir `pathFor`). */
  readonly racineCopiesDeTaches: string
  /** Voir {@link gitCommonDir} : mémorisé pour le dépôt de base seul, échec compris. */
  baseCommonDir?: { valeur: string | undefined }
  readonly git: GitRunner
  readonly tryGitFn: typeof tryGit
  readonly tryGitAsyncFn: typeof tryGitAsync
  readonly removeDirFn: (path: string) => void
  readonly removeDirAsyncFn: (path: string) => Promise<void>
  readonly linkFileFn: (existingPath: string, newPath: string) => void
  readonly removeIndexLockFn: (path: string) => void
  readonly configuredBaseBranch?: string
  readonly requireCanonicalRemote: boolean

  /**
   * UN seul processus externe pour TOUS les PID d'un recensement, avant de les lire un par un.
   *
   * Mesure du 2026-09-04 (gels.jsonl) : 240 s de fil principal tenu, 68 gels, pointe 17,4 s — le
   * recensement des baux lancait un PowerShell PAR PID. Le prechargement ne change aucun verdict :
   * il remplit d'avance la memoire courte que `defaultProcessIdentity` consulte deja. Il ne
   * s'applique QUE quand la sonde reelle est en place — une sonde injectee par un test compte ses
   * propres appels et ne doit pas etre court-circuitee.
   */
  prechargerEmpreintes(pids: readonly number[]): void {
    if (this.processIdentity !== defaultProcessIdentity) return
    prechargerEmpreintesProcessus(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))
  }

  readonly processIdentity: (pid: number) => string | null | undefined
  readonly now: () => number
  readonly operationClient?: WorktreeOperationClient
  /**
   * Copies dont le point de reprise existe encore. Le balayage les garde même propres, inactives et
   * sans travail : les retirer rend la reprise impossible. Posé par le coordinateur avant chaque
   * réconciliation, car seul lui connaît les runs reprenables.
   */
  copiesProtegees: ReadonlySet<string> = new Set<string>()

  constructor(opts: WorktreeManagerOptions) {
    // fix-ok: une copie d'agent n'a de chemin que sous la racine unique ; sans elle, le gestionnaire ne peut rien créer et refuse de naître.
    if (!opts.racineCopiesDeTaches) {
      throw new Error('Pas de racine unique des copies : ce gestionnaire ne crée aucune copie.')
    }
    this.baseRepo = opts.baseRepo
    this.worktreeRoot = opts.worktreeRoot
    this.racineCopiesDeTaches = opts.racineCopiesDeTaches
    this.git = opts.git ?? defaultGit
    this.tryGitFn = opts.tryGitFn ?? tryGit
    const tryGitInjecte = opts.tryGitFn
    this.tryGitAsyncFn =
      opts.tryGitAsyncFn ??
      (tryGitInjecte ? async (repo, args) => tryGitInjecte(repo, args) : tryGitAsync)
    this.removeDirFn = opts.removeDirFn ?? ((path) => supprimerArbre(path))
    const removeDirInjecte = opts.removeDirFn
    this.removeDirAsyncFn =
      opts.removeDirAsyncFn ??
      (removeDirInjecte
        ? async (path) => removeDirInjecte(path)
        : (path) => supprimerArbreAsync(path))
    this.linkFileFn = opts.linkFileFn ?? linkSync
    this.removeIndexLockFn = opts.removeIndexLockFn ?? ((path) => rmSync(path, { force: true }))
    this.configuredBaseBranch = opts.baseBranch
    this.requireCanonicalRemote = opts.requireCanonicalRemote ?? false
    this.processIdentity = opts.processIdentityFn ?? defaultProcessIdentity
    this.now = opts.nowFn ?? Date.now
    const operationWorkerPath = resoudreCheminWorker(__dirname, existsSync)
    if (!opts.disableAsyncOperations && opts.operationWorkerFactory) {
      this.operationClient = new WorktreeOperationClient(operationWorkerPath, {
        timeoutMs: opts.operationTimeoutMs ?? GIT_COMMAND_TIMEOUT_MS + 2_000,
        workerFactory: opts.operationWorkerFactory
      })
    } else if (
      !opts.disableAsyncOperations &&
      !opts.git &&
      !opts.tryGitFn &&
      existsSync(operationWorkerPath)
    ) {
      this.operationClient = new WorktreeOperationClient(operationWorkerPath, {
        timeoutMs: opts.operationTimeoutMs ?? GIT_COMMAND_TIMEOUT_MS + 2_000,
        workerFactory: () =>
          new Worker(operationWorkerPath, {
            // fix-ok: le worker reçoit ses données de `donneesDuWorker`, racine unique comprise : c'est lui qui crée la copie pendant la préparation.
            workerData: donneesDuWorker(this)
          })
      })
    }
  }

  async prepareAsync(
    agentId: string,
    context?: WorktreeRunContext
  ): Promise<{ context: WorktreeRunContext; path: string }> {
    if (!this.operationClient) {
      const resolvedContext = context ?? this.describeForLaunch(agentId)
      return { context: resolvedContext, path: this.acquire(agentId, resolvedContext) }
    }
    return this.operationClient.run({ operation: 'prepare', agentId, context })
  }

  async changedFilesAsync(agentId: string): Promise<string[]> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'changedFiles', agentId })
      : this.changedFiles(agentId)
  }

  /** `fichiersDuTravailDeLaCopie` hors du thread main quand le worker est disponible. */
  async fichiersDuTravailDeLaCopieAsync(agentId: string): Promise<string[]> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'fichiersDuTravail', agentId })
      : this.fichiersDuTravailDeLaCopie(agentId)
  }

  async finalizeAsync(
    agentId: string,
    options: {
      baseBranch?: string
      expectedAgentSha?: string
      /** Tâche du run : décrit le changement dans le message du commit (`messageCommitAgent`). */
      task?: string
      /** Résolution humaine d'un conflit : garder la base (`ours`) ou l'agent (`theirs`). */
      conflictStrategy?: 'ours' | 'theirs'
      onPrepared?: (agentSha: string, baseSha: string) => void
      onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
    } = {}
  ): Promise<FinalizeResult> {
    if (!this.operationClient) return this.finalize(agentId, options)
    const { onPrepared, onIntegrated, ...serializable } = options
    return this.operationClient.run(
      { operation: 'finalize', agentId, options: serializable },
      { onPrepared, onIntegrated },
      { timeoutMs: FINALIZE_TIMEOUT_MS }
    )
  }

  async cleanupPublishedAsync(
    agentId: string,
    publishedSha: string,
    baseBranch?: string,
    agentSha = publishedSha
  ): Promise<FinalizeResult> {
    return this.operationClient
      ? this.operationClient.run({
          operation: 'cleanupPublished',
          agentId,
          publishedSha,
          baseBranch,
          agentSha
        })
      : this.cleanupPublished(agentId, publishedSha, baseBranch, agentSha)
  }

  async acknowledgePublicationAsync(agentId: string, publishedSha: string): Promise<boolean> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'acknowledgePublication', agentId, publishedSha })
      : this.acknowledgePublication(agentId, publishedSha)
  }

  /** Vrai uniquement quand les opérations Git sont réellement déportées hors du main Electron. */
  operationsAreIsolated(): boolean {
    return Boolean(this.operationClient)
  }

  /**
   * L'inventaire de récupération, dans lequel UNE copie cassée ne fait pas perdre les autres.
   *
   * CONSTATÉ en activant réellement l'isolation : une copie dont le lien Git est mort faisait échouer
   * `git status` (`fatal: not a git repository: (NULL)`), l'exception remontait hors de la boucle, et
   * l'inventaire entier était perdu. Le coordinateur enregistrait alors un unique run « Récupération
   * Git » en échec — 215 runs restaurés devenaient 1. Le chemin synchrone, lui, tolérait déjà cette
   * panne copie par copie ; c'est cette asymétrie qui est corrigée ici.
   *
   * Une copie illisible est donc rapportée SANS ses détails plutôt qu'omise : elle reste visible dans
   * la vue Worktrees, ce qui est exactement ce dont on a besoin pour décider de la nettoyer à la main.
   */
  recoveryInventory(): WorktreeRecoveryInventory {
    // Un `reconcileResidues` en échec ne doit pas non plus emporter l'inventaire des copies.
    // En cas d'échec : un inventaire de résidus VIDE, et non pas absent. `blocked` vide veut dire
    // « rien à signaler », ce qui est le comportement sûr — aucun nettoyage ne sera proposé à tort.
    let residues: ReturnType<WorktreeManager['reconcileResidues']>
    try {
      residues = this.reconcileResidues()
    } catch {
      residues = { cleaned: 0, recovered: [], blocked: [] }
    }
    const agents = this.listAgentIds().map((agentId) => {
      let context: WorktreeRunContext | undefined
      try {
        context = this.describe(agentId)
      } catch {
        context = undefined
      }
      let active = false
      try {
        active = this.hasActiveProcesses(agentId)
      } catch {
        active = false
      }
      let changedFiles: ReturnType<WorktreeManager['changedFiles']> = []
      try {
        changedFiles = this.changedFiles(agentId)
      } catch {
        changedFiles = []
      }
      return { agentId, ...(context ? { context } : {}), active, changedFiles }
    })
    return { residues, agents }
  }

  /**
   * Le recensement des travaux non publies, HORS du thread main quand le worker est disponible.
   *
   * Le chemin chaud (`worktree:activity`, appele a chaque affichage) le consommait en synchrone :
   * 14 403 ms de boucle main bloquee au demarrage, mesures le 2026-08-29. Sans worker, on retombe
   * sur la voie synchrone — meme reponse, meme cout : aucun changement de comportement.
   */
  async recensementNonPubliesAsync(
    baseRef = 'HEAD',
    limite = 6
  ): Promise<{
    ids: string[]
    apercu: Array<{
      agentId: string
      date: string
      fichiers: string[]
      verdict?: VerdictBureau
      /** VRAI quand `fichiers` est l'echo d'une lecture ratee, pas une constatation de vide. */
      lectureEchouee?: boolean
    }>
  }> {
    if (this.operationClient) {
      return this.operationClient.run({ operation: 'recensementNonPublies', baseRef, limite })
    }
    return {
      ids: this.travauxNonPublies(baseRef),
      apercu: this.apercuTravauxNonPublies(baseRef, limite).map((e) => ({
        agentId: e.agentId,
        date: e.date,
        fichiers: e.fichiers,
        verdict: e.verdict,
        lectureEchouee: e.lectureEchouee
      }))
    }
  }

  async recoveryInventoryAsync(): Promise<WorktreeRecoveryInventory> {
    return this.operationClient
      ? this.operationClient.run(
          // fix-ok: la requête d'inventaire doit emporter la garde, sinon le fil d'opérations balaie sans elle
          { operation: 'recoveryInventory', copiesProtegees: [...this.copiesProtegees] },
          {},
          { timeoutMs: INVENTAIRE_RECUPERATION_TIMEOUT_MS }
        )
      : this.recoveryInventory()
  }

  async describeAsync(agentId: string): Promise<WorktreeRunContext> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'describe', agentId })
      : this.describe(agentId)
  }

  async hasActiveProcessesAsync(agentId: string): Promise<boolean> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'hasActiveProcesses', agentId })
      : this.hasActiveProcesses(agentId)
  }

  async validateRecoveryContextAsync(
    agentId: string,
    context: WorktreeRecoveryContext
  ): Promise<ReturnType<WorktreeManager['validateRecoveryContext']>> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'validateRecoveryContext', agentId, context })
      : this.validateRecoveryContext(agentId, context)
  }

  async readConflictDiffAsync(
    agentId: string,
    snapshot: { files: string[]; baseSha: string; agentSha: string }
  ): Promise<WorktreeConflictDiffResult> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'readConflictDiff', agentId, snapshot })
      : this.readConflictDiff(agentId, snapshot)
  }

  async discardAsync(agentId: string): Promise<void> {
    if (this.operationClient) {
      await this.operationClient.run({ operation: 'discard', agentId })
      return
    }
    this.discard(agentId)
  }

  /**
   * Où vit la copie de cet agent : son ancien emplacement si elle y existe déjà (une copie en cours ou
   * à publication bloquée s'achève là où elle est), sinon l'emplacement neuf, sous la racine unique.
   */
  pathFor(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    const ancien = cheminAncienDeCopieAgent(this.worktreeRoot, agentId)
    // fix-ok: pathFor lit racineCopiesDeTaches ; la copie neuve va sous la racine unique, et l'ancien emplacement ne sert qu'à reprendre une copie qui y existe déjà.
    if (existsSync(ancien)) return ancien
    const neuf = cheminNeufDeCopieAgent(this.racineCopiesDeTaches, agentId)
    if (neuf === null) throw new Error(`Identifiant de copie refusé : ${agentId}`)
    return neuf
  }

  /** Ce commit est-il connu de la base ? (sans jamais lever : `tryGitFn` rend un code.) */
  revisionExists(rev: string): boolean {
    if (!rev) return false
    return this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${rev}^{commit}`]).code === 0
  }

  /** Répertoire git PARTAGÉ (`--git-common-dir`) d'un dépôt, en absolu ; undefined si indéterminable. */
  /**
   * Le répertoire commun d'un dépôt, mémorisé POUR LE DÉPÔT DE BASE UNIQUEMENT.
   *
   * MESURÉ sur une publication contrariée par un hook concurrent : 445 appels git, dont 105 fois
   * `rev-parse --git-common-dir` sur `baseRepo` — 4,4 s des 28,4 s passées dans git, pour une valeur qui
   * ne peut pas changer pendant la vie de ce manager (un dépôt ne déplace pas sa base en cours
   * d'opération).
   *
   * Le succès SEUL est mémorisé : une indisponibilité peut être temporaire, et un test existant l'exige
   * explicitement (voir plus bas). Et SEULEMENT pour le dépôt de base : sur un chemin de copie, cette sonde sert à
   * PROUVER l'appartenance Git avant d'écrire (`ownershipIssue`). Une copie peut disparaître ou changer
   * de main entre deux appels ; mémoriser un succès ferait prouver une appartenance qui n'est plus
   * vraie, ce qui autoriserait une écriture dans un dossier devenu étranger. Le gain ne vaut pas ça.
   */
  gitCommonDir(repo: string): string | undefined {
    if (repo === this.baseRepo && this.baseCommonDir !== undefined) return this.baseCommonDir.valeur
    return this.retenirCommonDir(repo, this.tryGitFn(repo, ['rev-parse', '--git-common-dir']))
  }

  /** `gitCommonDir` de la base sans tenir la boucle : même mémoire, même règle (succès seul). */
  async gitCommonDirDeLaBaseAsync(): Promise<string | undefined> {
    if (this.baseCommonDir !== undefined) return this.baseCommonDir.valeur
    const probe = await this.tryGitAsyncFn(this.baseRepo, ['rev-parse', '--git-common-dir'])
    return this.retenirCommonDir(this.baseRepo, probe)
  }

  /** Lit la sonde `--git-common-dir` et mémorise le succès de la base — partagé sync/async. */
  retenirCommonDir(repo: string, probe: { code: number; stdout: string }): string | undefined {
    const resultat = ((): string | undefined => {
      if (probe.code !== 0) return undefined
      const raw = probe.stdout.trim()
      if (!raw) return undefined
      return isAbsolute(raw) ? raw : resolve(repo, raw)
    })()
    // Le SUCCÈS seulement. J'avais d'abord mémorisé l'échec aussi, en supposant qu'un dépôt de base
    // illisible ne redevient pas lisible en cours de route. C'est FAUX, et un test existant le disait
    // déjà : « réessaie le rangement quand la preuve Git est temporairement indisponible après
    // publication ». Avec l'échec mémorisé, le réessai voyait toujours l'ancienne absence et rendait
    // `cleanup-pending` au lieu de `merged`. Une sonde qui échoue est donc rejouée, ce qui ne coûte rien :
    // les échecs sont rares, ce sont les 105 succès identiques qui coûtaient.
    if (repo === this.baseRepo && resultat !== undefined) this.baseCommonDir = { valeur: resultat }
    return resultat
  }

  /**
   * La copie appartient-elle au dépôt de base, et est-elle sa propre racine de travail ? Rend la
   * raison du refus, ou `undefined` si l'écriture est permise. Le verdict est {@link verdictAppartenance}.
   */
  ownershipIssue(path: string): string | undefined {
    // fix-ok: gels.jsonl 2026-09-23/24 : `execFileSync git rev-parse` x3 par appel depuis
    // ownershipIssue (jusqu'a 2,3 s). `--git-common-dir` et `--show-toplevel` de la copie sont lus
    // par UN SEUL lancement git ; la base est deja memorisee par gitCommonDir.
    const sonde = this.tryGitFn(path, ARGS_SONDE_APPARTENANCE)
    return verdictAppartenance(path, this.gitCommonDir(this.baseRepo), sonde)
  }

  /**
   * `ownershipIssue` SANS TENIR LA BOUCLE — la forme du balayage horaire des copies.
   *
   * Mesuré dans `gels.jsonl` le 2026-11-06 (heures UTC, démarrage à 10:44:52) : 4 465 ms à 11:44:50
   * et 4 900 ms à 12:44:53, deux passes horaires, chacune avec 3 `execFileSync git rev-parse` venus
   * de la sonde d'`ownershipIssue` (1,5 à 1,7 s par sonde). Le balayage était asynchrone entre deux
   * copies, mais la décision de chaque copie attendait git sur le fil principal. Mêmes sondes, même
   * verdict (`verdictAppartenance`), attendues dans des processus fils. Les deux sondes partent
   * ensemble : elles sont indépendantes.
   *
   * Limite : la CRÉATION de chaque processus reste synchrone sous Windows. Au repos, sur 29 copies
   * sans `.git`, elle coûte 247 à 303 ms quand la forme synchrone en coûte 701 à 926 ms. Les 1,5 s
   * par sonde des gels n'ont pas été décomposées : si elles venaient de la création, cette forme ne
   * les retire pas, et seul le worker d'arrière-plan le ferait (comme `recenserRetentionAsync`).
   */
  async ownershipIssueAsync(path: string): Promise<string | undefined> {
    const [sonde, baseCommon] = await Promise.all([
      this.tryGitAsyncFn(path, ARGS_SONDE_APPARTENANCE),
      this.gitCommonDirDeLaBaseAsync()
    ])
    return verdictAppartenance(path, baseCommon, sonde)
  }
  declare refTravailTrie: typeof travaux.refTravailTrie
  declare shaTravailTrie: OmitThisParameter<typeof travaux.shaTravailTrie>
  declare marquerTravailTrie: OmitThisParameter<typeof travaux.marquerTravailTrie>
  declare oublierTravailTrie: OmitThisParameter<typeof travaux.oublierTravailTrie>
  declare empreinteBureauSali: OmitThisParameter<typeof travaux.empreinteBureauSali>
  declare cleTrieSali: typeof travaux.cleTrieSali
  declare empreinteTravailTrie: OmitThisParameter<typeof travaux.empreinteTravailTrie>
  declare apporteQuelqueChose: typeof travaux.apporteQuelqueChose
  declare headsDesBureaux: typeof travaux.headsDesBureaux
  declare estOrphelin: typeof travaux.estOrphelin
  declare bureauPorteDuTravailNonCommitte: typeof travaux.bureauPorteDuTravailNonCommitte
  declare commitDuTravail: typeof travaux.commitDuTravail

  /*
   * UNE ARCHIVE DE SALVAGE N'EST PAS DU TRAVAIL EN ATTENTE.
   *
   * `salvage` archive tout travail qu'il JETTE sur `autowin/recovery/salvage-<date>-<id>` avant de
   * nettoyer le bureau : c'est ce qui rend le verdict reversible. Comme le recensement enumere
   * `refs/heads/autowin/recovery/*` sans regarder l'origine de la branche, il recomptait ces
   * archives comme du travail a trier. Mesure du 2026-08-29 : trier 2 travaux faisait
   * passer le compteur de 2 a CINQ — le tri produisait plus qu'il ne resolvait, et la liste ne
   * pouvait jamais se vider.
   *
   * L'ancre est le PREFIXE, pas une sous-chaine : `run-salvage-du-panier-1` reste du vrai travail.
   * Rien n'est detruit — la branche archivee reste dans git, seulement hors du recensement.
   */
  static readonly ARCHIVE_SALVAGE = /^salvage-/

  /*
   * UNE EDITION REFUSEE PAR LE TEST N'EST PAS DU TRAVAIL EN ATTENTE DE PUBLICATION.
   *
   * Meme raisonnement pour `command-verify-*` (la copie ne fait que REJOUER les tests, elle n'ecrit
   * rien) : sur cette installation, 19 copies `command-edit-*` et 6 `command-verify-*` sur 26.
   *
   * `edit_file` ouvre une copie isolee nommee `command-edit-<...>`, y pose UN remplacement, lance la
   * verification, et ne publie QUE si elle passe. Une copie `command-edit-*` qui survit est donc, par
   * construction, une edition que le test a REFUSEE : la fusionner remettrait du rouge dans la base.
   * Le recensement la comptait pourtant comme « travail termine jamais publie », au meme titre qu'un
   * run entier.
   *
   * MESURE sur cette installation le 2026-09-04 : 30 branches de secours, 23 sauvetages, et surtout
   * 134 marqueurs `refs/autowin/trie/` — 134 tris deja faits a la main pour une liste qui repart a
   * chaque edition. Le bandeau ne pouvait pas se vider, puisque l'outil qui ecrit le code alimentait
   * lui-meme la file qu'il demandait de trier.
   *
   * Rien n'est detruit : branche de secours, sauvetage et copie restent en place, `salvage` peut
   * toujours les ouvrir nommement. Ils ne CRIENT simplement plus. Les travaux de run (`run-*`), eux,
   * restent recenses : ce sont les seuls qui portent du travail acheve non publie.
   */
  static readonly EDITION_OUTIL = /^command-(edit|verify)-/

  /** La copie de `verify` (`cleDuBureauDeVerification`) : ses fichiers sales sont un miroir du depot. */
  static readonly COPIE_DE_VERIFICATION = /^command-verify-/

  /**
   * COMBIEN DE TEMPS UNE BRANCHE `autowin/*` MERITE-T-ELLE D'ETRE GARDEE — quatorze jours.
   *
   * Ce n'est PAS un delai de securite technique : mesure le 2026-09-08 sur le depot reel, la
   * branche de secours la MOINS eloignee accusait deja 432 commits de retard sur `main`, et celles
   * de moins de sept jours affichaient le meme ecart que les vieilles (jusqu'a 2285). Une
   * sauvegarde n'est donc pas refusionnable au bout d'un mois puis perdue : elle l'est en heures,
   * parce que `main` avance de 73 commits par jour, concentres sur une poignee de fichiers
   * (ChatView.tsx 196 fois en 30 jours, index.ts 157, commands.ts 126).
   *
   * Quatorze jours est un delai HUMAIN : le temps qu'un travail oublie puisse encore etre reclame.
   * Le prolonger ne sauve rien de plus, il accumule -- 89 branches en 22 jours, dont le tri complet
   * du 2026-09-08 n'a rien rendu de recuperable.
   */
  static readonly RETENTION_BRANCHE_MS = 14 * 24 * 60 * 60 * 1_000

  /**
   * FAUT-IL GARDER CETTE BRANCHE DE SECOURS ? -- decision PURE, qui ne supprime rien.
   *
   * Trois verdicts, dans cet ordre, parce que l'ordre porte la prudence :
   *  - `garder` des que le SHA n'a PAS ete consigne. La regle existait en prose dans
   *    `travail-non-publie.ts` (« ne supprime AUCUNE branche sans avoir consigne son SHA : c'est le
   *    seul endroit ou ce travail existe encore ») ; une phrase ne bloque personne, cette condition
   *    si. Elle prime sur tout le reste, age compris.
   *  - `supprimable-sans-perte` quand la branche n'apporte RIEN (contenu deja en base, juge par
   *    empreinte de correctif en amont) : inutile d'attendre quatorze jours pour un doublon. Sur
   *    les 89 branches du 2026-09-08, ce seul critere en designait onze.
   *  - `supprimable-perime` quand elle apporte quelque chose mais depasse la retention.
   *  - `garder` sinon.
   *
   * FAIL-CLOSED : un age inconnu (`undefined`, NaN, date future) ne PERIME jamais. On ne detruit
   * pas sur une donnee qu'on ne sait pas lire.
   */
  static decisionRetentionBranche(entree: {
    apporteQuelqueChose: boolean
    shaConsigne: boolean
    ageMs?: number
    maintenant?: number
  }): 'garder' | 'supprimable-sans-perte' | 'supprimable-perime' {
    if (!entree.shaConsigne) return 'garder'
    if (!entree.apporteQuelqueChose) return 'supprimable-sans-perte'
    const age = entree.ageMs
    if (typeof age !== 'number' || !Number.isFinite(age) || age < 0) return 'garder'
    return age > WorktreeManager.RETENTION_BRANCHE_MS ? 'supprimable-perime' : 'garder'
  }

  /**
   * LES REFS `refs/autowin/*` NE SONT PAS TOUTES DU TRAVAIL — c'est ce qui rend une purge
   * uniforme dangereuse ici.
   *
   * Relevees le 2026-09-08 sur le depot reel : 207 refs, invisibles de `git branch`, donc absentes
   * des 89 branches recensees et de toute politique. Elles se repartissent en TROIS natures que le
   * code lui-meme distingue, et qui ne se purgent pas pareil :
   *
   *  - `trie/` (152) — une ANNOTATION, pas du travail : « elle annote, elle ne represente pas du
   *    travail » (`refTravailTrie`). Elle porte le verdict TRIE d'un travail deja juge. La
   *    supprimer ne libere rien et fait RESSORTIR ce travail dans le bandeau : on rejouerait un tri
   *    deja fait a la main. Elle ne PERIME donc JAMAIS par l'age -- elle ne s'efface qu'avec la
   *    chose qu'elle annote.
   *  - `rescue/` (25) — une vraie SAUVEGARDE : le travail en cours d'une copie, committe pour
   *    rester atteignable apres la disparition du bureau. Meme regle que les branches de secours.
   *  - `integration/` (30) — l'ADRESSE d'un travail en attente d'integration
   *    (`poserAttenteDIntegration`). C'est du travail joignable, pas une annotation : meme regle
   *    que `rescue/`.
   *
   * FAIL-CLOSED sur l'inconnu : une famille non reconnue est traitee comme du travail, jamais comme
   * une annotation jetable. Un futur namespace ne sera donc pas purge par surprise.
   */
  static decisionRetentionRefAutowin(entree: {
    famille: string
    apporteQuelqueChose: boolean
    shaConsigne: boolean
    ageMs?: number
  }): 'garder' | 'supprimable-sans-perte' | 'supprimable-perime' {
    if (entree.famille === 'trie') return 'garder'
    return WorktreeManager.decisionRetentionBranche(entree)
  }
  declare recenserRetention: OmitThisParameter<typeof travaux.recenserRetention>
  declare verdictsRetention: OmitThisParameter<typeof travaux.verdictsRetention>
  declare recenserRetentionAsync: OmitThisParameter<typeof travaux.recenserRetentionAsync>

  /** La famille d'une ref `refs/autowin/<famille>/<id>`, ou `undefined` si la forme n'est pas celle-la. */
  static familleDeRefAutowin(ref: string): string | undefined {
    const m = /^refs\/autowin\/([^/]+)\//.exec(ref)
    return m ? m[1] : undefined
  }
  declare bureauPeutPorterDuTravail: OmitThisParameter<typeof travaux.bureauPeutPorterDuTravail>
  declare travauxNonPublies: OmitThisParameter<typeof travaux.travauxNonPublies>
  declare apercuTravauxNonPublies: OmitThisParameter<typeof travaux.apercuTravauxNonPublies>
  declare patchTravailNonPublie: OmitThisParameter<typeof travaux.patchTravailNonPublie>
  declare restaurerCopieDepuisSecours: OmitThisParameter<typeof travaux.restaurerCopieDepuisSecours>
  declare restaurerCopieDepuisSecoursAsync: OmitThisParameter<
    typeof travaux.restaurerCopieDepuisSecoursAsync
  >
  declare listAgentIds: OmitThisParameter<typeof copies.listAgentIds>
  declare reconcileResiduesAsync: OmitThisParameter<typeof copies.reconcileResiduesAsync>
  declare preserverEtLiberer: OmitThisParameter<typeof copies.preserverEtLiberer>
  declare preserverEtLibererAsync: OmitThisParameter<typeof copies.preserverEtLibererAsync>
  declare reconcileResidues: OmitThisParameter<typeof copies.reconcileResidues>
  declare balayerUneCopie: typeof copies.balayerUneCopie
  declare balayerUneCopieAsync: typeof copies.balayerUneCopieAsync
  declare deciderBalayageDUneCopie: typeof copies.deciderBalayageDUneCopie
  declare deciderBalayageDUneCopieAsync: typeof copies.deciderBalayageDUneCopieAsync
  declare balayerLeChemin: typeof copies.balayerLeChemin
  declare balayerLeCheminAsync: typeof copies.balayerLeCheminAsync
  declare tenterRetraitDisque: typeof copies.tenterRetraitDisque
  declare tenterRetraitDisqueAsync: typeof copies.tenterRetraitDisqueAsync
  declare finirBalayageParLeDisque: typeof copies.finirBalayageParLeDisque

  /** Compteur d'echecs par chemin : un residu qui resiste doit devenir VISIBLE, pas silencieux. */
  readonly echecsDeBalayage = new Map<string, { echecs: number; detail: string }>()
  declare noterEchecDeBalayage: typeof copies.noterEchecDeBalayage
  declare oublierEchecDeBalayage: typeof copies.oublierEchecDeBalayage
  declare blocagesDeBalayage: OmitThisParameter<typeof copies.blocagesDeBalayage>
  declare estWorktreeEnregistree: typeof copies.estWorktreeEnregistree
  declare copiesCandidates: typeof copies.copiesCandidates
  declare commitsDejaReferences: OmitThisParameter<typeof copies.commitsDejaReferences>
  declare commitsDejaReferencesAsync: OmitThisParameter<typeof copies.commitsDejaReferencesAsync>
  declare commitDejaReference: OmitThisParameter<typeof copies.commitDejaReference>
  declare sweepAbandonedAgentCopies: typeof copies.sweepAbandonedAgentCopies
  declare sweepAbandonedAgentCopiesAsync: OmitThisParameter<
    typeof copies.sweepAbandonedAgentCopiesAsync
  >
  declare noterSuppressionCommencee: typeof copies.noterSuppressionCommencee
  declare oublierSuppressionCommencee: typeof copies.oublierSuppressionCommencee
  declare reprendreSuppressionsCommencees: typeof copies.reprendreSuppressionsCommencees
  declare reprendreSuppressionsCommenceesAsync: OmitThisParameter<
    typeof copies.reprendreSuppressionsCommenceesAsync
  >
  declare markProcess: OmitThisParameter<typeof copies.markProcess>
  declare markSpawnIntent: OmitThisParameter<typeof copies.markSpawnIntent>
  declare confirmSpawn: OmitThisParameter<typeof copies.confirmSpawn>
  declare hasActiveProcesses: OmitThisParameter<typeof copies.hasActiveProcesses>
  declare operationInProgress: typeof copies.operationInProgress
  declare blockingDirtyFiles: typeof copies.blockingDirtyFiles
  declare headAdvance: typeof copies.headAdvance
  declare cleanupAgentWorktree: typeof copies.cleanupAgentWorktree
  declare deleteRecoveryRefIfExpected: typeof copies.deleteRecoveryRefIfExpected
  declare restoreRecoveryWorktree: typeof copies.restoreRecoveryWorktree
  declare recoveredPublishedResidue: typeof copies.recoveredPublishedResidue
  declare preservedIgnoredFiles: typeof copies.preservedIgnoredFiles
  declare workingTreeFiles: typeof copies.workingTreeFiles
  declare unpublishedFiles: typeof copies.unpublishedFiles
  declare currentBaseBranch: typeof copies.currentBaseBranch
  declare canonicalRemoteBase: typeof copies.canonicalRemoteBase
  declare isExpectedBaseBranch: typeof copies.isExpectedBaseBranch
  declare activeHooksDir: typeof copies.activeHooksDir
  declare preparePublishHooks: typeof compensation.preparePublishHooks
  declare compensationRoot: typeof compensation.compensationRoot
  declare compensationPlanPath: typeof compensation.compensationPlanPath
  declare compensationPendingPlanPath: typeof compensation.compensationPendingPlanPath
  declare compensationTreeRef: typeof compensation.compensationTreeRef
  declare compensationHooksPath: typeof compensation.compensationHooksPath
  declare compensationPatchRoot: typeof compensation.compensationPatchRoot
  declare cleanupCompensationPatchResidues: typeof compensation.cleanupCompensationPatchResidues
  declare compensationIndexLockPath: typeof compensation.compensationIndexLockPath
  declare parseCompensationIndexLockOwner: typeof compensation.parseCompensationIndexLockOwner
  declare compensationIndexOwnershipRef: typeof compensation.compensationIndexOwnershipRef
  declare isStaleCompensationIndexLock: typeof compensation.isStaleCompensationIndexLock
  declare readCompensationIndexLockOwner: typeof compensation.readCompensationIndexLockOwner
  declare releaseCompensationIndexOwnership: typeof compensation.releaseCompensationIndexOwnership
  declare cleanupCompensationIndexOwnerResidues: typeof compensation.cleanupCompensationIndexOwnerResidues
  declare compensationIndexRecoveryMarkerPath: typeof compensation.compensationIndexRecoveryMarkerPath
  declare parseCompensationIndexRecoveryMarker: typeof compensation.parseCompensationIndexRecoveryMarker
  declare readCompensationIndexRecoveryMarker: typeof compensation.readCompensationIndexRecoveryMarker
  declare persistCompensationIndexRecoveryMarker: typeof compensation.persistCompensationIndexRecoveryMarker
  declare clearCompensationIndexRecoveryMarkers: typeof compensation.clearCompensationIndexRecoveryMarkers
  declare cleanupCompensationIndexRecoveryMarkerResidues: typeof compensation.cleanupCompensationIndexRecoveryMarkerResidues
  declare acquireCompensationIndexLock: typeof compensation.acquireCompensationIndexLock
  declare releaseCompensationIndexLock: typeof compensation.releaseCompensationIndexLock
  declare ownsCompensationIndexLock: typeof compensation.ownsCompensationIndexLock
  declare reconcileCompensationIndexLock: typeof compensation.reconcileCompensationIndexLock
  declare persistCompensationPlan: typeof compensation.persistCompensationPlan
  declare compensationRefEntries: typeof compensation.compensationRefEntries
  declare installCompensationRefs: typeof compensation.installCompensationRefs
  declare removeCompensationGeneration: typeof compensation.removeCompensationGeneration
  declare cleanupObsoleteCompensationRefs: typeof compensation.cleanupObsoleteCompensationRefs
  declare areSafeCompensationPaths: typeof compensation.areSafeCompensationPaths
  declare readCompensationPlan: typeof compensation.readCompensationPlan
  declare sameCompensationIdentity: typeof compensation.sameCompensationIdentity
  declare parseCompensationPlanFile: typeof compensation.parseCompensationPlanFile
  declare clearCompensationPlan: typeof compensation.clearCompensationPlan
  declare compensationPlanFromHooks: typeof compensation.compensationPlanFromHooks
  declare compensationPlanRefsMatch: typeof compensation.compensationPlanRefsMatch
  declare promoteCompensationResidue: typeof compensation.promoteCompensationResidue
  declare compensatePostHookChange: typeof compensation.compensatePostHookChange
  declare snapshotCompensationWorkspace: typeof compensation.snapshotCompensationWorkspace
  declare transformCompensationTree: typeof compensation.transformCompensationTree
  declare compensationCheckpointMatches: typeof compensation.compensationCheckpointMatches
  declare applyCompensationTreePatch: typeof compensation.applyCompensationTreePatch
  declare applyCompensationPlan: typeof compensation.applyCompensationPlan
  declare resumePendingCompensation: typeof compensation.resumePendingCompensation
  declare refManquanteDeHead: typeof cycle.refManquanteDeHead
  declare shaDuReflog: typeof cycle.shaDuReflog
  declare cleanupWorktree: typeof cycle.cleanupWorktree
  declare cleanupWorktreeAsync: typeof cycle.cleanupWorktreeAsync
  declare preparerRetraitDeCopie: typeof cycle.preparerRetraitDeCopie
  declare conclureRetraitDeCopie: typeof cycle.conclureRetraitDeCopie
  declare acquire: OmitThisParameter<typeof cycle.acquire>
  declare rafraichirSiBasePerimee: typeof cycle.rafraichirSiBasePerimee
  declare etatDesDependances: OmitThisParameter<typeof cycle.etatDesDependances>
  declare describe: OmitThisParameter<typeof cycle.describe>
  declare describeForLaunch: OmitThisParameter<typeof cycle.describeForLaunch>
  declare validateRecoveryContext: OmitThisParameter<typeof cycle.validateRecoveryContext>
  declare baseDirtyFiles: OmitThisParameter<typeof cycle.baseDirtyFiles>
  declare baseDirtyFilesAsync: OmitThisParameter<typeof cycle.baseDirtyFilesAsync>
  declare changedFiles: OmitThisParameter<typeof cycle.changedFiles>
  declare fichiersDuTravailDeLaCopie: OmitThisParameter<typeof cycle.fichiersDuTravailDeLaCopie>
  declare readConflictDiff: OmitThisParameter<typeof cycle.readConflictDiff>
  declare finalize: OmitThisParameter<typeof finalisation.finalize>
  declare poserAttenteDIntegration: typeof finalisation.poserAttenteDIntegration
  declare finalizeSansSecours: typeof finalisation.finalizeSansSecours
  declare isPublished: typeof finalisation.isPublished
  declare publicationMarkerRef: typeof finalisation.publicationMarkerRef
  declare rescueRef: typeof finalisation.rescueRef
  declare commitCopyIfDirty: typeof finalisation.commitCopyIfDirty
  declare secureWorkBeforeRefusal: typeof finalisation.secureWorkBeforeRefusal
  declare acknowledgePublication: OmitThisParameter<typeof finalisation.acknowledgePublication>
  declare cleanupPublished: OmitThisParameter<typeof finalisation.cleanupPublished>
  declare remove: OmitThisParameter<typeof finalisation.remove>
  declare ancrerAvantSuppression: typeof finalisation.ancrerAvantSuppression
  declare mettreAlAbriSiDivergente: typeof finalisation.mettreAlAbriSiDivergente
  declare balayerLesCoquilles: OmitThisParameter<typeof finalisation.balayerLesCoquilles>
  declare discard: OmitThisParameter<typeof finalisation.discard>
}

attacherMethodes(WorktreeManager.prototype, travaux)
attacherMethodes(WorktreeManager.prototype, copies)
attacherMethodes(WorktreeManager.prototype, compensation)
attacherMethodes(WorktreeManager.prototype, cycle)
attacherMethodes(WorktreeManager.prototype, finalisation)
