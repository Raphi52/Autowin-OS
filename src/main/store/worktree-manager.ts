import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { balayerCoquillesVides, estCoquilleVide } from './coquilles-vides'
import { verdictDeBureau, type VerdictBureau } from './verdict-bureau'
import type { Dirent } from 'node:fs'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { platform } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { WorktreeConflictDiffResult } from '../../shared/worktree-activity-model'
import { isSameProcessIdentity } from '../process-identity'
import { parsePorcelainPaths } from '../run-autoclose'
import { WorktreeOperationClient } from './worktree-operation-client'
import type { WorktreeRecoveryInventory } from './worktree-operation-protocol'
import {
  delierLesDependances,
  lierLesDependances,
  messageLiaison,
  type LiaisonDependances
} from './dependances-copie-agent'

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

const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** Un SHA git tel que `rev-parse` le rend : c'est ce qu'on accepte comme adresse de travail. */
const HEX_SHA = /^[0-9a-f]{7,40}$/i
const GIT_COMMAND_TIMEOUT_MS = 30_000

/**
 * Budget de l'inventaire de récupération, distinct de celui d'une commande git.
 *
 * MESURÉ sur ce dépôt : cet inventaire balaie 52 copies, chacune avec plusieurs sous-processus git —
 * le seul balayage des copies abandonnées pesait 19,7 s, et la réconciliation complète ~23 s. Avec le
 * budget d'une commande unique (32 s), il était interrompu à mi-course et la récupération repartait en
 * échec. Rien n'attend ce résultat : il alimente une vue, pas un chemin bloquant. Cinq minutes est
 * donc large sans être infini — un worker vraiment pendu reste tué.
 */
const INVENTAIRE_RECUPERATION_TIMEOUT_MS = 300_000
function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value))
    throw new Error(`${label} invalide (caractères non autorisés): ${value}`)
}

/**
 * Forme COMPARABLE d'un chemin : résolue (jonctions/symlinks Windows, `C:\Users` vs `C:\USERS`,
 * chemins UNC), séparateurs unifiés, casse neutralisée, slash final retiré. Sans cette
 * normalisation, deux écritures du MÊME `.git` (une jonction, une casse différente) se comparent
 * comme différentes → la garde « copie étrangère » bloquerait une copie parfaitement légitime.
 * Si le chemin n'existe pas (encore), on retombe sur la forme brute normalisée.
 */
function canonicalPath(path: string): string {
  let resolved = path
  try {
    resolved = realpathSync.native ? realpathSync.native(path) : realpathSync(path)
  } catch {
    resolved = path
  }
  return resolve(resolved).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function shellPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/** Exécuteur git injectable (tests) : renvoie stdout ; jette avec {status, stdout, stderr} si échec. */
export interface GitRunner {
  (repo: string, args: string[]): string
}

const defaultGit: GitRunner = (repo, args) => {
  const stdout = execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return args.includes('-z') ? stdout : stdout.trim()
}

function parseNullSeparatedPaths(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path.length > 0)
}

/** Comme defaultGit mais ne jette PAS : renvoie code + sorties (pour détecter un conflit de merge). */
function tryGit(repo: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? ''
    }
  }
}

export type FinalizeResult =
  | {
      outcome: 'merged'
      agentId: string
      committed: boolean
      /** HEAD de la branche cible juste avant l'intégration. */
      baseSha?: string
      /** Commit exact publié dans la branche cible (peut être un commit de merge). */
      publishedSha?: string
    }
  | { outcome: 'nothing'; agentId: string }
  | {
      outcome: 'conflict'
      agentId: string
      files: string[]
      baseSha: string
      agentSha: string
      /** Adresse durable du travail refusé, quand une a pu être posée. Voir `outcome: 'blocked'`. */
      rescueRef?: string
    }
  | {
      outcome: 'cleanup-pending'
      agentId: string
      files: string[]
      /** Commit réellement installé sur la branche cible. */
      publishedSha: string
      /** HEAD de la copie agent, distinct d'un éventuel commit de merge. */
      agentSha?: string
      baseSha?: string
      detail?: string
      worktreeAvailable?: boolean
    }
  | {
      outcome: 'published-residue'
      agentId: string
      files: string[]
      /** Commit réellement installé sur la branche cible. */
      publishedSha: string
      /** HEAD de la copie agent, distinct d'un éventuel commit de merge. */
      agentSha?: string
      baseSha?: string
      detail?: string
    }
  | {
      outcome: 'blocked'
      agentId: string
      files: string[]
      reason: 'base-dirty' | 'base-in-progress' | 'merge-failed' | 'ignored-deliverables'
      /** Les fichiers remontés diagnostiquent la base ; conserver la provenance agent déjà suivie. */
      preserveAgentFiles?: boolean
      /**
       * Référence git durable où le travail refusé est ATTEIGNABLE, quand une a pu être posée.
       * Absente = il n'y avait rien à sauver, ou l'adresse n'a pas pu être écrite — jamais une
       * promesse creuse : l'appelant ne doit annoncer une adresse que s'il en reçoit une.
       */
      rescueRef?: string
      detail?: string
    }

export interface WorktreeRunContext {
  workspacePath: string
  worktreePath: string
  baseBranch: string
  baseSha: string
  /** Révision exacte remise à l'agent. Absente dans les anciens manifestes = baseSha. */
  sourceSha?: string
  /** Base distante fraîche dont sourceSha contient l'historique, par ex. origin/main. */
  canonicalBaseRef?: string
  /** Changements du workspace volontairement exclus du snapshot commité. */
  excludedDirtyFiles?: string[]
  /** Total réel, conservé même si la liste d'affichage est bornée. */
  excludedDirtyFileCount?: number
  excludedDirtyFilesTruncated?: boolean
  /** Commits locaux non poussés exclus du snapshot quand la base a divergé d'origin. */
  excludedLocalCommits?: string[]
  excludedLocalCommitCount?: number
}

export interface WorktreeRecoveryContext extends Omit<WorktreeRunContext, 'workspacePath'> {
  publication: 'pending' | 'integrating' | 'published' | 'cleanup-pending'
  /** Commit réellement installé dans la branche cible. */
  publishedSha?: string
  /** HEAD de la copie agent préparée, avant un éventuel commit de merge. */
  agentSha?: string
}

export interface WorktreeManagerOptions {
  baseRepo: string
  worktreeRoot: string
  /** Branche de base sur laquelle fusionner (défaut : la branche courante du repo). */
  baseBranch?: string
  /** En production, refuse un job de mutation si origin/main|master ne peut pas être vérifié. */
  requireCanonicalRemote?: boolean
  git?: GitRunner
  /** tryGit injectable (tests) ; défaut = wrapper execFileSync non-jetant. */
  tryGitFn?: typeof tryGit
  /** Suppression disque injectable pour simuler les verrous Windows dans les tests. */
  removeDirFn?: (path: string) => void
  /** Publication atomique du verrou index, injectable pour les tests de crash. */
  linkFileFn?: (existingPath: string, newPath: string) => void
  /** Suppression du verrou index, injectable pour les tests de contention Windows. */
  removeIndexLockFn?: (path: string) => void
  /** Identité stable du processus (démarrage + exécutable), injectable pour les tests. */
  processIdentityFn?: (pid: number) => string | null | undefined
  nowFn?: () => number
  /** Désactive le client worker à l'intérieur du worker lui-même. */
  disableAsyncOperations?: boolean
  operationTimeoutMs?: number
}

interface PublicationCompensationPlan {
  version: 2
  generation?: string
  phase: 'pending' | 'compensated'
  stage: 0 | 1 | 2 | 3 | 4
  agentId: string
  baseSha: string
  publicationSha: string
  expectedBaseBranch: string
  branchPublished: boolean
  agentFiles: string[]
  indexedAgentPaths: string[]
  worktreeAgentPaths: string[]
  untrackedAgentPaths: string[]
  postHookIndexTree: string
  postHookWorktreeTree: string
  resumeIndexTree: string
  resumeWorktreeTree: string
  nextIndexTree?: string
  nextWorktreeTree?: string
}

interface PublicationCompensationIntent {
  version: 1
  agentId: string
  baseSha: string
  publicationSha: string
  expectedBaseBranch: string
  agentFiles: string[]
}

interface CompensationIndexLockOwner {
  owner: 'autowin-compensation'
  pid: number
  identity: string | null
  token: string
  predecessorSerialized?: string | null
  acquireExpiresAt?: number
}

interface CompensationIndexLock {
  path: string
  serialized: string
  ownershipRef: string
  ownershipOid: string
  token: string
}

interface CompensationIndexRecoveryMarker {
  version: 1
  token: string
  state: 'acquiring' | 'abandoned'
  predecessorSerialized: string | null
  expiresAt: number
}

const SPAWN_INTENT_MAX_AGE_MS = 2 * 60 * 1_000
const COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS = 5 * 60 * 1_000
const COMPENSATION_INDEX_MARKER_SWEEP_LIMIT = 256

/**
 * Âge minimal avant qu'une copie agent SANS aucun travail récupérable soit considérée abandonnée.
 * Marge délibérément large : un run vivant qui n'a pas encore posé son lease (fenêtre acquire →
 * markSpawnIntent) reste hors de portée du balayage.
 */
const ABANDONED_AGENT_MIN_AGE_MS = 24 * 60 * 60 * 1_000

/**
 * Age minimal pour une copie qui ne retient RIEN : aucun fichier non publie, et un HEAD deja
 * contenu par une reference du depot. La supprimer ne peut donc rien perdre.
 *
 * POURQUOI CE SECOND SEUIL EXISTE. Mesure du 20/08 sur l'installation de l'utilisateur : 25 copies
 * pour 670 Mo, dont 14 propres et entierement contenues dans `main` — donc sans le moindre enjeu.
 * Aucune n'etait ramassable : creees entre 07:57 et 19:01, toutes avaient moins de 24 h. Une journee
 * de travail produit une copie par `edit_file` (~33 Mo) et le seul mecanisme capable de les rendre
 * refusait de les regarder avant le lendemain. L'utilisateur l'a nomme : « une usine a worktrees
 * abandonnes ».
 *
 * POURQUOI 3 H ET NON 30 MIN. Le delai de 24 h ne protege pas seulement la fenetre
 * `acquire → markSpawnIntent` : il couvre aussi un run VIVANT mais momentanement inactif, dont la
 * mtime cesse d'avancer. Une copie propre et deja publiee est indiscernable d'un residu SAUF par le
 * bail PID (`hasActiveProcesses`). Descendre a quelques minutes ferait donc reposer la securite sur
 * la seule fraicheur de ce bail — et un bail perime apres un crash supprimerait le bureau d'un agent
 * au travail, ce qui serait bien pire que du disque perdu. Trois heures laissent une marge large
 * au-dessus de toute verification longue, tout en vidant l'usine dans la journee.
 */
const RESIDU_SANS_ENJEU_MIN_AGE_MS = 3 * 60 * 60 * 1_000

/** Découpe en lignes, quel que soit le style de fin de ligne rendu par git. */
const LIGNES = /\r?\n/

/**
 * Empreinte d'un processus : heure de démarrage + chemin. Deux processus peuvent porter le MÊME pid
 * à quelques minutes d'écart (recyclage) ; cette empreinte distingue « toujours le nôtre » de
 * « quelqu'un d'autre a hérité du numéro ». Exportée : le rattachement d'un run en a besoin aussi.
 */
export function defaultProcessIdentity(pid: number): string | null | undefined {
  // La disparition du PID et l'échec de la sonde sont deux faits différents. `undefined` est
  // réservé à ESRCH (absence prouvée) ; `null` signifie que le PID existe peut-être encore mais
  // que son empreinte n'a pas pu être lue. Le rattachement traite alors l'agent comme inconnu.
  try {
    process.kill(pid, 0)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return undefined
    return null
  }
  try {
    if (platform() === 'win32') {
      const command =
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
        `$path = ''; try { $path = $p.Path } catch {}; ` +
        `Write-Output ($p.StartTime.ToUniversalTime().Ticks.ToString() + '|' + $path)`
      const identity = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
          encoding: 'utf8',
          timeout: 3_000,
          windowsHide: true
        }
      ).trim()
      return identity || null
    }
    if (platform() === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const fieldsAfterName = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)
      const startedAt = fieldsAfterName[19]
      let executable = ''
      try {
        executable = readlinkSync(`/proc/${pid}/exe`)
      } catch {
        // L'heure de démarrage reste suffisante pour distinguer un PID recyclé.
      }
      return startedAt ? `${startedAt}|${executable}` : null
    }
    const identity = execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 3_000
    }).trim()
    return identity || null
  } catch {
    return null
  }
}

/**
 * L'isolation des opérations Git dans un worker : ACTIVE, et il a fallu deux correctifs pour ça.
 *
 * Elle était éteinte depuis un moment, par ACCIDENT : le chemin du worker était calculé depuis
 * `__dirname`, qui vaut `out/main/chunks` pour ce module (le bundler l'émet dans son propre morceau)
 * alors que le worker vit dans `out/main`. `existsSync` échouait donc toujours, et comme cette présence
 * est la condition de l'isolation, tout le travail Git repassait sur le fil principal sans un mot.
 *
 * Une fois la résolution corrigée, l'activer CASSAIT la récupération : un run restauré au lieu de 215.
 * Deux causes, mesurées et corrigées séparément :
 *  - une seule copie au lien Git mort faisait échouer l'inventaire ENTIER — `recoveryInventory` ne
 *    tolérait pas la panne copie par copie, contrairement au chemin synchrone ;
 *  - l'inventaire recevait le budget d'UNE commande git (32 s) alors qu'il balaie 52 copies. Il était
 *    interrompu à mi-course, avec le message exact « interrompu après 32000 ms » : la mesure disait
 *    vrai, c'est la limite qui était de la mauvaise catégorie.
 *
 * PREUVE d'équivalence, faite AVANT d'activer : les deux chemins restaurent exactement les mêmes 215
 * runs, identifiant par identifiant — 0 manquant, 0 en plus, comparé par différence d'ensembles et non
 * par un compte. Et la latence IPC retombe au plancher : médiane 2 ms, max 1,3 s, contre 3,9 s avec le
 * travail sur le fil principal et 23,9 s avant tout report.
 *
 * Le drapeau qui figeait l'isolation a été RETIRÉ plutôt que passé à `true` : une constante que rien ne
 * bascule est un faux réglage. La vraie porte de sortie existe déjà et sert aux tests —
 * `disableAsyncOperations`.
 */

/**
 * Où trouver `worktree-operation-worker.js` depuis le module qui le lance.
 *
 * Ce n'est pas de la défense excessive, c'est un défaut CONSTATÉ. `WorktreeManager` est assez gros pour
 * que le bundler l'émette dans son propre morceau, `out/main/chunks/worktree-manager-*.js`, tandis que
 * le worker reste à `out/main/worktree-operation-worker.js`. Le chemin calculé depuis `__dirname`
 * désignait donc `out/main/chunks/worktree-operation-worker.js`, qui n'existe pas — et comme la
 * présence du worker est justement la CONDITION de l'isolation, celle-ci était silencieusement
 * éteinte. Aucune erreur, aucun avertissement : tout le travail git repassait sur le fil principal.
 *
 * MESURÉ, c'était l'origine des ~23 s de blocage au démarrage : avec l'isolation réellement active,
 * l'inventaire de récupération est calculé dans le worker et la réconciliation n'exécute plus un seul
 * `git` sur le fil principal.
 *
 * On remonte d'un cran, pas plus : `out/main/chunks` → `out/main` couvre la mise en morceaux sans
 * transformer une résolution en recherche à l'aveugle.
 */
export function resoudreCheminWorker(
  dossierModule: string,
  existe: (chemin: string) => boolean
): string {
  const candidats = [
    join(dossierModule, 'worktree-operation-worker.js'),
    join(dossierModule, '..', 'worktree-operation-worker.js')
  ]
  return candidats.find((candidat) => existe(candidat)) ?? candidats[0]
}

export class WorktreeManager {
  /**
   * Ce qu'a donné la dernière liaison des dépendances d'une copie, pour que la trace du run puisse
   * le DIRE. Un lien posé en silence ne s'explique pas le jour où il manque.
   */
  private derniereLiaisonDependances?: LiaisonDependances
  private readonly baseRepo: string
  private readonly worktreeRoot: string
  /** Voir {@link gitCommonDir} : mémorisé pour le dépôt de base seul, échec compris. */
  private baseCommonDir?: { valeur: string | undefined }
  private readonly git: GitRunner
  private readonly tryGitFn: typeof tryGit
  private readonly removeDirFn: (path: string) => void
  private readonly linkFileFn: (existingPath: string, newPath: string) => void
  private readonly removeIndexLockFn: (path: string) => void
  private readonly configuredBaseBranch?: string
  private readonly requireCanonicalRemote: boolean
  private readonly processIdentity: (pid: number) => string | null | undefined
  private readonly now: () => number
  private readonly operationClient?: WorktreeOperationClient

  constructor(opts: WorktreeManagerOptions) {
    this.baseRepo = opts.baseRepo
    this.worktreeRoot = opts.worktreeRoot
    this.git = opts.git ?? defaultGit
    this.tryGitFn = opts.tryGitFn ?? tryGit
    this.removeDirFn =
      opts.removeDirFn ?? ((path) => rmSync(path, { recursive: true, force: true }))
    this.linkFileFn = opts.linkFileFn ?? linkSync
    this.removeIndexLockFn = opts.removeIndexLockFn ?? ((path) => rmSync(path, { force: true }))
    this.configuredBaseBranch = opts.baseBranch
    this.requireCanonicalRemote = opts.requireCanonicalRemote ?? false
    this.processIdentity = opts.processIdentityFn ?? defaultProcessIdentity
    this.now = opts.nowFn ?? Date.now
    const operationWorkerPath = resoudreCheminWorker(__dirname, existsSync)
    if (
      !opts.disableAsyncOperations &&
      !opts.git &&
      !opts.tryGitFn &&
      existsSync(operationWorkerPath)
    ) {
      this.operationClient = new WorktreeOperationClient(operationWorkerPath, {
        timeoutMs: opts.operationTimeoutMs ?? GIT_COMMAND_TIMEOUT_MS + 2_000,
        workerFactory: () =>
          new Worker(operationWorkerPath, {
            workerData: {
              baseRepo: this.baseRepo,
              worktreeRoot: this.worktreeRoot,
              ...(this.configuredBaseBranch ? { baseBranch: this.configuredBaseBranch } : {}),
              requireCanonicalRemote: this.requireCanonicalRemote
            }
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

  async finalizeAsync(
    agentId: string,
    options: {
      baseBranch?: string
      expectedAgentSha?: string
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
      { onPrepared, onIntegrated }
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

  async recoveryInventoryAsync(): Promise<WorktreeRecoveryInventory> {
    return this.operationClient
      ? this.operationClient.run(
          { operation: 'recoveryInventory' },
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

  private pathFor(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    return join(this.worktreeRoot, `agent__${agentId}`)
  }

  /** Ce commit est-il connu de la base ? (sans jamais lever : `tryGitFn` rend un code.) */
  private revisionExists(rev: string): boolean {
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
  private gitCommonDir(repo: string): string | undefined {
    if (repo === this.baseRepo && this.baseCommonDir !== undefined) return this.baseCommonDir.valeur
    const probe = this.tryGitFn(repo, ['rev-parse', '--git-common-dir'])
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
   * La copie appartient-elle bien à CE dépôt de base ? Un worktree légitime partage l'object-store
   * de la base : son `--git-common-dir` résout vers le MÊME `.git`. Une copie laissée par un autre
   * workspace (le dossier de copies est partagé) a son propre `.git` — écrire dedans muterait
   * l'index et le HEAD d'un dépôt tiers, aspirant au passage le travail non commité d'un
   * développeur dans un commit `agent <id>` sur un HEAD détaché. Vérification d'IDENTITÉ et non de
   * révision : `cat-file -e` ne se déclenche qu'APRÈS le commit, donc trop tard.
   * Indéterminable (git muet, chemin absent) → le code appelant bloque avant toute écriture.
   */
  private foreignCopyDetail(path: string): string | undefined {
    const baseCommon = this.gitCommonDir(this.baseRepo)
    const copyCommon = this.gitCommonDir(path)
    if (!baseCommon || !copyCommon) return undefined
    if (canonicalPath(baseCommon) === canonicalPath(copyCommon)) return undefined
    return `La copie appartient à un autre dépôt (${copyCommon}) que la base (${baseCommon}) : aucune écriture n’y est faite.`
  }

  /**
   * La copie est-elle bien SA PROPRE racine de travail — et non un simple dossier DANS le depot ?
   *
   * MESURE le 2026-08-21 : une copie `agent__command-edit-*` s'est retrouvee SANS fichier `.git`
   * (creation interrompue, ou balayage partiel). Un repertoire sans `.git` fait remonter git dans
   * l'arborescence, et comme la racine des copies vit DANS le depot
   * (`.autowin-data/autowin-os/worktrees/...`), le depot trouve est l'arbre principal PARTAGE.
   * `foreignCopyDetail` ne pouvait rien voir : il compare les `--git-common-dir`, identiques par
   * construction dans ce cas precis.
   *
   * Degat reel constate : `switch -C` a fait basculer la branche de l'utilisateur sur
   * `autowin/recovery/<agentId>`, puis `add -A` a committe le travail non committe de TROIS sessions
   * concurrentes dans un seul commit « travail preserve » (32849a15) — rendant tout push contaminant.
   *
   * Le discriminant est la racine de travail : pour une copie legitime, `--show-toplevel` rend la
   * copie elle-meme ; pour un dossier ampute, il rend le depot de base.
   */
  private copieSansRacinePropre(path: string): string | undefined {
    const top = this.tryGitFn(path, ['rev-parse', '--show-toplevel'])
    if (top.code !== 0) {
      return `Impossible de prouver la racine de travail de la copie ${path} : aucune écriture n’y est faite.`
    }
    const racine = canonicalPath(top.stdout.trim())
    if (racine === canonicalPath(path)) return undefined
    return `La copie ${path} n’est pas une racine de travail : git remonte sur ${racine} (arbre partagé) — aucune écriture n’y est faite.`
  }

  private ownershipIssue(path: string): string | undefined {
    const foreign = this.foreignCopyDetail(path)
    if (foreign) return foreign
    const sansRacine = this.copieSansRacinePropre(path)
    if (sansRacine) return sansRacine
    if (!this.gitCommonDir(path) || !this.gitCommonDir(this.baseRepo)) {
      return `Impossible de prouver l’appartenance Git de la copie ${path} : aucune écriture n’y est faite.`
    }
    return undefined
  }

  /** Inventorie les copies Autowin récupérables après un arrêt du processus. */
  /**
   * Les runs dont le travail est TERMINE mais JAMAIS PUBLIE : leur branche de secours existe et
   * n'est pas fusionnee dans la base.
   *
   * Mesure du 2026-08-23 : trois travaux finis et prouves ont ete perdus de vue le meme jour -- un
   * fond d'ecran, un correctif d'historique, un export Markdown. Chacun dormait sur une branche que
   * personne n'a fusionnee, pendant que l'utilisateur ecrivait « T'as toujours pas fais le fond
   * d'ecran ». Le travail existait ; rien ne le disait.
   *
   * UNE seule commande git repond, et c'est ce qui rend la question posable a chaque affichage :
   * `for-each-ref --no-merged <base>` filtre deja cote git. Ce jour-la : 14 non fusionnees sur 22.
   */
  /**
   * Cette branche apporte-t-elle quelque chose que la base n'a PAS deja ?
   *
   * `--no-merged` juge sur l'ASCENDANCE, et c'est insuffisant : une branche dont le contenu est deja
   * dans la base -- parce qu'il a ete republie, repris a la main, ou passe par un cherry-pick --
   * reste signalee comme « travail non publie » pour toujours. Mesure le 2026-08-24 : l'utilisateur a
   * vu ce bandeau sur un travail bel et bien publie, et le seul moyen de l'eteindre etait une fusion
   * de scellement dont le diff etait VIDE.
   *
   * `git cherry` repond a la bonne question : il compare par `patch-id`, donc il reconnait un commit
   * REAPPLIQUE sous un autre SHA -- exactement ce qu'un cherry-pick produit. Une ligne prefixee `+`
   * est un commit dont aucun equivalent n'existe dans la base ; sans aucune, la branche n'apporte
   * rien et n'a rien a annoncer.
   *
   * COUT : un appel git par branche DEJA signalee, pas par branche existante. Le lot est petit par
   * construction, et le coordinateur met ce resultat en cache soixante secondes
   * (`travauxNonPubliesCaches`) -- ce qui etait precisement la raison d'etre de ce cache.
   *
   * En cas d'echec on repond OUI. Le bandeau doit se tromper du cote qui n'efface rien : signaler un
   * travail deja publie coute une verification, en taire un qui ne l'est pas coute le travail.
   */
  private apporteQuelqueChose(travail: string, baseRef: string): boolean {
    try {
      const sortie = this.git(this.baseRepo, ['cherry', baseRef, travail])
      return sortie.split(/\r?\n/).some((ligne) => ligne.trim().startsWith('+'))
    } catch {
      return true
    }
  }

  /**
   * OU VIT le travail d'un agent -- sa branche de secours, ou son bureau reste en HEAD DETACHE.
   *
   * DEFAUT VECU le 2026-08-26 (run `ef845009a251-1`). Le recensement ne connaissait qu'une seule
   * adresse : `autowin/recovery/<id>`. Or l'orchestrateur laisse aussi des bureaux en HEAD detache,
   * dont le commit n'est reference par AUCUNE ref -- invisible a tout `for-each-ref`, donc invisible
   * au bandeau, a l'IPC et a l'agent. L'utilisateur a demande « fusionne », l'agent a repondu « rien
   * a fusionner », et le commit `7467f237` etait la, dans le bureau, a cote.
   *
   * La branche de secours PRIME quand elle existe : c'est l'adresse durable, celle qui survit a la
   * suppression du bureau. Le HEAD detache n'est que le dernier recours -- mais c'est precisement
   * celui qui manquait.
   */
  /**
   * Le HEAD de CHAQUE bureau, en UNE commande. `git worktree list --porcelain` rend deja tout ce
   * qu'un `rev-parse` par dossier allait rechercher un par un.
   */
  private headsDesBureaux(): Map<string, string> {
    const heads = new Map<string, string>()
    let dossier: string | undefined
    try {
      for (const ligne of this.git(this.baseRepo, ['worktree', 'list', '--porcelain']).split(
        /\r?\n/
      )) {
        if (ligne.startsWith('worktree ')) {
          const nom = ligne
            .slice('worktree '.length)
            .trim()
            .replace(/[\\/]+$/, '')
          const base = nom.split(/[\\/]/).pop() ?? ''
          dossier = base.startsWith('agent__') ? base.slice('agent__'.length) : undefined
          if (dossier !== undefined && !SAFE_ID.test(dossier)) dossier = undefined
        } else if (ligne.startsWith('HEAD ') && dossier !== undefined) {
          const sha = ligne.slice('HEAD '.length).trim()
          if (HEX_SHA.test(sha)) heads.set(dossier, sha)
          dossier = undefined
        }
      }
    } catch {
      // Un depot qui ne repond pas ne prouve AUCUNE perte : on n'annonce rien plutot que d'alarmer.
    }
    return heads
  }

  /**
   * Un commit qu'AUCUNE ref ne contient : la signature d'un travail fabrique dans un bureau.
   *
   * LA POLARITE DU REPLI EST LE POINT. L'audit du 2026-08-26 a releve que ce `catch` rendait
   * `false` -- donc « pas orphelin », donc INVISIBLE -- alors que son voisin `apporteQuelqueChose`
   * rend `true`, et que ce fichier ecrit deux fois la regle : « le bandeau doit se tromper du cote
   * qui n'efface rien ». Sur cet arbre partage ou plusieurs sessions verrouillent l'index, un
   * `for-each-ref` qui echoue transitoirement faisait donc disparaitre un travail reel, sans trace.
   *
   * Le SHA nul (`0000…`) est un cas a part et il est REEL sur ce depot : un bureau pose sur une
   * branche non nee. `for-each-ref --contains` leve dessus (exit 129), et le rattraper en « a
   * signaler » inventerait un travail qui n'existe pas. On l'ecarte explicitement, au lieu de
   * dependre de l'ordre d'evaluation du `&&` en aval.
   */
  private estOrphelin(sha: string): boolean {
    if (/^0+$/.test(sha)) return false
    try {
      return !this.git(this.baseRepo, [
        'for-each-ref',
        '--contains',
        sha,
        '--count=1',
        '--format=%(refname)'
      ]).trim()
    } catch {
      // Se tromper du cote qui n'efface rien : un depot qui ne repond pas ne prouve pas l'absence.
      return true
    }
  }

  private commitDuTravail(agentId: string): string | undefined {
    if (!SAFE_ID.test(agentId)) return undefined
    const secours = `autowin/recovery/${agentId}`
    if (this.revisionExists(secours)) return secours
    const bureau = join(this.worktreeRoot, `agent__${agentId}`)
    if (!existsSync(bureau)) return undefined
    try {
      const sha = this.git(bureau, ['rev-parse', 'HEAD']).trim()
      if (!HEX_SHA.test(sha)) return undefined
      /*
       * LE DISCRIMINANT : un bureau ne compte que si son commit est ORPHELIN.
       *
       * Faux positif mesure sur le vrai depot juste apres le premier jet : SIX bureaux signales pour
       * UN seul vrai travail. Un bureau simplement OUVERT sur une base divergente « apporte » des
       * commits au sens de `git cherry`, sans avoir rien produit -- et cinq cris pour un signal,
       * c'est le defaut du 2026-08-24 rouvert (un bandeau qu'on n'ecoute plus).
       *
       * Un commit fabrique par l'agent dans son bureau detache n'est contenu dans AUCUNE ref ; une
       * base, par construction, en a une. `--contains` tranche donc exactement la bonne question.
       */
      return this.estOrphelin(sha) ? sha : undefined
    } catch {
      // Un bureau sans `.git` lisible ne prouve aucune perte : on ne l'invente pas.
      return undefined
    }
  }

  travauxNonPublies(baseRef = 'HEAD'): string[] {
    try {
      const branches = this.git(this.baseRepo, [
        'for-each-ref',
        '--no-merged',
        baseRef,
        '--format=%(refname:strip=4)',
        'refs/heads/autowin/recovery/'
      ])
        .split('\n')
        .map((ligne) => ligne.trim())
        .filter((agentId) => SAFE_ID.test(agentId))
      /*
       * LES BUREAUX EN HEAD DETACHE, l'autre moitie du recensement (cf. `commitDuTravail`).
       *
       * Le scan de dossiers est le SEUL moyen de les voir : leur commit n'a pas de ref. Le cout est
       * un `rev-parse` par bureau -- borne par le nombre de bureaux vivants, et paye seulement ici.
       * `apporteQuelqueChose` (patch-id) fait ensuite le tri, exactement comme pour les branches :
       * un bureau vide, ou dont le travail a deja ete repris a la main, ne dit rien.
       */
      const detaches = this.listAgentIds().filter((agentId) => !branches.includes(agentId))
      /*
       * UN SEUL `git worktree list` POUR TOUS LES HEADS, et un verdict MEMOISE PAR SHA.
       *
       * Mesure du 2026-08-26 sur ce depot : la version naive faisait quatre processus git par
       * bureau -- 76 au total, 10,4 SECONDES. Deux gachis se cumulaient : un `rev-parse` par bureau
       * alors qu'une seule commande les rend tous, et le meme sha reteste autant de fois qu'il y a
       * de bureaux poses dessus (dix-neuf bureaux ne portaient que six shas distincts, la plupart
       * des bases partagees).
       */
      const heads = this.headsDesBureaux()
      const verdictParSha = new Map<string, boolean>()
      const apporte = (sha: string): boolean => {
        const connu = verdictParSha.get(sha)
        if (connu !== undefined) return connu
        const verdict = this.estOrphelin(sha) && this.apporteQuelqueChose(sha, baseRef)
        verdictParSha.set(sha, verdict)
        return verdict
      }
      return [
        ...branches.filter((agentId) =>
          this.apporteQuelqueChose(`autowin/recovery/${agentId}`, baseRef)
        ),
        ...detaches.filter((agentId) => {
          const sha = heads.get(agentId)
          return sha !== undefined && apporte(sha)
        })
      ]
    } catch {
      // Un depot qui ne repond pas ne prouve AUCUNE perte : on n'annonce rien plutot que d'alarmer.
      return []
    }
  }

  /**
   * De quoi est fait un travail non publie -- pour les PREMIERS seulement.
   *
   * Le sujet du commit de secours ne sert a rien : il repete l'identifiant de la copie (« travail
   * preserve de la copie command-edit-04789dcc… »). Verifie le 2026-08-23 sur les 14 branches. Le
   * seul label qu'un humain reconnait, ce sont les FICHIERS touches -- « app-shell.css », il sait
   * ce que c'est ; un UUID, non.
   *
   * BORNE a `limite` branches, et c'est le point de conception : lister les fichiers coute un appel
   * git PAR branche. On ne paie donc que ce qui sera reellement AFFICHE (trois), jamais les
   * quatorze. Le COMPTE, lui, reste gratuit -- une seule commande, cf. `travauxNonPublies`.
   */
  apercuTravauxNonPublies(
    baseRef = 'HEAD',
    limite = 3
  ): Array<{ agentId: string; date: string; fichiers: string[]; verdict: VerdictBureau }> {
    return this.travauxNonPublies(baseRef)
      .slice(0, Math.max(0, limite))
      .map((agentId) => {
        const commit = this.commitDuTravail(agentId)
        const branche = commit ?? `autowin/recovery/${agentId}`
        let fichiers: string[] = []
        let date = ''
        try {
          fichiers = this.git(this.baseRepo, ['diff', '--name-only', `${baseRef}...${branche}`])
            .split('\n')
            .map((ligne) => ligne.trim())
            .filter(Boolean)
          date = this.git(this.baseRepo, [
            'log',
            '-1',
            '--format=%cd',
            '--date=short',
            branche
          ]).trim()
        } catch {
          // Une branche illisible ne doit pas faire disparaitre les autres du bandeau.
        }
        // Le VERDICT accompagne la liste : sans lui, il faut ouvrir chaque patch pour savoir si
        // un bureau vaut quelque chose — le tri manuel que ce chantier existe pour supprimer.
        return { agentId, date, fichiers, verdict: verdictDeBureau({ fichiers, aUnCommit: !!commit }) }
      })
  }

  /**
   * Le PATCH d'un travail non publie, pour le lire avant d'en decider.
   *
   * Constate le 2026-08-23 : aucune vue de l'app ne listait ces travaux. La vue Workspace ne montre
   * que les bureaux VIVANTS -- elle affichait « 0 bureau » alors que 14 travaux attendaient. Sans un
   * moyen de les LIRE, la seule option restante etait de fusionner ou supprimer a l'aveugle.
   *
   * Borne en taille : un patch de plusieurs milliers de lignes n'est pas lisible dans un panneau, et
   * le transporter par IPC pour rien coute. On tronque, et on le DIT.
   */
  patchTravailNonPublie(
    agentId: string,
    baseRef = 'HEAD',
    maxCaracteres = 20_000
  ): { patch: string; tronque: boolean } {
    if (!SAFE_ID.test(agentId)) return { patch: '', tronque: false }
    const travail = this.commitDuTravail(agentId)
    if (!travail) return { patch: '', tronque: false }
    try {
      const patch = this.git(this.baseRepo, ['diff', `${baseRef}...${travail}`])
      return patch.length > maxCaracteres
        ? { patch: patch.slice(0, maxCaracteres), tronque: true }
        : { patch, tronque: false }
    } catch {
      return { patch: '', tronque: false }
    }
  }

  /**
   * RECREER la copie d'un travail a partir de sa branche de secours.
   *
   * Le chemin etait DOCUMENTE (« restaure par `git worktree add <chemin> autowin/recovery/<id>` »)
   * mais jamais cable. Consequence mesuree le 2026-08-23 : une fois la garde de reprise desserree,
   * la reprise partait quand meme en `merge-failed` -- il n'y avait plus de copie a partir de
   * laquelle fusionner. Ouvrir la porte ne sert a rien si la route derriere est coupee.
   *
   * Rend `true` si une copie utilisable existe apres l'appel -- y compris si elle existait deja.
   */
  restaurerCopieDepuisSecours(agentId: string): boolean {
    if (!SAFE_ID.test(agentId)) return false
    const chemin = join(this.worktreeRoot, `agent__${agentId}`)
    if (existsSync(chemin)) return true
    try {
      // `git worktree add` echoue si la branche est deja extraite ailleurs : c'est une protection,
      // pas un obstacle a contourner. On laisse l'echec remonter en `false`.
      this.git(this.baseRepo, ['worktree', 'add', chemin, `autowin/recovery/${agentId}`])
      return existsSync(chemin)
    } catch {
      return false
    }
  }

  listAgentIds(): string[] {
    const directories = existsSync(this.worktreeRoot)
      ? readdirSync(this.worktreeRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('agent__'))
          .map((entry) => entry.name.slice('agent__'.length))
          .filter((agentId) => SAFE_ID.test(agentId))
      : []
    const recoveryRefs = this.git(this.baseRepo, [
      'for-each-ref',
      '--format=%(refname:strip=4)',
      'refs/heads/autowin/recovery/'
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter((agentId) => SAFE_ID.test(agentId))
    return [...new Set([...directories, ...recoveryRefs])].sort()
  }

  /**
   * Converge les résidus créés par un crash au milieu d'une finalisation.
   * Les copies d'intégration ne sont jetables qu'après promotion durable d'une compensation éventuelle.
   * Une quarantaine est restaurée vers son bureau d'origine, sans jamais être publiée.
   */
  /**
   * `reconcileResidues` en version non bloquante.
   *
   * Seul le balayage est rendu asynchrone, et c'est mesuré : sur 19,7 s de réconciliation, la boucle
   * des copies d'intégration pesait 0-1 ms et la quarantaine autant. Rendre le reste asynchrone
   * n'aurait rien acheté et aurait dupliqué du code pour rien.
   */
  async reconcileResiduesAsync(): Promise<ReturnType<WorktreeManager['reconcileResidues']>> {
    const resultat = this.reconcileResidues({ balayer: false })
    const swept = await this.sweepAbandonedAgentCopiesAsync()
    if (swept.length > 0) resultat.swept = swept
    return resultat
  }

  /**
   * PRESERVE le travail d'une copie abandonnee dans sa branche de recuperation, puis LIBERE la copie.
   *
   * Le probleme mesure le 2026-08-14 sur l'installation de l'utilisateur : 49 copies pour 1 453 Mo,
   * alors que le travail unique qu'elles portent tient en 665 Ko de diff — deux megaoctets de copie
   * par kilooctet utile, et 16 copies sans la moindre modification. Elles survivent parce qu'un run
   * mort sans passer par `finalize` (app fermee, plantage, annulation) ne libere jamais sa copie, et
   * que le balayage refuse — a juste titre — de supprimer un travail qui n'existe nulle part ailleurs.
   *
   * Le mecanisme de sauvetage existait deja pour le travail COMMITTE : `cleanupAgentWorktree` attache
   * HEAD a `autowin/recovery/<agentId>` avant de supprimer, donc le commit survit comme reference.
   * Ce qui manquait, c'est le travail NON COMMITTE — precisement celui qui bloquait tout.
   *
   * On le committe donc sur cette meme branche avant de liberer. Rien n'est perdu : la branche se
   * restaure par `git worktree add <chemin> autowin/recovery/<agentId>`, et le commit satisfait
   * naturellement le critere de surete du balayage (« contenu dans une reference »). Rien n'est
   * publie non plus : cette branche n'est ni `main` ni une branche de travail.
   */
  preserverEtLiberer(agentId: string): {
    outcome: 'libere' | 'preserve-et-libere' | 'refuse' | 'absente'
    branche?: string
    detail?: string
  } {
    assertSafeId(agentId, 'agentId')
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return { outcome: 'absente' }
    // Un run qui tourne encore garde sa copie : la liberer sous ses pieds casserait le run vivant.
    if (this.hasActiveProcesses(agentId)) {
      return { outcome: 'refuse', detail: 'des processus utilisent encore cette copie' }
    }
    const ownership = this.ownershipIssue(path)
    if (ownership) return { outcome: 'refuse', detail: ownership }

    const branche = `autowin/recovery/${agentId}`
    const aDuTravail = this.unpublishedFiles(path).length > 0
    if (aDuTravail) {
      /*
       * `switch -C` DEPLACE la branche : meme ecrasement que `branch -f`, meme perte.
       *
       * L'identite d'un bureau etant stable par tache, cette adresse peut deja porter le travail
       * d'une tentative precedente. On la gare avant de la deplacer, sur la meme regle que
       * `ancrerAvantSuppression` : on n'ecrase que ce qui ne perd rien.
       */
      const teteAvant = this.tryGitFn(path, ['rev-parse', 'HEAD'])
      if (teteAvant.code === 0) this.mettreAlAbriSiDivergente(branche, teteAvant.stdout.trim())
      // `switch -C` : on se place sur la branche de recuperation SANS toucher aux fichiers, puis on
      // committe. Un echec ici interrompt tout — mieux vaut garder la copie que perdre le travail.
      if (this.tryGitFn(path, ['switch', '-C', branche]).code !== 0) {
        return { outcome: 'refuse', detail: 'la branche de récupération n’a pas pu être créée' }
      }
      if (this.tryGitFn(path, ['add', '-A']).code !== 0) {
        return { outcome: 'refuse', detail: 'le travail n’a pas pu être indexé' }
      }
      const commit = this.tryGitFn(path, [
        'commit',
        '--no-verify',
        '-m',
        `autowin: travail préservé de la copie ${agentId}`
      ])
      if (commit.code !== 0 && this.unpublishedFiles(path).length > 0) {
        return { outcome: 'refuse', detail: 'le travail n’a pas pu être préservé' }
      }
    }
    /*
     * LE TRAVAIL DEJA COMMITTE, l'angle mort de `aDuTravail`.
     *
     * `unpublishedFiles()` ne compte que le NON committe. Un bureau dont l'agent a deja committe son
     * travail en HEAD detache rend donc zero, se lit « rien a preserver », et son commit partait avec
     * le dossier. C'est la signature exacte des trois bureaux perdus le 2026-08-26.
     */
    if (!aDuTravail) this.ancrerAvantSuppression(agentId, path)
    if (!this.balayerLeChemin(path)) {
      return { outcome: 'refuse', detail: 'la copie n’a pas pu être supprimée' }
    }
    return aDuTravail ? { outcome: 'preserve-et-libere', branche } : { outcome: 'libere' }
  }

  reconcileResidues(options?: { balayer?: boolean }): {
    cleaned: number
    recovered: string[]
    blocked: Array<{ path: string; detail: string }>
    swept?: string[]
  } {
    const result: {
      cleaned: number
      recovered: string[]
      blocked: Array<{ path: string; detail: string }>
      swept?: string[]
    } = { cleaned: 0, recovered: [], blocked: [] }
    if (!existsSync(this.worktreeRoot)) return result

    for (const entry of readdirSync(this.worktreeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^integration__[A-Za-z0-9_-]+__/.test(entry.name)) continue
      const path = join(this.worktreeRoot, entry.name)
      const ownershipIssue = this.ownershipIssue(path)
      if (ownershipIssue) {
        result.blocked.push({ path, detail: ownershipIssue })
        continue
      }
      const promotion = this.promoteCompensationResidue(path)
      if (!promotion.ok) {
        result.blocked.push({
          path,
          detail: promotion.detail ?? 'La compensation du hook n’a pas pu être rendue durable.'
        })
        continue
      }
      const cleanup = this.cleanupWorktree(path)
      if (cleanup.ok) result.cleaned += 1
      else {
        result.blocked.push({
          path,
          detail: cleanup.detail ?? 'La copie d’intégration orpheline n’a pas pu être nettoyée.'
        })
      }
    }

    // `balayer: false` est utilisé par la variante asynchrone, qui fait ce balayage en rendant la main.
    const swept = options?.balayer === false ? [] : this.sweepAbandonedAgentCopies()
    if (swept.length > 0) result.swept = swept

    const quarantineRoot = join(this.worktreeRoot, '.quarantine')
    if (!existsSync(quarantineRoot)) return result
    for (const entry of readdirSync(quarantineRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const match = entry.name.match(/^([A-Za-z0-9_-]+)__/)
      if (!match) {
        result.blocked.push({
          path: join(quarantineRoot, entry.name),
          detail: 'Nom de quarantaine non reconnu : copie conservée.'
        })
        continue
      }
      const agentId = match[1]
      const quarantinedPath = join(quarantineRoot, entry.name)
      const originalPath = this.pathFor(agentId)
      if (existsSync(originalPath)) {
        result.blocked.push({
          path: quarantinedPath,
          detail: `Le bureau ${agentId} existe déjà : quarantaine conservée.`
        })
        continue
      }

      this.tryGitFn(this.baseRepo, ['worktree', 'repair', quarantinedPath])
      /*
       * UN BUREAU PUBLIE NE REDEVIENT PAS UN BUREAU EN ATTENTE.
       *
       * DEFAUT MESURE le 2026-08-25 sur cinq bureaux. La publication qui aboutit SUPPRIME la branche
       * de recuperation du bureau : cette disparition est son signal de succes. Mais le dossier de
       * quarantaine peut survivre au nettoyage (un verrou de fichier suffit) et ce balayage le
       * remettait alors en place comme un bureau ACTIF, sans jamais demander si sa branche existait
       * encore. Son HEAD ne resolvait plus, donc `git status` rendait le depot ENTIER en nouveau
       * (1564 a 1572 fichiers dans les manifestes), le bureau repassait « en attente de
       * publication », et le repechage automatique le reprenait trois fois en restaurant une copie a
       * chaque passage — la famille des « 682 Mo de copies recreees » du 2026-08-24.
       *
       * CE QUI EST DECIDE ICI, et la nuance est tout le sujet : une branche disparue ne PROUVE PAS
       * qu'un travail est publie (une ref peut se perdre autrement). On exige donc une preuve
       * POSITIVE — le dernier commit du bureau, lu dans son propre reflog, doit se retrouver dans la
       * base. Sans cette preuve, le bureau est CONSERVE et son motif est nomme : ce mecanisme existe
       * pour ne rien perdre, et « ne pas restaurer » ne doit jamais glisser vers « supprimer ».
       */
      const refManquante = this.refManquanteDeHead(quarantinedPath)
      if (refManquante) {
        const sha = this.shaDuReflog(quarantinedPath)
        const publie =
          sha !== undefined &&
          this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', sha, 'HEAD']).code === 0
        if (!publie) {
          result.blocked.push({
            path: quarantinedPath,
            detail: `Bureau conservé : ${refManquante} a disparu et son travail n’est pas prouvé publié.`
          })
          continue
        }
        const menage = this.cleanupWorktree(quarantinedPath)
        if (menage.ok) result.cleaned += 1
        else {
          result.blocked.push({
            path: quarantinedPath,
            detail:
              menage.detail ??
              'Bureau publié, mais sa copie de quarantaine n’a pas pu être supprimée.'
          })
        }
        continue
      }
      const ownershipIssue = this.ownershipIssue(quarantinedPath)
      if (ownershipIssue) {
        result.blocked.push({ path: quarantinedPath, detail: ownershipIssue })
        continue
      }
      try {
        renameSync(quarantinedPath, originalPath)
      } catch (error) {
        result.blocked.push({
          path: quarantinedPath,
          detail: error instanceof Error ? error.message : String(error)
        })
        continue
      }
      const repair = this.tryGitFn(this.baseRepo, ['worktree', 'repair', originalPath])
      if (repair.code === 0) {
        result.recovered.push(agentId)
        continue
      }
      try {
        renameSync(originalPath, quarantinedPath)
        this.tryGitFn(this.baseRepo, ['worktree', 'repair', quarantinedPath])
      } catch {
        // Les deux chemins sont inventoriés juste après ; aucune suppression n'est tentée.
      }
      result.blocked.push({
        path: existsSync(originalPath) ? originalPath : quarantinedPath,
        detail: (repair.stderr || repair.stdout).trim() || 'Réparation Git impossible.'
      })
    }
    return result
  }

  /**
   * Supprime les copies `agent__*` dont le run s'est terminé SANS publication (échec, abandon,
   * crash) : la finalisation ne range que le chemin `merged`, donc sans ce balayage chaque run
   * stérile laisse un worktree définitif (811 mesurés le 2026-08-05 sur ce dépôt).
   *
   * Une copie n'est supprimée QUE si elle ne peut rien faire perdre — les quatre conditions sont
   * cumulatives et chacune est vérifiée sur l'état Git réel, jamais sur un registre applicatif :
   *   1. aucun processus vivant ne la détient (lease PID + intention de spawn) ;
   *   2. son arborescence de travail est vide (fichiers suivis ET ignorés préservés) ;
   *   3. son HEAD est déjà contenu dans une référence — un commit propre à la copie la conserve ;
   *   4. elle est plus vieille que la fenêtre de spawn.
   * Le moindre doute conserve la copie : ce balayage ne remonte aucun blocage.
   */
  /**
   * Le balayage d'UNE copie abandonnée. Rend l'identifiant balayé, ou `undefined`.
   *
   * Extrait de la boucle pour qu'un appelant puisse rendre la main entre deux copies — voir
   * {@link sweepAbandonedAgentCopiesAsync}. MESURÉ sur 52 copies : 19,5 s de travail synchrone qui
   * balayait 0 copie, soit ~375 ms par copie en sous-processus git.
   *
   * L'ORDRE des gardes est délibéré : du moins cher au plus cher. Mesuré par garde, par copie :
   * âge ~0,1 ms · processus actifs ~0,1 ms · appartenance ~167 ms · fichiers non publiés ~292 ms.
   * L'âge était évalué APRÈS l'appartenance, donc 10 copies trop jeunes payaient deux `git` pour rien.
   * Toutes ces gardes sont des prédicats en lecture seule : les réordonner ne change aucun verdict,
   * seulement le nombre d'appels évités.
   */
  private balayerUneCopie(entry: Dirent): string | undefined {
    if (!entry.isDirectory() || !entry.name.startsWith('agent__')) return undefined
    const agentId = entry.name.slice('agent__'.length)
    if (!SAFE_ID.test(agentId)) return undefined
    const path = join(this.worktreeRoot, entry.name)

    let ageMs: number
    try {
      ageMs = this.now() - statSync(path).mtimeMs
    } catch {
      return undefined
    }
    // Plancher commun : en dessous, aucune copie n'est regardee, quel que soit son etat.
    if (!(ageMs >= RESIDU_SANS_ENJEU_MIN_AGE_MS)) return undefined

    if (this.hasActiveProcesses(agentId)) return undefined
    if (this.ownershipIssue(path)) return undefined

    /**
     * Du travail non publie ne bloque plus le balayage : il est PRESERVE, puis la copie est liberee.
     *
     * C'est ici que se jouaient les 1 453 Mo mesures le 2026-08-14 pour 665 Ko de travail unique.
     * L'ancienne regle — « une copie qui porte du travail ne se touche pas » — etait juste sur le
     * fond et sans issue sur la forme : un run mort sans passer par `finalize` laissait sa copie pour
     * toujours, puisque rien ne viendrait jamais publier ce travail.
     *
     * `preserverEtLiberer` le committe sur `autowin/recovery/<agentId>` avant de supprimer : le
     * travail devient une REFERENCE du depot, restaurable par `git worktree add`, et cesse d'occuper
     * 30 Mo. La garantie « on ne detruit jamais un travail qui n'existe nulle part ailleurs » est
     * donc tenue plus fort qu'avant — avant, ce travail n'etait sauvegarde nulle part.
     */
    /*
     * L'ORDRE des gardes reste du moins cher au plus cher, mais l'age ne tranche plus seul : il faut
     * savoir si la copie retient quelque chose AVANT de choisir le seuil qui s'applique. Une copie
     * agee de 3 a 24 h paie donc desormais `ownershipIssue` (~167 ms) et `unpublishedFiles`
     * (~292 ms) la ou elle sortait en ~0,1 ms. C'est un cout assume : ce balayage est opportuniste,
     * rien n'attend son resultat, et la variante async rend la main entre chaque copie.
     */
    if (this.unpublishedFiles(path).length > 0) {
      // Elle retient du travail : la marge LARGE d'origine s'applique, inchangee.
      if (!(ageMs >= ABANDONED_AGENT_MIN_AGE_MS)) return undefined
      const preserve = this.preserverEtLiberer(agentId)
      return preserve.outcome === 'preserve-et-libere' || preserve.outcome === 'libere'
        ? agentId
        : undefined
    }

    const head = this.tryGitFn(path, ['rev-parse', 'HEAD'])
    if (head.code !== 0) return undefined
    const sha = head.stdout.trim()
    if (!/^[0-9a-f]{40,64}$/i.test(sha)) return undefined
    const reference = this.commitDejaReference(sha)
    if (reference === undefined) return undefined
    if (!reference) {
      /**
       * Commit atteignable par AUCUNE reference : on le RATTACHE avant de liberer.
       *
       * MESURE le 2026-08-14, apres que la preservation du travail non committe ait rendu 971 Mo
       * (49 copies -> 18) : les 18 restantes sont 10 copies protegees par l'age (runs de moins de
       * 24 h) et 8 qui sont TOUTES ce cas — `refs=0`, `sales=0`, 185 a 213 h d'age, 216 Mo. Le refus
       * d'y toucher etait juste (supprimer la copie perdrait un commit que rien ne retient) mais sans
       * issue : rien ne viendrait jamais rattacher le commit d'un run mort.
       *
       * Aucun commit n'est CREE ici — on ne fait que rendre atteignable celui qui existe deja. Un
       * echec de creation interrompt tout : perdre un commit unique pour gagner 30 Mo serait le pire
       * echange possible.
       */
      // Rattacher un commit, c'est AGIR : le chemin accelere se limite a « rien a faire sauf
      // supprimer ». Une copie de 3 a 24 h dont le HEAD n'est reference nulle part garde donc la
      // marge large — creer une branche pour le compte d'un run peut-etre encore vivant serait un
      // effet de bord, pas un ramassage.
      if (!(ageMs >= ABANDONED_AGENT_MIN_AGE_MS)) return undefined
      const branche = `autowin/recovery/${agentId}`
      if (this.tryGitFn(this.baseRepo, ['branch', '--force', branche, sha]).code !== 0) {
        return undefined
      }
    }

    return this.balayerLeChemin(path) ? agentId : undefined
  }

  /**
   * Supprime une copie ABANDONNEE, qu'elle soit encore enregistree par git ou non.
   *
   * MESURE le 2026-08-14 sur l'installation de l'utilisateur : 57 dossiers de copies pour 3,6 Go,
   * dont 22 que git ne connaissait PLUS (`git worktree remove` repondait « is not a working tree »).
   * Le balayage passant uniquement par cette commande, ces 1,3 Go etaient invisibles aux deux
   * mecanismes — ni git ni Autowin ne pouvaient les enlever — et s'accumulaient a chaque usage.
   *
   * L'appelant a DEJA verifie tout ce qui protege du travail : age, absence de processus actif,
   * propriete, aucun fichier non publie, et commit contenu dans une reference du depot. Ce qui reste
   * ici n'est donc qu'une question de MOYEN de suppression, pas de securite.
   */
  private balayerLeChemin(path: string): boolean {
    if (this.cleanupWorktree(path, false).ok) return true
    // Non enregistree : git ne peut rien pour elle, mais le dossier existe et pese. On le retire
    // directement, puis on elague le registre au cas ou une entree morte y subsisterait.
    if (!this.estWorktreeEnregistree(path)) {
      try {
        this.removeDirFn(path)
      } catch {
        return false
      }
      this.tryGitFn(this.baseRepo, ['worktree', 'prune'])
      return !existsSync(path)
    }
    return false
  }

  /** La copie figure-t-elle encore au registre `git worktree list` ? */
  private estWorktreeEnregistree(path: string): boolean {
    const liste = this.tryGitFn(this.baseRepo, ['worktree', 'list', '--porcelain'])
    if (liste.code !== 0) return true // dans le doute, on ne supprime pas a la main
    const cible = resolve(path).toLowerCase()
    return liste.stdout
      .split(LIGNES)
      .filter((ligne) => ligne.startsWith('worktree '))
      .some((ligne) => resolve(ligne.slice('worktree '.length).trim()).toLowerCase() === cible)
  }

  private copiesCandidates(): Dirent[] {
    return existsSync(this.worktreeRoot)
      ? readdirSync(this.worktreeRoot, { withFileTypes: true })
      : []
  }

  /**
   * Le commit est-il deja retenu par une reference du depot ?
   *
   * UNE seule definition de « deja dans l'historique », partagee par le balayage de copies et par la
   * fermeture des manifestes orphelins. En avoir deux qui divergent serait pire que n'en avoir
   * aucune : c'est ce test qui autorise a supprimer, donc il ne doit exister qu'a un endroit.
   *
   * Rend `undefined` quand git ne repond pas — l'ignorance n'est pas une reponse negative, et
   * l'appelant doit s'abstenir plutot que de supposer.
   */
  commitDejaReference(sha: string): boolean | undefined {
    if (!/^[0-9a-f]{40,64}$/i.test(sha)) return undefined
    const containing = this.tryGitFn(this.baseRepo, [
      'for-each-ref',
      '--contains',
      sha,
      '--count=1',
      '--format=%(refname)'
    ])
    if (containing.code !== 0) return undefined
    return Boolean(containing.stdout.trim())
  }

  private sweepAbandonedAgentCopies(): string[] {
    const swept: string[] = []
    for (const entry of this.copiesCandidates()) {
      const balayee = this.balayerUneCopie(entry)
      if (balayee) swept.push(balayee)
    }
    return swept
  }

  /**
   * Le même balayage, en rendant la main au fil principal entre chaque copie.
   *
   * Sans cela, ce travail gelait l'application ~19,5 s : aucun IPC ne pouvait être servi, alors que
   * ce balayage est du ramassage OPPORTUNISTE dont rien n'attend le résultat.
   */
  async sweepAbandonedAgentCopiesAsync(): Promise<string[]> {
    const swept: string[] = []
    for (const entry of this.copiesCandidates()) {
      const balayee = this.balayerUneCopie(entry)
      if (balayee) swept.push(balayee)
      // `setImmediate` et non `setTimeout(0)` : on repasse par la boucle d'événements — donc les IPC
      // en attente sont servis — sans ajouter de délai par copie.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return swept
  }

  /** Lease durable par PID : empêche une autre instance de récupérer une copie encore utilisée. */
  markProcess(agentId: string, pid: number, active: boolean): void {
    assertSafeId(agentId, 'agentId')
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`pid invalide: ${pid}`)
    const leaseDir = join(this.worktreeRoot, '.leases', agentId)
    const leasePath = join(leaseDir, String(pid))
    if (active) {
      mkdirSync(leaseDir, { recursive: true })
      writeFileSync(
        leasePath,
        JSON.stringify({ identity: this.processIdentity(pid) ?? null, recordedAt: Date.now() })
      )
      return
    }
    rmSync(leasePath, { force: true })
    if (existsSync(leaseDir) && readdirSync(leaseDir).length === 0) {
      rmSync(leaseDir, { recursive: true, force: true })
    }
  }

  /** Barrière pré-spawn : un crash entre l'intention et le PID ne déclenche jamais un cleanup. */
  markSpawnIntent(agentId: string, token: string, active: boolean): void {
    assertSafeId(agentId, 'agentId')
    assertSafeId(token, 'spawn token')
    const leaseDir = join(this.worktreeRoot, '.leases', agentId)
    const intentPath = join(leaseDir, `spawn-pending-${token}`)
    if (active) {
      mkdirSync(leaseDir, { recursive: true })
      writeFileSync(intentPath, String(this.now()))
      return
    }
    rmSync(intentPath, { force: true })
  }

  /** Transfert atomique intention → PID : aucun crash ne peut laisser une fenêtre sans lease. */
  confirmSpawn(agentId: string, token: string, pid: number): void {
    assertSafeId(agentId, 'agentId')
    assertSafeId(token, 'spawn token')
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`pid invalide: ${pid}`)
    const leaseDir = join(this.worktreeRoot, '.leases', agentId)
    const intentPath = join(leaseDir, `spawn-pending-${token}`)
    const leasePath = join(leaseDir, String(pid))
    renameSync(intentPath, leasePath)
    writeFileSync(
      leasePath,
      JSON.stringify({ identity: this.processIdentity(pid) ?? null, recordedAt: Date.now() })
    )
  }

  /** Nettoie les leases de PID morts et indique si un CLI vivant possède encore la copie. */
  hasActiveProcesses(agentId: string): boolean {
    assertSafeId(agentId, 'agentId')
    const leaseDir = join(this.worktreeRoot, '.leases', agentId)
    if (!existsSync(leaseDir)) return false
    let active = false
    for (const entry of readdirSync(leaseDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith('spawn-pending-')) {
        const intentPath = join(leaseDir, entry.name)
        const recordedAt = Number(readFileSync(intentPath, 'utf8'))
        if (
          Number.isFinite(recordedAt) &&
          this.now() - recordedAt >= 0 &&
          this.now() - recordedAt < SPAWN_INTENT_MAX_AGE_MS
        ) {
          active = true
        } else {
          rmSync(intentPath, { force: true })
        }
        continue
      }
      const pid = Number(entry.name)
      if (!entry.isFile() || !Number.isSafeInteger(pid) || pid <= 0) {
        rmSync(join(leaseDir, entry.name), { recursive: entry.isDirectory(), force: true })
        continue
      }
      const leasePath = join(leaseDir, entry.name)
      let lease: { identity: string | null; recordedAt: number }
      try {
        const raw = readFileSync(leasePath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<typeof lease>
        lease = {
          identity: typeof parsed.identity === 'string' ? parsed.identity : null,
          recordedAt: typeof parsed.recordedAt === 'number' ? parsed.recordedAt : Number(raw)
        }
      } catch {
        lease = { identity: null, recordedAt: 0 }
      }
      const currentIdentity = this.processIdentity(pid)
      if (
        lease.identity &&
        currentIdentity &&
        !isSameProcessIdentity(lease.identity, currentIdentity)
      ) {
        rmSync(leasePath, { force: true })
        continue
      }
      try {
        process.kill(pid, 0)
        active = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          active = true
        } else {
          rmSync(leasePath, { force: true })
        }
      }
    }
    if (!active && existsSync(leaseDir) && readdirSync(leaseDir).length === 0) {
      rmSync(leaseDir, { recursive: true, force: true })
    }
    return active
  }

  private operationInProgress(repo = this.baseRepo): string[] | undefined {
    const conflictOut = this.tryGitFn(repo, ['diff', '--name-only', '-z', '--diff-filter=U'])
    const conflictFiles = parseNullSeparatedPaths(conflictOut.stdout)
    const operationPaths = [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'REBASE_HEAD',
      'BISECT_START',
      'rebase-merge',
      'rebase-apply',
      'sequencer'
    ]
    const hasOperation = operationPaths.some((name) => {
      const gitPath = this.tryGitFn(repo, ['rev-parse', '--git-path', name])
      if (gitPath.code !== 0) return false
      const candidate = gitPath.stdout.trim()
      return (
        candidate.length > 0 &&
        existsSync(isAbsolute(candidate) ? candidate : resolve(repo, candidate))
      )
    })
    return conflictFiles.length > 0 || hasOperation ? conflictFiles : undefined
  }

  private blockingDirtyFiles(agentFiles: string[]): string[] {
    const dirtyFiles = parsePorcelainPaths(
      this.git(this.baseRepo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    )
    return agentFiles.filter((file) => dirtyFiles.includes(file))
  }

  private headAdvance(path: string, expectedSha: string): { advanced: boolean; files: string[] } {
    const currentSha = this.git(path, ['rev-parse', 'HEAD'])
    if (currentSha === expectedSha) return { advanced: false, files: [] }
    const files = parseNullSeparatedPaths(
      this.git(path, ['diff', '--name-only', '-z', `${expectedSha}..${currentSha}`])
    )
    return { advanced: true, files }
  }

  /**
   * Attache HEAD à une branche durable avant suppression. Tout commit concurrent avance alors
   * cette référence Git ; après le remove, on peut restaurer la copie au lieu de perdre le commit.
   */
  private cleanupAgentWorktree(
    agentId: string,
    path: string,
    expectedSha: string
  ): { ok: boolean; advanced: boolean; files: string[] } {
    const branch = `autowin/recovery/${agentId}`
    const attach = this.tryGitFn(path, ['switch', '-C', branch])
    if (attach.code !== 0) return { ok: false, advanced: false, files: [] }

    const beforeCleanup = this.headAdvance(path, expectedSha)
    if (beforeCleanup.advanced) {
      return { ok: false, advanced: true, files: beforeCleanup.files }
    }

    const quarantineRoot = join(this.worktreeRoot, '.quarantine')
    const quarantinePath = join(quarantineRoot, `${agentId}__${randomUUID()}`)
    mkdirSync(quarantineRoot, { recursive: true })
    try {
      renameSync(path, quarantinePath)
    } catch {
      return { ok: false, advanced: false, files: this.unpublishedFiles(path) }
    }
    const restore = (): void => {
      if (!existsSync(path) && existsSync(quarantinePath)) renameSync(quarantinePath, path)
      this.tryGitFn(this.baseRepo, ['worktree', 'repair', path])
    }
    const repair = this.tryGitFn(this.baseRepo, ['worktree', 'repair', quarantinePath])
    if (repair.code !== 0) {
      restore()
      return { ok: false, advanced: false, files: this.unpublishedFiles(path) }
    }

    const quarantinedAdvance = this.headAdvance(quarantinePath, expectedSha)
    const quarantinedFiles = this.unpublishedFiles(quarantinePath)
    if (quarantinedAdvance.advanced || quarantinedFiles.length > 0) {
      restore()
      return {
        ok: false,
        advanced: quarantinedAdvance.advanced,
        files: [...new Set([...quarantinedAdvance.files, ...quarantinedFiles])]
      }
    }

    const cleanup = this.cleanupWorktree(quarantinePath, false)
    if (!cleanup.ok) {
      restore()
      return {
        ok: false,
        advanced: false,
        files: this.unpublishedFiles(path)
      }
    }

    const durableSha = this.git(this.baseRepo, ['rev-parse', branch])
    if (durableSha !== expectedSha) {
      const files = parseNullSeparatedPaths(
        this.git(this.baseRepo, ['diff', '--name-only', '-z', `${expectedSha}..${durableSha}`])
      )
      this.tryGitFn(this.baseRepo, ['worktree', 'add', path, branch])
      return { ok: false, advanced: true, files }
    }

    /*
     * LA REF NE SE SUPPRIME QUE SI ELLE NE PROTEGE RIEN.
     *
     * CausalHypothesis (verifiee le 2026-08-26) : `deleteRecoveryRefIfExpected` demande « HEAD a-t-il
     * bouge depuis mon `rev-parse` ? ». Or `expectedSha` EST le commit de l'agent : pour un bureau
     * dont le travail est deja committe en HEAD detache, l'egalite est garantie, donc la ref etait
     * supprimee A TOUS LES COUPS. Le dossier venait d'etre balaye juste au-dessus : le commit se
     * retrouvait sans dossier ET sans ref, hors de tout `for-each-ref` -- invisible au recensement, et
     * candidat au prochain `gc`.
     *
     * MESURE en rangeant cette installation : trois bureaux ont perdu leur ref ainsi, dont `7467f237`
     * (lunes/nuage + son test de contrat, vert). Ils n'ont survecu qu'a un `git branch` pose a la main.
     * C'est aussi la cause du « rien a fusionner » repete : l'agent cherche ce qu'aucune ref ne porte
     * plus.
     *
     * La bonne question vit deja dans ce fichier : `apporteQuelqueChose` (patch-id contre la base) --
     * celle que le recensement pose. Un bureau qui n'apporte rien laisse toujours son ref partir : on
     * ne garde pas une adresse pour du vide, c'est l'intention d'origine et elle est preservee.
     *
     * LA BASE EST 'HEAD', DELIBEREMENT, et ce n'est PAS `main` : c'est la branche courante du depot de
     * base, donc une reference MOUVANTE sur un arbre partage. C'est exactement la base que
     * `travauxNonPublies` utilise (son parametre `baseRef` vaut 'HEAD' par defaut) : garder ou
     * supprimer une adresse doit repondre a la MEME question que « ce travail est-il encore a
     * publier ? », sinon le rangement et le recensement divergent — une adresse gardee que le
     * recensement ignore, ou l'inverse. Angle mort assume : deux commits au patch-id identique se
     * lisent comme un seul, donc un travail dont le diff est deja dans HEAD par une autre voie laisse
     * son adresse partir. C'est le comportement voulu (il n'apporte rien), pas un oubli.
     */
    if (this.apporteQuelqueChose(branch, 'HEAD')) {
      return { ok: true, advanced: false, files: [] }
    }
    const deleteRef = this.deleteRecoveryRefIfExpected(branch, expectedSha)
    if (deleteRef.advanced) {
      this.tryGitFn(this.baseRepo, ['worktree', 'add', path, branch])
      return { ok: false, advanced: true, files: deleteRef.files }
    }
    return { ok: deleteRef.deleted, advanced: false, files: [] }
  }

  /**
   * Supprime une ref de récupération seulement si elle pointe encore sur la SHA contrôlée.
   * `update-ref <oldvalue>` réalise comparaison + suppression sous le verrou Git : une avance
   * concurrente ne peut donc jamais être effacée entre un `rev-parse` et la suppression.
   */
  private deleteRecoveryRefIfExpected(
    branch: string,
    expectedSha: string
  ): { deleted: boolean; advanced: boolean; files: string[] } {
    const ref = `refs/heads/${branch}`
    const deletion = this.tryGitFn(this.baseRepo, ['update-ref', '-d', ref, expectedSha])
    const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    if (deletion.code === 0 && current.code !== 0) {
      return { deleted: true, advanced: false, files: [] }
    }
    if (current.code !== 0) {
      return { deleted: false, advanced: false, files: [] }
    }
    const currentSha = current.stdout.trim()
    if (currentSha === expectedSha) {
      return { deleted: false, advanced: false, files: [] }
    }
    const files = this.tryGitFn(this.baseRepo, [
      'diff',
      '--name-only',
      '-z',
      `${expectedSha}..${currentSha}`
    ])
    const changedPaths = parseNullSeparatedPaths(files.stdout)
    return { deleted: false, advanced: true, files: changedPaths }
  }

  /**
   * Rematérialise une ref de récupération avancée en vrai bureau ouvrable.
   * La ref reste l'ancre durable ; en cas d'échec temporaire, le coordinateur réessaiera.
   */
  private restoreRecoveryWorktree(agentId: string, branch: string): boolean {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) {
      const restored = this.tryGitFn(this.baseRepo, ['worktree', 'add', path, branch])
      if (restored.code !== 0) return false
    }
    if (this.ownershipIssue(path)) return false
    const branchHead = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      `refs/heads/${branch}`
    ])
    const worktreeHead = this.tryGitFn(path, ['rev-parse', 'HEAD'])
    return (
      branchHead.code === 0 &&
      worktreeHead.code === 0 &&
      branchHead.stdout.trim() === worktreeHead.stdout.trim()
    )
  }

  private recoveredPublishedResidue(
    agentId: string,
    branch: string,
    publishedSha: string,
    agentSha: string,
    files: string[]
  ): FinalizeResult {
    if (!this.restoreRecoveryWorktree(agentId, branch)) {
      return {
        outcome: 'cleanup-pending',
        agentId,
        files,
        publishedSha,
        agentSha,
        worktreeAvailable: false,
        detail:
          'Le retour est publié et la référence plus récente est protégée ; Autowin réessaiera de recréer son bureau.'
      }
    }
    return {
      outcome: 'published-residue',
      agentId,
      files,
      publishedSha,
      agentSha,
      detail:
        'La référence de récupération contient du travail plus récent et son bureau est restauré.'
    }
  }

  /**
   * Fichiers ignorés qui peuvent être de vrais livrables locaux. Les dépendances, caches et sorties
   * de build explicitement bornés sont régénérables ; tout autre fichier ignoré bloque le nettoyage.
   */
  private preservedIgnoredFiles(repo: string): string[] {
    const out = this.git(repo, [
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      '.',
      ':(exclude,glob)**/node_modules/**',
      ':(exclude,glob)**/__pycache__/**',
      ':(exclude,glob)out/**',
      ':(exclude,glob)dist/**',
      ':(exclude,glob)dist-*/**',
      ':(exclude,glob)graphify-out/**',
      // Dossier de preuves du harnais (`ui-capture`, `cdp-*-proof`) : une capture se REFAIT en
      // relançant le script. Mesuré le 2026-08-21 (conv-1362) : un run vert a bloqué sa propre
      // publication parce que SA preuve, `Audit/accueil-3d-anime.png`, comptait comme livrable.
      ':(exclude,glob)Audit/**',
      ':(exclude,glob)**/.eslintcache',
      ':(exclude,glob)*.tsbuildinfo',
      ':(exclude,glob)**/*.tsbuildinfo',
      ':(exclude,glob)**/.DS_Store'
    ])
    return parseNullSeparatedPaths(out)
  }

  private workingTreeFiles(repo: string): string[] {
    return parsePorcelainPaths(
      this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    )
  }

  /** Dernière barrière avant suppression : inclut les écritures suivies et ignorées arrivées tard. */
  private unpublishedFiles(repo: string): string[] {
    return [...new Set([...this.workingTreeFiles(repo), ...this.preservedIgnoredFiles(repo)])]
  }

  private currentBaseBranch(): string {
    return (
      this.configuredBaseBranch ?? this.git(this.baseRepo, ['rev-parse', '--abbrev-ref', 'HEAD'])
    )
  }

  private canonicalRemoteBase(): { ref: string; sha: string } | undefined {
    const origin = this.tryGitFn(this.baseRepo, ['remote', 'get-url', 'origin'])
    if (origin.code !== 0 || !origin.stdout.trim()) {
      if (this.requireCanonicalRemote) {
        throw new Error('Lancement bloqué : le distant origin est absent.')
      }
      return undefined
    }
    /*
     * UN FETCH QUI ÉCHOUE N'EST PAS UNE RAISON DE NE PAS TRAVAILLER.
     *
     * Avant, tout échec de `fetch` levait « Lancement bloqué » — donc lancer une conversation
     * exigeait le réseau, à chaque fois. Hors ligne, VPN coupé, origin momentanément injoignable :
     * l'application refusait de commencer, alors que `origin/main` était parfaitement connu en
     * local. Trois conversations lancées, trois fetch, trois occasions d'échouer avant tout travail.
     * C'est le « j'ai une erreur avant de se lancer au travail » signalé par l'utilisateur, et il
     * n'était couvert par aucun test.
     *
     * On DÉGRADE au lieu de bloquer : si une référence canonique résout déjà en local, on part de
     * celle-là. La garde n'est pas desserrée pour autant — il faut toujours qu'origin existe ET
     * qu'`origin/main` ou `origin/master` résolve ; sans ça, l'échec plus bas reste fatal. Le seul
     * changement est qu'une panne RÉSEAU cesse d'être traitée comme une absence de dépôt.
     *
     * Contrepartie assumée : on peut alors démarrer d'un `origin/main` légèrement en retard. C'est
     * le compromis explicite — la publication, elle, revérifie sa base et refusera si elle a bougé.
     */
    const fetched = this.tryGitFn(this.baseRepo, ['fetch', '--no-tags', '--prune', 'origin'])
    const detailFetch = fetched.code === 0 ? '' : (fetched.stderr || fetched.stdout).trim()

    const symbolic = this.tryGitFn(this.baseRepo, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD'
    ])
    const candidates = [
      symbolic.code === 0 ? symbolic.stdout.trim() : '',
      'origin/main',
      'origin/master'
    ].filter((ref, index, refs) => ref && refs.indexOf(ref) === index)
    for (const ref of candidates) {
      if (!/^origin\/(?:main|master)$/.test(ref)) continue
      const resolved = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `${ref}^{commit}`])
      if (resolved.code === 0 && /^[0-9a-f]{40,64}$/i.test(resolved.stdout.trim())) {
        return { ref, sha: resolved.stdout.trim() }
      }
    }
    // Aucune référence canonique, MÊME en local. Là, le refus est légitime — et il nomme la cause
    // réelle quand c'est le réseau qui a lâché, au lieu de laisser croire à un dépôt mal formé.
    throw new Error(
      detailFetch
        ? `Lancement bloqué : origin est injoignable et aucune référence locale ne le supplée (${detailFetch}).`
        : 'Lancement bloqué : origin/main ou origin/master est introuvable après fetch.'
    )
  }

  private isExpectedBaseBranch(expectedBaseBranch: string): boolean {
    const currentRef = this.tryGitFn(this.baseRepo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    return currentRef.code === 0 && currentRef.stdout.trim() === expectedBaseBranch
  }

  private activeHooksDir(): string {
    const configured = this.tryGitFn(this.baseRepo, ['config', '--path', '--get', 'core.hooksPath'])
    if (configured.code === 0 && configured.stdout.trim()) {
      const path = configured.stdout.trim()
      return isAbsolute(path) ? path : resolve(this.baseRepo, path)
    }
    const defaultPath = this.git(this.baseRepo, ['rev-parse', '--git-path', 'hooks'])
    return isAbsolute(defaultPath) ? defaultPath : resolve(this.baseRepo, defaultPath)
  }

  private preparePublishHooks(
    agentId: string,
    integrationPath: string,
    baseSha: string,
    integratedSha: string,
    expectedBaseBranch: string,
    expectedPublicationRef: string,
    agentFiles: string[],
    expectedIndexTree: string
  ): string {
    const hooksPath = join(integrationPath, '.autowin-publish-hooks')
    const inputPath = join(hooksPath, 'reference-transaction.input')
    const markerPath = join(hooksPath, 'preflight-passed')
    const postHookChangePath = join(hooksPath, 'post-hook-change')
    const postHookRejectedPath = join(hooksPath, 'post-hook-rejected')
    const postHookIndexedAgentPathsPath = join(hooksPath, 'post-hook-indexed-agent-paths')
    const postHookWorktreeAgentPathsPath = join(hooksPath, 'post-hook-worktree-agent-paths')
    const postHookUntrackedAgentPathsPath = join(hooksPath, 'post-hook-untracked-agent-paths')
    const postHookIndexTreePath = join(hooksPath, 'post-hook-index-tree')
    const postHookWorktreeTreePath = join(hooksPath, 'post-hook-worktree-tree')
    const postHookSnapshotIndexPath = join(hooksPath, 'post-hook-snapshot-index')
    const initialAgentStatusPath = join(hooksPath, 'initial-agent-status')
    const compensationIntentPath = join(hooksPath, 'compensation-intent.json')
    const activeHooksDir = this.activeHooksDir()
    const originalReferenceHook = join(activeHooksDir, 'reference-transaction')
    const originalPostMergeHook = join(activeHooksDir, 'post-merge')
    const expectedRef = `refs/heads/${expectedBaseBranch}`
    const agentPathSpecs = agentFiles.map((file) => shellQuote(`:(literal)${file}`)).join(' ')
    const nonAgentPathSpecs = ['.', ...agentFiles.map((file) => `:(exclude,literal)${file}`)]
      .map(shellQuote)
      .join(' ')
    mkdirSync(hooksPath, { recursive: true })
    const compensationIntent: PublicationCompensationIntent = {
      version: 1,
      agentId,
      baseSha,
      publicationSha: integratedSha,
      expectedBaseBranch,
      agentFiles
    }
    writeFileSync(compensationIntentPath, JSON.stringify(compensationIntent))

    const chainReferenceHook = existsSync(originalReferenceHook)
      ? `${shellQuote(shellPath(originalReferenceHook))} "$@" < ${shellQuote(shellPath(inputPath))}\n` +
        'original_status=$?\n'
      : ''
    const referenceHook = `#!/bin/sh
state="$1"
cat > ${shellQuote(shellPath(inputPath))} || exit 90
original_status=0
validate_initial_workspace() {
  actual_ref=$(git symbolic-ref --quiet HEAD) || {
    echo "AUTOWIN_GUARD:detached-head" >&2
    exit 91
  }
  [ "$actual_ref" = ${shellQuote(expectedRef)} ] || {
    echo "AUTOWIN_GUARD:branch-changed" >&2
    exit 92
  }
  actual_head=$(git rev-parse HEAD) || exit 93
  [ "$actual_head" = ${shellQuote(baseSha)} ] || {
    echo "AUTOWIN_GUARD:head-changed" >&2
    exit 94
  }
  actual_index_tree=$(git write-tree) || exit 95
  [ "$actual_index_tree" = ${shellQuote(expectedIndexTree)} ] || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
  git status --porcelain=v1 -z --untracked-files=all -- ${agentPathSpecs} > ${shellQuote(shellPath(initialAgentStatusPath))} || exit 95
  [ ! -s ${shellQuote(shellPath(initialAgentStatusPath))} ] || {
    echo "AUTOWIN_GUARD:agent-worktree-changed" >&2
    exit 95
  }
  unmerged_files=$(git diff --name-only --diff-filter=U) || exit 96
  [ -z "$unmerged_files" ] || {
    echo "AUTOWIN_GUARD:unmerged-files" >&2
    exit 96
  }
  for operation_name in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD BISECT_START rebase-merge rebase-apply sequencer; do
    operation_path=$(git rev-parse --git-path "$operation_name") || exit 96
    [ ! -e "$operation_path" ] || {
      echo "AUTOWIN_GUARD:operation-in-progress" >&2
      exit 96
    }
  done
}
validate_publish_workspace() {
  git diff --cached --quiet ${shellQuote(expectedIndexTree)} -- ${nonAgentPathSpecs} || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
  git diff --cached --quiet ${shellQuote(integratedSha)} -- ${agentPathSpecs} || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
  git diff --quiet -- ${agentPathSpecs} || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
}
updates_expected_ref=0
updates_publication_ref=0
if [ "$state" = "prepared" ]; then
  while read -r old_sha new_sha ref_name; do
    case "$ref_name" in
      ${shellQuote(expectedPublicationRef)})
        updates_publication_ref=1
        ;;
      refs/heads/*)
        if [ "$ref_name" != ${shellQuote(expectedRef)} ] || [ "$old_sha" != ${shellQuote(baseSha)} ] || [ "$new_sha" != ${shellQuote(integratedSha)} ]; then
          echo "AUTOWIN_GUARD:unexpected-ref-update" >&2
          exit 96
        fi
        updates_expected_ref=1
        ;;
    esac
  done < ${shellQuote(shellPath(inputPath))}
fi
publication_transaction=0
if [ "$state" = "prepared" ] && [ "$updates_publication_ref" -eq 1 ]; then
  publication_transaction=1
  validate_initial_workspace
fi
initial_transaction=0
if [ "$state" = "prepared" ] && [ "$updates_expected_ref" -eq 0 ] && [ "$updates_publication_ref" -eq 0 ] && [ ! -f ${shellQuote(shellPath(markerPath))} ]; then
  initial_transaction=1
  validate_initial_workspace
fi
if [ "$state" = "prepared" ] && [ "$updates_expected_ref" -eq 1 ]; then
  [ -f ${shellQuote(shellPath(markerPath))} ] || {
    echo "AUTOWIN_GUARD:preflight-missing" >&2
    exit 95
  }
  validate_publish_workspace
  pre_chained_index_tree=$(git write-tree) || exit 95
fi
${chainReferenceHook}if [ "$initial_transaction" -eq 1 ]; then
  validate_initial_workspace
  [ "$original_status" -eq 0 ] || exit "$original_status"
  : > ${shellQuote(shellPath(markerPath))} || exit 97
fi
if [ "$publication_transaction" -eq 1 ]; then
  validate_initial_workspace
  [ "$original_status" -eq 0 ] || exit "$original_status"
fi
if [ "$state" = "prepared" ] && [ "$updates_expected_ref" -eq 1 ]; then
  post_chained_index_tree=$(git write-tree) || exit 95
  printf '%s\n' "$post_chained_index_tree" > ${shellQuote(shellPath(postHookIndexTreePath))} || exit 95
  git diff --name-only -z "$pre_chained_index_tree" "$post_chained_index_tree" -- ${agentPathSpecs} > ${shellQuote(shellPath(postHookIndexedAgentPathsPath))}
  git diff --name-only -z ${shellQuote(integratedSha)} -- ${agentPathSpecs} > ${shellQuote(shellPath(postHookWorktreeAgentPathsPath))}
  git ls-files --others -z -- ${agentPathSpecs} > ${shellQuote(shellPath(postHookUntrackedAgentPathsPath))}
  if [ "$original_status" -ne 0 ]; then
    : > ${shellQuote(shellPath(postHookRejectedPath))} || exit 97
  fi
  if [ "$original_status" -ne 0 ] || [ "$pre_chained_index_tree" != "$post_chained_index_tree" ] || [ -s ${shellQuote(shellPath(postHookWorktreeAgentPathsPath))} ] || [ -s ${shellQuote(shellPath(postHookUntrackedAgentPathsPath))} ]; then
    actual_index_path=$(git rev-parse --git-path index) || exit 95
    cp "$actual_index_path" ${shellQuote(shellPath(postHookSnapshotIndexPath))} || exit 95
    GIT_INDEX_FILE=${shellQuote(shellPath(postHookSnapshotIndexPath))} git add -A -f -- ${agentPathSpecs} || exit 95
    GIT_INDEX_FILE=${shellQuote(shellPath(postHookSnapshotIndexPath))} git write-tree > ${shellQuote(shellPath(postHookWorktreeTreePath))} || exit 95
    rm -f ${shellQuote(shellPath(postHookSnapshotIndexPath))}
    : > ${shellQuote(shellPath(postHookChangePath))} || exit 97
    echo "AUTOWIN_GUARD:index-changed-after-hook" >&2
    [ "$original_status" -eq 0 ] || exit "$original_status"
    exit 98
  fi
fi
exit 0
`
    const referenceHookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(referenceHookPath, referenceHook)
    chmodSync(referenceHookPath, 0o755)

    if (existsSync(originalPostMergeHook)) {
      const postMergeHookPath = join(hooksPath, 'post-merge')
      writeFileSync(
        postMergeHookPath,
        `#!/bin/sh\nexec ${shellQuote(shellPath(originalPostMergeHook))} "$@"\n`
      )
      chmodSync(postMergeHookPath, 0o755)
    }
    return hooksPath
  }

  private compensationRoot(): string | undefined {
    const commonDir = this.gitCommonDir(this.baseRepo)
    if (!commonDir) return undefined
    return join(commonDir, 'autowin-compensations')
  }

  private compensationPlanPath(agentId: string): string | undefined {
    assertSafeId(agentId, 'agentId')
    const root = this.compensationRoot()
    return root ? join(root, `${agentId}.json`) : undefined
  }

  private compensationPendingPlanPath(agentId: string): string | undefined {
    const planPath = this.compensationPlanPath(agentId)
    return planPath ? `${planPath}.pending` : undefined
  }

  private compensationTreeRef(
    agentId: string,
    kind:
      'index' | 'worktree' | 'resume-index' | 'resume-worktree' | 'next-index' | 'next-worktree',
    generation?: string
  ): string {
    assertSafeId(agentId, 'agentId')
    if (generation) assertSafeId(generation, 'generation')
    return `refs/autowin/compensations/${agentId}/${generation ? `${generation}/` : ''}${kind}`
  }

  private compensationHooksPath(): string | undefined {
    const root = this.compensationRoot()
    if (!root) return undefined
    const hooksPath = join(root, 'empty-hooks')
    mkdirSync(hooksPath, { recursive: true })
    return hooksPath
  }

  private compensationPatchRoot(agentId: string): string | undefined {
    assertSafeId(agentId, 'agentId')
    const root = this.compensationRoot()
    return root ? join(root, 'patches', agentId) : undefined
  }

  private cleanupCompensationPatchResidues(agentId: string): void {
    const patchRoot = this.compensationPatchRoot(agentId)
    if (!patchRoot || !existsSync(patchRoot)) return
    for (const entry of readdirSync(patchRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^conditional-[A-Za-z0-9-]+\.(?:patch|index)$/.test(entry.name)) {
        rmSync(join(patchRoot, entry.name), { force: true })
      }
    }
    if (readdirSync(patchRoot).length === 0) {
      rmSync(patchRoot, { recursive: true, force: true })
    }
  }

  private compensationIndexLockPath(): string | undefined {
    const indexPathProbe = this.tryGitFn(this.baseRepo, ['rev-parse', '--git-path', 'index'])
    if (indexPathProbe.code !== 0) return undefined
    const rawIndexPath = indexPathProbe.stdout.trim()
    const indexPath = isAbsolute(rawIndexPath) ? rawIndexPath : resolve(this.baseRepo, rawIndexPath)
    return `${indexPath}.lock`
  }

  private parseCompensationIndexLockOwner(
    serialized: string
  ): CompensationIndexLockOwner | undefined {
    try {
      const parsed = JSON.parse(serialized) as Partial<CompensationIndexLockOwner>
      if (
        parsed.owner !== 'autowin-compensation' ||
        !Number.isSafeInteger(parsed.pid) ||
        Number(parsed.pid) <= 0 ||
        (parsed.identity !== null && typeof parsed.identity !== 'string') ||
        typeof parsed.token !== 'string' ||
        !SAFE_ID.test(parsed.token) ||
        ((parsed.predecessorSerialized !== undefined || parsed.acquireExpiresAt !== undefined) &&
          ((parsed.predecessorSerialized !== null &&
            typeof parsed.predecessorSerialized !== 'string') ||
            typeof parsed.acquireExpiresAt !== 'number' ||
            !Number.isFinite(parsed.acquireExpiresAt)))
      ) {
        return undefined
      }
      return parsed as CompensationIndexLockOwner
    } catch {
      return undefined
    }
  }

  private compensationIndexOwnershipRef(): string {
    return 'refs/autowin/locks/index'
  }

  private isStaleCompensationIndexLock(
    owner: CompensationIndexLockOwner,
    marker: CompensationIndexRecoveryMarker | undefined
  ): boolean {
    if (marker?.state === 'abandoned') return true
    if (
      (marker?.state === 'acquiring' && this.now() >= marker.expiresAt) ||
      (marker === undefined &&
        owner.acquireExpiresAt !== undefined &&
        this.now() >= owner.acquireExpiresAt)
    ) {
      return true
    }
    const currentIdentity = this.processIdentity(owner.pid)
    if (currentIdentity === undefined) return true
    if (currentIdentity === null || !owner.identity) return false
    return !isSameProcessIdentity(owner.identity, currentIdentity)
  }

  private readCompensationIndexLockOwner(
    oid: string
  ): { owner: CompensationIndexLockOwner; serialized: string } | undefined {
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) return undefined
    const content = this.tryGitFn(this.baseRepo, ['cat-file', '-p', oid])
    if (content.code !== 0) return undefined
    const serialized = content.stdout.trim()
    const owner = this.parseCompensationIndexLockOwner(serialized)
    return owner ? { owner, serialized } : undefined
  }

  private releaseCompensationIndexOwnership(ref: string, oid: string): boolean {
    const hooksPath = this.compensationHooksPath()
    if (!hooksPath) return false
    const release = this.tryGitFn(this.baseRepo, [
      '-c',
      `core.hooksPath=${shellPath(hooksPath)}`,
      'update-ref',
      '-d',
      ref,
      oid
    ])
    if (release.code === 0) return true
    return this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref]).code !== 0
  }

  private cleanupCompensationIndexOwnerResidues(ownerRoot: string): void {
    if (!existsSync(ownerRoot)) return
    const ownership = this.tryGitFn(this.baseRepo, [
      'for-each-ref',
      '--count=1',
      '--format=%(objectname)',
      this.compensationIndexOwnershipRef()
    ])
    let ownershipKnown = ownership.code === 0
    let activeToken: string | undefined
    const ownershipOid = ownership.stdout.trim()
    if (ownershipKnown && ownershipOid) {
      const activeOwner = this.readCompensationIndexLockOwner(ownershipOid)
      if (activeOwner) activeToken = activeOwner.owner.token
      else ownershipKnown = false
    }
    for (const entry of readdirSync(ownerRoot, { withFileTypes: true })) {
      const match = entry.isFile()
        ? /^index-(\d+)-([A-Za-z0-9_-]+)\.owner$/.exec(entry.name)
        : undefined
      if (!match) continue
      const path = join(ownerRoot, entry.name)
      const pid = Number(match[1])
      const token = match[2]
      const currentIdentity = this.processIdentity(pid)
      if (currentIdentity === undefined) {
        rmSync(path, { force: true })
        continue
      }
      if (typeof currentIdentity !== 'string') continue
      try {
        const owner = this.parseCompensationIndexLockOwner(readFileSync(path, 'utf8'))
        if (!owner && ownershipKnown && token !== activeToken) {
          rmSync(path, { force: true })
        } else if (owner?.acquireExpiresAt !== undefined && this.now() >= owner.acquireExpiresAt) {
          rmSync(path, { force: true })
        } else if (owner?.identity && !isSameProcessIdentity(owner.identity, currentIdentity)) {
          rmSync(path, { force: true })
        }
      } catch {
        // Un PID encore vivant interdit de conclure que ce propriétaire partiel est orphelin.
      }
    }
  }

  private compensationIndexRecoveryMarkerPath(
    token: string,
    state: CompensationIndexRecoveryMarker['state']
  ): string | undefined {
    if (!SAFE_ID.test(token)) return undefined
    const root = this.compensationRoot()
    return root ? join(root, 'locks', `${state}-${token}.marker`) : undefined
  }

  private parseCompensationIndexRecoveryMarker(
    serialized: string,
    token: string,
    state: CompensationIndexRecoveryMarker['state']
  ): CompensationIndexRecoveryMarker | undefined {
    try {
      const parsed = JSON.parse(serialized) as Partial<CompensationIndexRecoveryMarker>
      if (
        parsed.version !== 1 ||
        parsed.token !== token ||
        parsed.state !== state ||
        (parsed.predecessorSerialized !== null &&
          (typeof parsed.predecessorSerialized !== 'string' ||
            !this.parseCompensationIndexLockOwner(parsed.predecessorSerialized))) ||
        typeof parsed.expiresAt !== 'number' ||
        !Number.isFinite(parsed.expiresAt)
      ) {
        return undefined
      }
      return parsed as CompensationIndexRecoveryMarker
    } catch {
      return undefined
    }
  }

  private readCompensationIndexRecoveryMarker(
    token: string
  ): CompensationIndexRecoveryMarker | undefined {
    for (const state of ['abandoned', 'acquiring'] as const) {
      const path = this.compensationIndexRecoveryMarkerPath(token, state)
      if (!path || !existsSync(path)) continue
      try {
        const marker = this.parseCompensationIndexRecoveryMarker(
          readFileSync(path, 'utf8'),
          token,
          state
        )
        if (marker) return marker
      } catch {
        // Un marqueur partiel n'autorise aucune reprise destructive.
      }
    }
    return undefined
  }

  private persistCompensationIndexRecoveryMarker(
    token: string,
    state: CompensationIndexRecoveryMarker['state'],
    predecessorSerialized: string | null,
    expiresAt = this.now() + COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS
  ): boolean {
    const path = this.compensationIndexRecoveryMarkerPath(token, state)
    if (!path) return false
    const marker: CompensationIndexRecoveryMarker = {
      version: 1,
      token,
      state,
      predecessorSerialized,
      expiresAt
    }
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      mkdirSync(dirname(path), { recursive: true })
      fd = openSync(temporaryPath, 'wx')
      writeFileSync(fd, JSON.stringify(marker))
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      rmSync(path, { force: true })
      renameSync(temporaryPath, path)
      return true
    } catch {
      return false
    } finally {
      if (fd !== undefined) closeSync(fd)
      rmSync(temporaryPath, { force: true })
    }
  }

  private clearCompensationIndexRecoveryMarkers(token: string): void {
    for (const state of ['acquiring', 'abandoned'] as const) {
      const path = this.compensationIndexRecoveryMarkerPath(token, state)
      if (!path) continue
      try {
        rmSync(path, { force: true })
      } catch {
        // Le marqueur expirera et restera sûr si un antivirus retarde son nettoyage.
      }
    }
  }

  private cleanupCompensationIndexRecoveryMarkerResidues(ownerRoot: string): void {
    if (!existsSync(ownerRoot)) return
    const ownership = this.tryGitFn(this.baseRepo, [
      'for-each-ref',
      '--count=1',
      '--format=%(objectname)',
      this.compensationIndexOwnershipRef()
    ])
    if (ownership.code !== 0) return
    let activeToken: string | undefined
    const ownershipOid = ownership.stdout.trim()
    if (ownershipOid) {
      const activeOwner = this.readCompensationIndexLockOwner(ownershipOid)
      if (!activeOwner) return
      activeToken = activeOwner.owner.token
    }

    let inspected = 0
    for (const entry of readdirSync(ownerRoot, { withFileTypes: true })) {
      if (inspected >= COMPENSATION_INDEX_MARKER_SWEEP_LIMIT) break
      const match = entry.isFile()
        ? /^(acquiring|abandoned)-([A-Za-z0-9_-]+)\.marker(?:\.\d+\.[A-Za-z0-9-]+\.tmp)?$/.exec(
            entry.name
          )
        : undefined
      if (!match) continue
      inspected += 1
      const state = match[1] as CompensationIndexRecoveryMarker['state']
      const token = match[2]
      if (token === activeToken) continue
      const path = join(ownerRoot, entry.name)
      try {
        const marker = this.parseCompensationIndexRecoveryMarker(
          readFileSync(path, 'utf8'),
          token,
          state
        )
        if (marker && marker.expiresAt <= this.now()) rmSync(path, { force: true })
      } catch {
        // Une lecture ou suppression transitoirement refusée sera retentée au prochain passage.
      }
    }
  }

  private acquireCompensationIndexLock(): CompensationIndexLock | undefined {
    const path = this.compensationIndexLockPath()
    const root = this.compensationRoot()
    const hooksPath = this.compensationHooksPath()
    if (!path || !root || !hooksPath) return undefined
    const ownerBase: CompensationIndexLockOwner = {
      owner: 'autowin-compensation',
      pid: process.pid,
      identity: this.processIdentity(process.pid) ?? null,
      token: randomUUID()
    }
    const ownerRoot = join(root, 'locks')
    const ownerPath = join(ownerRoot, `index-${ownerBase.pid}-${ownerBase.token}.owner`)
    const ownershipRef = this.compensationIndexOwnershipRef()
    let ownerFd: number | undefined
    try {
      mkdirSync(ownerRoot, { recursive: true })
      this.cleanupCompensationIndexOwnerResidues(ownerRoot)
      this.cleanupCompensationIndexRecoveryMarkerResidues(ownerRoot)

      for (let attempt = 0; attempt < 4; attempt += 1) {
        let currentOwner: { owner: CompensationIndexLockOwner; serialized: string } | undefined
        let currentMarker: CompensationIndexRecoveryMarker | undefined
        let currentNativeSerialized: string | undefined
        let predecessorSerialized: string | null = null
        let expectedOid: string | undefined
        const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ownershipRef])
        if (current.code === 0) {
          expectedOid = current.stdout.trim()
          currentOwner = this.readCompensationIndexLockOwner(expectedOid)
          if (!currentOwner) return undefined
          currentMarker = this.readCompensationIndexRecoveryMarker(currentOwner.owner.token)
          currentNativeSerialized = existsSync(path) ? readFileSync(path, 'utf8') : undefined
          if (!this.isStaleCompensationIndexLock(currentOwner.owner, currentMarker))
            return undefined
          if (currentNativeSerialized !== undefined) {
            if (
              currentNativeSerialized !== currentOwner.serialized &&
              currentNativeSerialized !== currentMarker?.predecessorSerialized &&
              currentNativeSerialized !== currentOwner.owner.predecessorSerialized
            ) {
              return undefined
            }
            predecessorSerialized = currentNativeSerialized
          } else {
            predecessorSerialized =
              currentMarker?.predecessorSerialized ??
              currentOwner.owner.predecessorSerialized ??
              currentOwner.serialized
          }
        } else if (existsSync(path)) {
          return undefined
        }
        const acquireExpiresAt = this.now() + COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS
        const owner: CompensationIndexLockOwner = {
          ...ownerBase,
          predecessorSerialized,
          acquireExpiresAt
        }
        const serialized = JSON.stringify(owner)
        if (
          !this.persistCompensationIndexRecoveryMarker(
            owner.token,
            'acquiring',
            predecessorSerialized,
            acquireExpiresAt
          )
        ) {
          return undefined
        }
        rmSync(ownerPath, { force: true })
        ownerFd = openSync(ownerPath, 'wx')
        writeFileSync(ownerFd, serialized)
        fsyncSync(ownerFd)
        closeSync(ownerFd)
        ownerFd = undefined
        const object = this.tryGitFn(this.baseRepo, ['hash-object', '-w', '--', ownerPath])
        const ownershipOid = object.stdout.trim()
        if (object.code !== 0 || !/^[0-9a-f]{40,64}$/i.test(ownershipOid)) return undefined
        expectedOid ??= '0'.repeat(ownershipOid.length)

        const acquireOwnership = this.tryGitFn(this.baseRepo, [
          '-c',
          `core.hooksPath=${shellPath(hooksPath)}`,
          'update-ref',
          ownershipRef,
          ownershipOid,
          expectedOid
        ])
        if (acquireOwnership.code !== 0) {
          this.clearCompensationIndexRecoveryMarkers(owner.token)
          continue
        }

        let nativeLockAcquired = false
        try {
          const ownMarker = this.readCompensationIndexRecoveryMarker(owner.token)
          if (
            ownMarker?.state !== 'acquiring' ||
            ownMarker.expiresAt !== acquireExpiresAt ||
            this.now() >= acquireExpiresAt
          ) {
            return undefined
          }
          if (existsSync(path)) {
            if (!predecessorSerialized || readFileSync(path, 'utf8') !== predecessorSerialized) {
              return undefined
            }
            this.removeIndexLockFn(path)
          }
          this.linkFileFn(ownerPath, path)
          nativeLockAcquired = true
          if (currentOwner) {
            this.clearCompensationIndexRecoveryMarkers(currentOwner.owner.token)
          }
          this.clearCompensationIndexRecoveryMarkers(owner.token)
          return { path, serialized, ownershipRef, ownershipOid, token: owner.token }
        } finally {
          if (!nativeLockAcquired) {
            let predecessorStillPresent = false
            try {
              predecessorStillPresent = Boolean(
                predecessorSerialized &&
                existsSync(path) &&
                readFileSync(path, 'utf8') === predecessorSerialized
              )
            } catch {
              predecessorStillPresent = true
            }
            if (predecessorStillPresent) {
              this.persistCompensationIndexRecoveryMarker(
                owner.token,
                'abandoned',
                predecessorSerialized
              )
            } else if (this.releaseCompensationIndexOwnership(ownershipRef, ownershipOid)) {
              this.clearCompensationIndexRecoveryMarkers(owner.token)
            } else {
              this.persistCompensationIndexRecoveryMarker(owner.token, 'abandoned', serialized)
            }
          }
        }
      }
      return undefined
    } catch {
      return undefined
    } finally {
      if (ownerFd !== undefined) closeSync(ownerFd)
      rmSync(ownerPath, { force: true })
    }
  }

  private releaseCompensationIndexLock(lock: CompensationIndexLock): void {
    let nativeLockReleased = false
    try {
      if (!existsSync(lock.path)) {
        nativeLockReleased = true
      } else if (readFileSync(lock.path, 'utf8') === lock.serialized) {
        this.removeIndexLockFn(lock.path)
        nativeLockReleased = !existsSync(lock.path)
      }
    } catch {
      // Le verrou absent ou remplacé n'appartient plus à cette opération.
    }
    if (nativeLockReleased) {
      if (this.releaseCompensationIndexOwnership(lock.ownershipRef, lock.ownershipOid)) {
        this.clearCompensationIndexRecoveryMarkers(lock.token)
      } else {
        this.persistCompensationIndexRecoveryMarker(lock.token, 'abandoned', lock.serialized)
      }
    } else {
      this.persistCompensationIndexRecoveryMarker(lock.token, 'abandoned', lock.serialized)
    }
  }

  private ownsCompensationIndexLock(lock: CompensationIndexLock, minimumRemainingMs = 0): boolean {
    const owner = this.parseCompensationIndexLockOwner(lock.serialized)
    if (
      !owner ||
      owner.acquireExpiresAt === undefined ||
      this.now() + minimumRemainingMs >= owner.acquireExpiresAt
    ) {
      return false
    }
    try {
      if (!existsSync(lock.path) || readFileSync(lock.path, 'utf8') !== lock.serialized)
        return false
      const ownership = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', lock.ownershipRef])
      return ownership.code === 0 && ownership.stdout.trim() === lock.ownershipOid
    } catch {
      return false
    }
  }

  private reconcileCompensationIndexLock(): void {
    const path = this.compensationIndexLockPath()
    if (!path) return
    const ownership = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      this.compensationIndexOwnershipRef()
    ])
    if (!existsSync(path) && ownership.code !== 0) return
    const lock = this.acquireCompensationIndexLock()
    if (lock) this.releaseCompensationIndexLock(lock)
  }

  private persistCompensationPlan(plan: PublicationCompensationPlan): boolean {
    const planPath = this.compensationPlanPath(plan.agentId)
    const pendingPath = this.compensationPendingPlanPath(plan.agentId)
    const hooksPath = this.compensationHooksPath()
    if (!planPath || !pendingPath || !hooksPath) return false
    mkdirSync(dirname(planPath), { recursive: true })
    const previousGeneration = plan.generation
    const nextPlan: PublicationCompensationPlan = { ...plan, generation: randomUUID() }
    const temporaryPath = `${pendingPath}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporaryPath, JSON.stringify(nextPlan))
      renameSync(temporaryPath, pendingPath)
      if (!this.installCompensationRefs(nextPlan)) {
        this.removeCompensationGeneration(nextPlan)
        rmSync(pendingPath, { force: true })
        return false
      }
      renameSync(pendingPath, planPath)
      Object.assign(plan, nextPlan)
      if (previousGeneration && previousGeneration !== nextPlan.generation) {
        this.removeCompensationGeneration({ ...plan, generation: previousGeneration })
      }
      this.cleanupObsoleteCompensationRefs(plan)
      return true
    } catch {
      rmSync(temporaryPath, { force: true })
      this.removeCompensationGeneration(nextPlan)
      rmSync(pendingPath, { force: true })
      return false
    }
  }

  private compensationRefEntries(plan: PublicationCompensationPlan): Array<{
    kind: 'index' | 'worktree' | 'resume-index' | 'resume-worktree' | 'next-index' | 'next-worktree'
    ref: string
    sha: string
  }> {
    const entries: Array<
      readonly [
        'index' | 'worktree' | 'resume-index' | 'resume-worktree' | 'next-index' | 'next-worktree',
        string
      ]
    > = [
      ['index', plan.postHookIndexTree],
      ['worktree', plan.postHookWorktreeTree],
      ['resume-index', plan.resumeIndexTree],
      ['resume-worktree', plan.resumeWorktreeTree]
    ]
    if (plan.nextIndexTree && plan.nextWorktreeTree) {
      entries.push(['next-index', plan.nextIndexTree], ['next-worktree', plan.nextWorktreeTree])
    }
    return entries.map(([kind, sha]) => ({
      kind,
      ref: this.compensationTreeRef(plan.agentId, kind, plan.generation),
      sha
    }))
  }

  private installCompensationRefs(plan: PublicationCompensationPlan): boolean {
    const hooksPath = this.compensationHooksPath()
    if (!hooksPath || !plan.generation) return false
    for (const { ref, sha } of this.compensationRefEntries(plan)) {
      if (this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${sha}^{tree}`]).code !== 0) return false
      const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
      if (current.code === 0) {
        if (current.stdout.trim() !== sha) return false
        continue
      }
      const install = this.tryGitFn(this.baseRepo, [
        '-c',
        `core.hooksPath=${shellPath(hooksPath)}`,
        'update-ref',
        ref,
        sha,
        '0000000000000000000000000000000000000000'
      ])
      if (install.code !== 0) return false
    }
    return true
  }

  private removeCompensationGeneration(plan: PublicationCompensationPlan): boolean {
    const hooksPath = this.compensationHooksPath()
    if (!hooksPath) return false
    const refs = plan.generation
      ? this.tryGitFn(this.baseRepo, [
          'for-each-ref',
          '--format=%(refname)',
          `refs/autowin/compensations/${plan.agentId}/${plan.generation}/`
        ])
          .stdout.split('\n')
          .map((ref) => ref.trim())
          .filter(Boolean)
      : this.compensationRefEntries(plan).map(({ ref }) => ref)
    let removed = true
    for (const ref of refs) {
      const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
      if (current.code !== 0) continue
      if (
        this.tryGitFn(this.baseRepo, [
          '-c',
          `core.hooksPath=${shellPath(hooksPath)}`,
          'update-ref',
          '-d',
          ref,
          current.stdout.trim()
        ]).code !== 0
      ) {
        removed = false
      }
    }
    return removed
  }

  private cleanupObsoleteCompensationRefs(plan: PublicationCompensationPlan): void {
    const prefix = `refs/autowin/compensations/${plan.agentId}/`
    const keepPrefix = plan.generation ? `${prefix}${plan.generation}/` : prefix
    const refs = this.tryGitFn(this.baseRepo, ['for-each-ref', '--format=%(refname)', prefix])
    if (refs.code !== 0) return
    const hooksPath = this.compensationHooksPath()
    if (!hooksPath) return
    for (const ref of refs.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)) {
      if (plan.generation ? ref.startsWith(keepPrefix) : !ref.slice(prefix.length).includes('/')) {
        continue
      }
      const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
      if (current.code !== 0) continue
      this.tryGitFn(this.baseRepo, [
        '-c',
        `core.hooksPath=${shellPath(hooksPath)}`,
        'update-ref',
        '-d',
        ref,
        current.stdout.trim()
      ])
    }
  }

  private areSafeCompensationPaths(value: unknown): value is string[] {
    return (
      Array.isArray(value) &&
      value.every((file) => {
        if (
          typeof file !== 'string' ||
          file.length === 0 ||
          file === '.' ||
          file.startsWith(':') ||
          file.includes('\0') ||
          isAbsolute(file)
        ) {
          return false
        }
        const segments = file.split(/[\\/]/)
        if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
          return false
        }
        const confined = relative(resolve(this.baseRepo), resolve(this.baseRepo, file))
        return Boolean(confined) && !confined.startsWith('..') && !isAbsolute(confined)
      })
    )
  }

  private readCompensationPlan(
    agentId: string
  ): PublicationCompensationPlan | 'invalid' | undefined {
    const planPath = this.compensationPlanPath(agentId)
    const pendingPath = this.compensationPendingPlanPath(agentId)
    if (!planPath || !pendingPath) return undefined
    this.cleanupCompensationPatchResidues(agentId)
    this.reconcileCompensationIndexLock()
    if (existsSync(pendingPath)) {
      const pending = this.parseCompensationPlanFile(pendingPath, agentId)
      const current = existsSync(planPath)
        ? this.parseCompensationPlanFile(planPath, agentId)
        : undefined
      if (
        pending === 'invalid' ||
        !pending ||
        current === 'invalid' ||
        (current && !this.sameCompensationIdentity(current, pending)) ||
        !this.installCompensationRefs(pending)
      ) {
        return 'invalid'
      }
      try {
        renameSync(pendingPath, planPath)
        this.cleanupObsoleteCompensationRefs(pending)
      } catch {
        return 'invalid'
      }
    }
    if (!existsSync(planPath)) return undefined
    const plan = this.parseCompensationPlanFile(planPath, agentId)
    if (plan && plan !== 'invalid') this.cleanupObsoleteCompensationRefs(plan)
    return plan
  }

  private sameCompensationIdentity(
    current: PublicationCompensationPlan,
    pending: PublicationCompensationPlan
  ): boolean {
    return (
      current.agentId === pending.agentId &&
      current.baseSha === pending.baseSha &&
      current.publicationSha === pending.publicationSha &&
      current.expectedBaseBranch === pending.expectedBaseBranch &&
      current.branchPublished === pending.branchPublished &&
      current.postHookIndexTree === pending.postHookIndexTree &&
      current.postHookWorktreeTree === pending.postHookWorktreeTree &&
      JSON.stringify(current.agentFiles) === JSON.stringify(pending.agentFiles) &&
      JSON.stringify(current.indexedAgentPaths) === JSON.stringify(pending.indexedAgentPaths) &&
      JSON.stringify(current.worktreeAgentPaths) === JSON.stringify(pending.worktreeAgentPaths) &&
      JSON.stringify(current.untrackedAgentPaths) === JSON.stringify(pending.untrackedAgentPaths)
    )
  }

  private parseCompensationPlanFile(
    planPath: string,
    agentId: string
  ): PublicationCompensationPlan | 'invalid' | undefined {
    if (!existsSync(planPath)) return undefined
    try {
      const plan = JSON.parse(
        readFileSync(planPath, 'utf8')
      ) as Partial<PublicationCompensationPlan>
      const sha = (value: unknown): value is string =>
        typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value)
      if (
        plan.version !== 2 ||
        plan.agentId !== agentId ||
        (plan.generation !== undefined &&
          (typeof plan.generation !== 'string' || !SAFE_ID.test(plan.generation))) ||
        (plan.phase !== undefined && plan.phase !== 'pending' && plan.phase !== 'compensated') ||
        plan.stage === undefined ||
        ![0, 1, 2, 3, 4].includes(plan.stage) ||
        !sha(plan.baseSha) ||
        !sha(plan.publicationSha) ||
        typeof plan.expectedBaseBranch !== 'string' ||
        this.tryGitFn(this.baseRepo, ['check-ref-format', `refs/heads/${plan.expectedBaseBranch}`])
          .code !== 0 ||
        typeof plan.branchPublished !== 'boolean' ||
        !this.areSafeCompensationPaths(plan.agentFiles) ||
        !this.areSafeCompensationPaths(plan.indexedAgentPaths) ||
        !this.areSafeCompensationPaths(plan.worktreeAgentPaths) ||
        !this.areSafeCompensationPaths(plan.untrackedAgentPaths) ||
        !sha(plan.postHookIndexTree) ||
        !sha(plan.postHookWorktreeTree) ||
        !sha(plan.resumeIndexTree) ||
        !sha(plan.resumeWorktreeTree) ||
        (plan.nextIndexTree === undefined) !== (plan.nextWorktreeTree === undefined) ||
        (plan.nextIndexTree !== undefined && !sha(plan.nextIndexTree)) ||
        (plan.nextWorktreeTree !== undefined && !sha(plan.nextWorktreeTree))
      ) {
        return 'invalid'
      }
      const agentFiles = new Set(plan.agentFiles)
      if (
        ![plan.indexedAgentPaths, plan.worktreeAgentPaths, plan.untrackedAgentPaths].every(
          (items) => items.every((file) => agentFiles.has(file))
        )
      ) {
        return 'invalid'
      }
      return { ...plan, phase: plan.phase ?? 'pending' } as PublicationCompensationPlan
    } catch {
      return 'invalid'
    }
  }

  private clearCompensationPlan(plan: PublicationCompensationPlan): boolean {
    const planPath = this.compensationPlanPath(plan.agentId)
    const pendingPath = this.compensationPendingPlanPath(plan.agentId)
    if (!planPath || !pendingPath || !this.removeCompensationGeneration(plan)) return false
    try {
      rmSync(planPath, { force: true })
      rmSync(pendingPath, { force: true })
      this.cleanupCompensationPatchResidues(plan.agentId)
      return true
    } catch {
      return false
    }
  }

  private compensationPlanFromHooks(
    agentId: string,
    publishHooksPath: string,
    agentFiles: string[],
    baseSha: string,
    publicationSha: string,
    expectedBaseBranch: string,
    branchPublished = true
  ): PublicationCompensationPlan | undefined {
    const indexedAgentPathsFile = join(publishHooksPath, 'post-hook-indexed-agent-paths')
    const indexedAgentPaths = existsSync(indexedAgentPathsFile)
      ? parseNullSeparatedPaths(readFileSync(indexedAgentPathsFile, 'utf8'))
      : []
    const worktreeAgentPathsFile = join(publishHooksPath, 'post-hook-worktree-agent-paths')
    const worktreeAgentPaths = existsSync(worktreeAgentPathsFile)
      ? parseNullSeparatedPaths(readFileSync(worktreeAgentPathsFile, 'utf8'))
      : []
    const untrackedAgentPathsFile = join(publishHooksPath, 'post-hook-untracked-agent-paths')
    const untrackedAgentPaths = existsSync(untrackedAgentPathsFile)
      ? parseNullSeparatedPaths(readFileSync(untrackedAgentPathsFile, 'utf8'))
      : []
    const postHookIndexTreeFile = join(publishHooksPath, 'post-hook-index-tree')
    const postHookWorktreeTreeFile = join(publishHooksPath, 'post-hook-worktree-tree')
    const postHookIndexTree = existsSync(postHookIndexTreeFile)
      ? readFileSync(postHookIndexTreeFile, 'utf8').trim()
      : ''
    const postHookWorktreeTree = existsSync(postHookWorktreeTreeFile)
      ? readFileSync(postHookWorktreeTreeFile, 'utf8').trim()
      : ''
    const plan: PublicationCompensationPlan = {
      version: 2,
      phase: 'pending',
      stage: 0,
      agentId,
      baseSha,
      publicationSha,
      expectedBaseBranch,
      branchPublished,
      agentFiles,
      indexedAgentPaths,
      worktreeAgentPaths,
      untrackedAgentPaths,
      postHookIndexTree,
      postHookWorktreeTree,
      resumeIndexTree: postHookIndexTree,
      resumeWorktreeTree: postHookWorktreeTree
    }
    if (
      !/^[0-9a-f]{40,64}$/i.test(postHookIndexTree) ||
      !/^[0-9a-f]{40,64}$/i.test(postHookWorktreeTree) ||
      !this.areSafeCompensationPaths(agentFiles) ||
      ![indexedAgentPaths, worktreeAgentPaths, untrackedAgentPaths].every(
        (paths) =>
          this.areSafeCompensationPaths(paths) && paths.every((path) => agentFiles.includes(path))
      )
    ) {
      return undefined
    }
    return plan
  }

  private compensationPlanRefsMatch(plan: PublicationCompensationPlan): boolean {
    return this.compensationRefEntries(plan).every(({ ref, sha }) => {
      const currentTree = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
      return currentTree.code === 0 && currentTree.stdout.trim() === sha
    })
  }

  private promoteCompensationResidue(integrationPath: string): { ok: boolean; detail?: string } {
    const hooksPath = join(integrationPath, '.autowin-publish-hooks')
    if (
      !existsSync(join(hooksPath, 'post-hook-change')) ||
      existsSync(join(hooksPath, 'compensation-complete'))
    ) {
      return { ok: true }
    }
    const intentPath = join(hooksPath, 'compensation-intent.json')
    if (!existsSync(intentPath)) {
      return { ok: false, detail: 'Intention de compensation absente : copie conservée.' }
    }
    let intent: Partial<PublicationCompensationIntent>
    try {
      intent = JSON.parse(
        readFileSync(intentPath, 'utf8')
      ) as Partial<PublicationCompensationIntent>
    } catch {
      return { ok: false, detail: 'Intention de compensation illisible : copie conservée.' }
    }
    if (
      intent.version !== 1 ||
      typeof intent.agentId !== 'string' ||
      !SAFE_ID.test(intent.agentId) ||
      typeof intent.baseSha !== 'string' ||
      !/^[0-9a-f]{40,64}$/i.test(intent.baseSha) ||
      typeof intent.publicationSha !== 'string' ||
      !/^[0-9a-f]{40,64}$/i.test(intent.publicationSha) ||
      typeof intent.expectedBaseBranch !== 'string' ||
      this.tryGitFn(this.baseRepo, ['check-ref-format', `refs/heads/${intent.expectedBaseBranch}`])
        .code !== 0 ||
      !this.areSafeCompensationPaths(intent.agentFiles)
    ) {
      return { ok: false, detail: 'Intention de compensation invalide : copie conservée.' }
    }
    const currentPlan = this.readCompensationPlan(intent.agentId)
    if (currentPlan === 'invalid') {
      return { ok: false, detail: 'Plan de compensation invalide : copie conservée.' }
    }
    if (currentPlan) {
      if (
        currentPlan.baseSha !== intent.baseSha ||
        currentPlan.publicationSha !== intent.publicationSha ||
        currentPlan.expectedBaseBranch !== intent.expectedBaseBranch ||
        !this.compensationPlanRefsMatch(currentPlan)
      ) {
        return { ok: false, detail: 'Plan de compensation incohérent : copie conservée.' }
      }
      return { ok: true }
    }
    const branch = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      `refs/heads/${intent.expectedBaseBranch}`
    ])
    if (
      branch.code !== 0 ||
      ![intent.baseSha, intent.publicationSha].includes(branch.stdout.trim())
    ) {
      return {
        ok: false,
        detail: 'La branche a divergé avant la reprise de compensation : copie conservée.'
      }
    }
    const plan = this.compensationPlanFromHooks(
      intent.agentId,
      hooksPath,
      intent.agentFiles,
      intent.baseSha,
      intent.publicationSha,
      intent.expectedBaseBranch,
      branch.stdout.trim() === intent.publicationSha
    )
    if (!plan || !this.persistCompensationPlan(plan)) {
      return {
        ok: false,
        detail: 'Les snapshots de compensation n’ont pas pu être promus durablement.'
      }
    }
    return { ok: true }
  }

  private compensatePostHookChange(
    agentId: string,
    publishHooksPath: string,
    agentFiles: string[],
    baseSha: string,
    publicationSha: string,
    expectedBaseBranch: string,
    branchPublished = true
  ): { ok: boolean; files: string[]; detail?: string } {
    const plan = this.compensationPlanFromHooks(
      agentId,
      publishHooksPath,
      agentFiles,
      baseSha,
      publicationSha,
      expectedBaseBranch,
      branchPublished
    )
    if (!plan) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'Les snapshots du hook sont invalides ; la copie d’intégration est conservée.'
      }
    }
    const currentCheckpoint = this.snapshotCompensationWorkspace(agentFiles)
    if (
      !currentCheckpoint ||
      currentCheckpoint.indexTree !== plan.resumeIndexTree ||
      currentCheckpoint.worktreeTree !== plan.resumeWorktreeTree
    ) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail:
          'Le workspace a changé après le hook ; aucune compensation automatique n’a été appliquée.'
      }
    }
    if (!this.persistCompensationPlan(plan)) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'Le plan durable de compensation n’a pas pu être enregistré avant la restauration.'
      }
    }
    const compensation = this.applyCompensationPlan(plan, true)
    if (compensation.ok) {
      try {
        writeFileSync(join(publishHooksPath, 'compensation-complete'), '')
      } catch {
        return {
          ok: false,
          files: compensation.files,
          detail: 'La compensation terminée n’a pas pu être marquée durablement.'
        }
      }
      if (!this.clearCompensationPlan(plan)) {
        return {
          ok: false,
          files: compensation.files,
          detail: 'Le plan compensé reste en attente d’acquittement durable.'
        }
      }
    }
    return compensation
  }

  private snapshotCompensationWorkspace(
    agentFiles: string[]
  ): { indexTree: string; worktreeTree: string } | undefined {
    const root = this.compensationRoot()
    const indexPathProbe = this.tryGitFn(this.baseRepo, ['rev-parse', '--git-path', 'index'])
    if (!root || indexPathProbe.code !== 0) return undefined
    const rawIndexPath = indexPathProbe.stdout.trim()
    const indexPath = isAbsolute(rawIndexPath) ? rawIndexPath : resolve(this.baseRepo, rawIndexPath)
    const temporaryIndex = join(root, `checkpoint-${randomUUID()}.index`)
    mkdirSync(root, { recursive: true })
    try {
      copyFileSync(indexPath, temporaryIndex)
      const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }
      const indexTree = execFileSync('git', ['write-tree'], {
        cwd: this.baseRepo,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      if (agentFiles.length > 0) {
        const tracked = new Set(
          parseNullSeparatedPaths(
            execFileSync('git', ['ls-files', '-z', '--', ...agentFiles], {
              cwd: this.baseRepo,
              env,
              encoding: 'utf8',
              windowsHide: true,
              timeout: GIT_COMMAND_TIMEOUT_MS,
              stdio: ['ignore', 'pipe', 'pipe']
            })
          )
        )
        const snapshotFiles = agentFiles.filter(
          (file) => tracked.has(file) || existsSync(resolve(this.baseRepo, file))
        )
        if (snapshotFiles.length > 0) {
          execFileSync('git', ['add', '-A', '-f', '--', ...snapshotFiles], {
            cwd: this.baseRepo,
            env,
            encoding: 'utf8',
            windowsHide: true,
            timeout: GIT_COMMAND_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        }
      }
      const worktreeTree = execFileSync('git', ['write-tree'], {
        cwd: this.baseRepo,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      if (!/^[0-9a-f]{40,64}$/i.test(indexTree) || !/^[0-9a-f]{40,64}$/i.test(worktreeTree)) {
        return undefined
      }
      return { indexTree, worktreeTree }
    } catch {
      return undefined
    } finally {
      rmSync(temporaryIndex, { force: true })
    }
  }

  private transformCompensationTree(
    currentTree: string,
    sourceTree: string,
    paths: string[]
  ): string | undefined {
    if (paths.length === 0) return currentTree
    const root = this.compensationRoot()
    if (!root) return undefined
    mkdirSync(root, { recursive: true })
    const temporaryIndex = join(root, `transform-${randomUUID()}.index`)
    const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }
    try {
      execFileSync('git', ['read-tree', currentTree], {
        cwd: this.baseRepo,
        env,
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      execFileSync('git', ['restore', `--source=${sourceTree}`, '--staged', '--', ...paths], {
        cwd: this.baseRepo,
        env,
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const tree = execFileSync('git', ['write-tree'], {
        cwd: this.baseRepo,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      return /^[0-9a-f]{40,64}$/i.test(tree) ? tree : undefined
    } catch {
      return undefined
    } finally {
      rmSync(temporaryIndex, { force: true })
    }
  }

  private compensationCheckpointMatches(
    checkpoint: { indexTree: string; worktreeTree: string } | undefined,
    indexTree: string,
    worktreeTree: string
  ): boolean {
    return Boolean(
      checkpoint && checkpoint.indexTree === indexTree && checkpoint.worktreeTree === worktreeTree
    )
  }

  /**
   * Applique une transition seulement si son préimage est encore présent. Contrairement à
   * `restore`, `git apply` vérifie le contenu dans la commande qui écrit ; `--cached` bénéficie en
   * plus du verrou natif de l’index. Pour un patch worktree, un vrai `index.lock` est tenu depuis la
   * validation de l’arbre index jusqu’à la fin du patch.
   */
  private applyCompensationTreePatch(
    agentId: string,
    expectedIndexTree: string,
    currentTree: string,
    nextTree: string,
    paths: string[],
    channel: 'index' | 'worktree'
  ): boolean {
    if (currentTree === nextTree || paths.length === 0) return true
    const patchRoot = this.compensationPatchRoot(agentId)
    if (!patchRoot) return false
    mkdirSync(patchRoot, { recursive: true })
    const operationId = randomUUID()
    const patchPath = join(patchRoot, `conditional-${operationId}.patch`)
    const indexSnapshotPath = join(patchRoot, `conditional-${operationId}.index`)
    let indexLock: CompensationIndexLock | undefined
    try {
      const patch = execFileSync(
        'git',
        ['diff', '--binary', '--full-index', currentTree, nextTree, '--', ...paths],
        {
          cwd: this.baseRepo,
          windowsHide: true,
          timeout: GIT_COMMAND_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      if (patch.length === 0) return true
      writeFileSync(patchPath, patch)
      if (channel === 'worktree') {
        indexLock = this.acquireCompensationIndexLock()
        if (!indexLock) return false
        copyFileSync(indexLock.path.slice(0, -'.lock'.length), indexSnapshotPath)
        const currentIndexTree = execFileSync('git', ['write-tree'], {
          cwd: this.baseRepo,
          env: { ...process.env, GIT_INDEX_FILE: indexSnapshotPath },
          encoding: 'utf8',
          windowsHide: true,
          timeout: GIT_COMMAND_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim()
        if (currentIndexTree !== expectedIndexTree) return false
      }
      if (
        channel === 'worktree' &&
        (!indexLock || !this.ownsCompensationIndexLock(indexLock, GIT_COMMAND_TIMEOUT_MS))
      ) {
        return false
      }
      const apply = this.tryGitFn(this.baseRepo, [
        'apply',
        '--binary',
        ...(channel === 'index' ? ['--cached'] : ['--no-index']),
        patchPath
      ])
      return apply.code === 0
    } catch {
      return false
    } finally {
      if (indexLock) this.releaseCompensationIndexLock(indexLock)
      rmSync(patchPath, { force: true })
      rmSync(indexSnapshotPath, { force: true })
      if (existsSync(patchRoot) && readdirSync(patchRoot).length === 0) {
        rmSync(patchRoot, { recursive: true, force: true })
      }
    }
  }

  private applyCompensationPlan(
    plan: PublicationCompensationPlan,
    deferClear = false
  ): {
    ok: boolean
    files: string[]
    detail?: string
  } {
    const {
      agentId,
      agentFiles,
      baseSha,
      publicationSha,
      expectedBaseBranch,
      branchPublished,
      indexedAgentPaths,
      worktreeAgentPaths,
      untrackedAgentPaths,
      postHookIndexTree,
      postHookWorktreeTree
    } = plan
    const currentBranch = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      `refs/heads/${expectedBaseBranch}`
    ])
    if (currentBranch.code !== 0) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'La branche à compenser est devenue introuvable.'
      }
    }
    if (branchPublished && currentBranch.stdout.trim() === publicationSha) {
      const rollbackHooksPath = this.compensationHooksPath()
      if (!rollbackHooksPath) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'Le répertoire de hooks neutres est indisponible pour la compensation.'
        }
      }
      const rollback = this.tryGitFn(this.baseRepo, [
        '-c',
        `core.hooksPath=${shellPath(rollbackHooksPath)}`,
        'update-ref',
        `refs/heads/${expectedBaseBranch}`,
        baseSha,
        publicationSha
      ])
      if (rollback.code !== 0) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail:
            'La branche publiée n’a pas pu être restaurée sans course après le hook utilisateur.'
        }
      }
    } else if (currentBranch.stdout.trim() !== baseSha) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail:
          'La branche a avancé ailleurs pendant la compensation ; aucune restauration risquée.'
      }
    }

    if (plan.phase === 'compensated') {
      const files = this.workingTreeFiles(this.baseRepo)
      if (!this.acknowledgePublication(agentId, publicationSha)) {
        return {
          ok: false,
          files,
          detail: 'La publication compensée n’a pas pu être libérée sans course.'
        }
      }
      if (!deferClear && !this.clearCompensationPlan(plan)) {
        return {
          ok: false,
          files,
          detail: 'Le plan durable compensé n’a pas pu être acquitté.'
        }
      }
      return { ok: true, files }
    }

    const userWorktreeAgentFiles = [...new Set([...worktreeAgentPaths, ...untrackedAgentPaths])]
    while (plan.stage < 4) {
      const stage = plan.stage
      const steps: ReadonlyArray<{
        source: string
        paths: string[]
        channel: 'index' | 'worktree'
        failure: string
      }> = [
        {
          source: baseSha,
          paths: agentFiles,
          channel: 'index',
          failure: 'L’index antérieur n’a pas pu être restauré sans toucher au contenu utilisateur.'
        },
        {
          source: postHookIndexTree,
          paths: indexedAgentPaths,
          channel: 'index',
          failure: 'L’index produit par le hook n’a pas pu être réappliqué.'
        },
        {
          source: baseSha,
          paths: agentFiles,
          channel: 'worktree',
          failure: 'Le contenu agent n’a pas pu être retiré du worktree sans écrasement.'
        },
        {
          source: postHookWorktreeTree,
          paths: userWorktreeAgentFiles,
          channel: 'worktree',
          failure: 'Le contenu produit par le hook n’a pas pu être réappliqué.'
        }
      ]
      const step = steps[stage]
      if (!step) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'Le plan de compensation contient une étape invalide.'
        }
      }

      if (step.paths.length === 0) {
        plan.stage = (stage + 1) as 1 | 2 | 3 | 4
        if (!this.persistCompensationPlan(plan)) {
          return {
            ok: false,
            files: this.workingTreeFiles(this.baseRepo),
            detail: 'L’avancement du plan de compensation n’a pas pu être persisté.'
          }
        }
        continue
      }

      if (plan.nextIndexTree && plan.nextWorktreeTree) {
        const checkpoint = this.snapshotCompensationWorkspace(agentFiles)
        if (
          this.compensationCheckpointMatches(checkpoint, plan.nextIndexTree, plan.nextWorktreeTree)
        ) {
          plan.resumeIndexTree = plan.nextIndexTree
          plan.resumeWorktreeTree = plan.nextWorktreeTree
          plan.nextIndexTree = undefined
          plan.nextWorktreeTree = undefined
          plan.stage = (stage + 1) as 1 | 2 | 3 | 4
          if (!this.persistCompensationPlan(plan)) {
            return {
              ok: false,
              files: this.workingTreeFiles(this.baseRepo),
              detail: 'L’étape compensée n’a pas pu être acquittée durablement.'
            }
          }
          continue
        }
        if (
          !this.compensationCheckpointMatches(
            checkpoint,
            plan.resumeIndexTree,
            plan.resumeWorktreeTree
          )
        ) {
          return {
            ok: false,
            files: this.workingTreeFiles(this.baseRepo),
            detail:
              'Le workspace a changé pendant une étape de compensation ; aucune mutation supplémentaire.'
          }
        }
      } else {
        const nextIndexTree =
          step.channel === 'index'
            ? this.transformCompensationTree(plan.resumeIndexTree, step.source, step.paths)
            : plan.resumeIndexTree
        const nextWorktreeTree =
          step.channel === 'worktree'
            ? this.transformCompensationTree(plan.resumeWorktreeTree, step.source, step.paths)
            : plan.resumeWorktreeTree
        if (!nextIndexTree || !nextWorktreeTree) {
          return {
            ok: false,
            files: this.workingTreeFiles(this.baseRepo),
            detail: 'La cible de l’étape de compensation n’a pas pu être calculée.'
          }
        }
        plan.nextIndexTree = nextIndexTree
        plan.nextWorktreeTree = nextWorktreeTree
        if (!this.persistCompensationPlan(plan)) {
          return {
            ok: false,
            files: this.workingTreeFiles(this.baseRepo),
            detail: 'La cible de l’étape de compensation n’a pas pu être ancrée durablement.'
          }
        }
      }

      const beforeMutation = this.snapshotCompensationWorkspace(agentFiles)
      if (
        !this.compensationCheckpointMatches(
          beforeMutation,
          plan.resumeIndexTree,
          plan.resumeWorktreeTree
        )
      ) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'Le workspace a changé juste avant la restauration ; aucune mutation automatique.'
        }
      }

      const currentTree = step.channel === 'index' ? plan.resumeIndexTree : plan.resumeWorktreeTree
      const nextTree = step.channel === 'index' ? plan.nextIndexTree : plan.nextWorktreeTree
      if (
        !nextTree ||
        !this.applyCompensationTreePatch(
          agentId,
          plan.resumeIndexTree,
          currentTree,
          nextTree,
          step.paths,
          step.channel
        )
      ) {
        return { ok: false, files: this.workingTreeFiles(this.baseRepo), detail: step.failure }
      }
      const afterMutation = this.snapshotCompensationWorkspace(agentFiles)
      if (
        !plan.nextIndexTree ||
        !plan.nextWorktreeTree ||
        !this.compensationCheckpointMatches(
          afterMutation,
          plan.nextIndexTree,
          plan.nextWorktreeTree
        )
      ) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'L’étape de compensation ne correspond pas à sa cible durable.'
        }
      }
      plan.resumeIndexTree = plan.nextIndexTree
      plan.resumeWorktreeTree = plan.nextWorktreeTree
      plan.nextIndexTree = undefined
      plan.nextWorktreeTree = undefined
      plan.stage = (stage + 1) as 1 | 2 | 3 | 4
      if (!this.persistCompensationPlan(plan)) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'L’étape de compensation appliquée n’a pas pu être acquittée durablement.'
        }
      }
    }

    Object.assign(plan, { phase: 'compensated' as const })
    if (!this.persistCompensationPlan(plan)) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'L’état compensé n’a pas pu être persisté avant acquittement.'
      }
    }
    const files = this.workingTreeFiles(this.baseRepo)
    if (!this.acknowledgePublication(agentId, publicationSha)) {
      return {
        ok: false,
        files,
        detail: 'La publication compensée n’a pas pu être libérée sans course.'
      }
    }
    if (!deferClear && !this.clearCompensationPlan(plan)) {
      return {
        ok: false,
        files,
        detail: 'Le plan durable compensé n’a pas pu être acquitté.'
      }
    }
    return { ok: true, files }
  }

  private resumePendingCompensation(
    agentId: string,
    expectedBaseBranch: string
  ): FinalizeResult | undefined {
    const plan = this.readCompensationPlan(agentId)
    if (!plan) return undefined
    if (plan === 'invalid') {
      return {
        outcome: 'blocked',
        agentId,
        files: this.workingTreeFiles(this.baseRepo),
        reason: 'merge-failed',
        preserveAgentFiles: true,
        detail: 'Le plan durable de compensation est invalide ; aucune mutation automatique.'
      }
    }
    if (
      plan.expectedBaseBranch !== expectedBaseBranch ||
      !this.isExpectedBaseBranch(expectedBaseBranch)
    ) {
      return {
        outcome: 'blocked',
        agentId,
        files: this.workingTreeFiles(this.baseRepo),
        reason: 'merge-failed',
        preserveAgentFiles: true,
        detail: 'Le contexte Git ne correspond plus au plan durable de compensation.'
      }
    }
    const publicationRef = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      this.publicationMarkerRef(agentId)
    ])
    if (publicationRef.code === 0 && publicationRef.stdout.trim() !== plan.publicationSha) {
      return {
        outcome: 'blocked',
        agentId,
        files: this.workingTreeFiles(this.baseRepo),
        reason: 'merge-failed',
        preserveAgentFiles: true,
        detail: 'L’ancre de publication ne correspond plus au plan durable de compensation.'
      }
    }
    if (plan.phase === 'compensated') {
      const compensation = this.applyCompensationPlan(plan)
      return {
        outcome: 'blocked',
        agentId,
        files: compensation.files,
        reason: compensation.ok ? 'base-in-progress' : 'merge-failed',
        preserveAgentFiles: true,
        detail: compensation.ok
          ? 'La compensation terminée a été acquittée après reprise.'
          : compensation.detail
      }
    }
    const compensationTrees = [
      plan.postHookIndexTree,
      plan.postHookWorktreeTree,
      plan.resumeIndexTree,
      plan.resumeWorktreeTree,
      plan.nextIndexTree,
      plan.nextWorktreeTree
    ].filter((tree): tree is string => Boolean(tree))
    for (const tree of compensationTrees) {
      if (this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${tree}^{tree}`]).code !== 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: this.workingTreeFiles(this.baseRepo),
          reason: 'merge-failed',
          preserveAgentFiles: true,
          detail: 'Un arbre requis par le plan durable de compensation est indisponible.'
        }
      }
    }
    if (!this.compensationPlanRefsMatch(plan)) {
      return {
        outcome: 'blocked',
        agentId,
        files: this.workingTreeFiles(this.baseRepo),
        reason: 'merge-failed',
        preserveAgentFiles: true,
        detail: 'Les ancres Git du plan durable de compensation sont incohérentes.'
      }
    }
    const compensation = this.applyCompensationPlan(plan)
    return {
      outcome: 'blocked',
      agentId,
      files: compensation.files,
      reason: compensation.ok ? 'base-in-progress' : 'merge-failed',
      preserveAgentFiles: true,
      detail: compensation.ok
        ? 'La compensation interrompue a été reprise ; le travail utilisateur est préservé.'
        : compensation.detail
    }
  }

  /**
   * LA REF QUE HEAD DESIGNE ET QUI N'EXISTE PLUS — sinon `undefined`.
   *
   * Quand la publication d'un bureau aboutit, sa branche de recuperation est SUPPRIMEE : cette
   * disparition EST le signal du succes. Le dossier, lui, peut survivre (un verrou de fichier
   * suffit sous Windows). Son HEAD designe alors une ref absente, et tout ce qui le relit ensuite
   * lit un bureau sans base : `git status` rend le depot ENTIER en nouveau.
   *
   * `symbolic-ref` continue de repondre quand `rev-parse HEAD` echoue — c'est ce qui permet de
   * distinguer « HEAD casse » d'un simple bureau vide.
   */
  private refManquanteDeHead(path: string): string | undefined {
    if (this.tryGitFn(path, ['rev-parse', '--verify', 'HEAD']).code === 0) return undefined
    const ref = this.tryGitFn(path, ['symbolic-ref', 'HEAD'])
    if (ref.code !== 0) return undefined
    const nom = ref.stdout.trim()
    return nom.length > 0 ? nom : undefined
  }

  /**
   * LE DERNIER COMMIT D'UN BUREAU DONT HEAD NE RESOUT PLUS, lu dans son propre reflog.
   *
   * C'est la SEULE preuve positive disponible pour decider si son travail est deja dans la base. On
   * ne se contente pas de l'absence de branche : une ref peut se perdre autrement, et « branche
   * disparue » ne prouve pas « travail publie ». Sans cette lecture, un correctif qui range les
   * bureaux publies rangerait aussi des bureaux irremplacables.
   *
   * Le fichier de reflog vit dans le repertoire git PROPRE au bureau, que son `.git` designe.
   */
  private shaDuReflog(path: string): string | undefined {
    try {
      const pointeur = readFileSync(join(path, '.git'), 'utf8').trim()
      const prefixe = 'gitdir:'
      if (!pointeur.startsWith(prefixe)) return undefined
      const gitdir = pointeur.slice(prefixe.length).trim()
      // Decoupage par le CODE du saut de ligne : un caractere de controle ecrit a la main dans un
      // patch a deja fige un defaut dans ce depot (voir `SAUT`, `ANTISLASH`). Le `trim` par ligne
      // absorbe le retour chariot de Windows.
      const lignes = readFileSync(join(gitdir, 'logs', 'HEAD'), 'utf8')
        .split(String.fromCharCode(10))
        .map((ligne) => ligne.trim())
        .filter((ligne) => ligne.length > 0)
      const derniere = lignes[lignes.length - 1]
      if (!derniere) return undefined
      const apres = derniere.split(' ')[1]
      return apres && /^[0-9a-f]{40}$/.test(apres) ? apres : undefined
    } catch {
      return undefined
    }
  }

  private cleanupWorktree(path: string, force = true): { ok: boolean; detail?: string } {
    /*
     * On retire D'ABORD ce que NOUS avons ajouté : le lien vers les dépendances.
     *
     * Mesuré le 2026-08-25 : `git worktree remove --force` rend 0 mais ne touche pas au
     * `node_modules` qu'il ne suit pas. Le dossier de la copie SURVIT alors, ne contenant plus que
     * la jonction — et ce nettoyage, qui conclut `ok` dès que git a rendu 0, ne s'en aperçoit pas.
     * Chaque run laisserait une coquille orpheline, précisément ce qu'il doit empêcher.
     *
     * `delierLesDependances` refuse de toucher à un VRAI dossier de modules : seul un lien part.
     */
    delierLesDependances(path)
    const remove = this.tryGitFn(this.baseRepo, [
      'worktree',
      'remove',
      ...(force ? ['--force'] : []),
      path
    ])
    if (remove.code === 0) {
      /*
       * GIT A RENDU 0 — CA NE PROUVE PAS QUE LE DOSSIER EST PARTI.
       *
       * Mesure le 2026-08-25 : deux bureaux liberes par `git worktree remove --force` (code 0) ont
       * laisse leur dossier en place, zero fichier utile, un `.git` orphelin, ~1 Mo piece. Le
       * commentaire ci-dessus decrivait deja ce risque, mais ce `return` concluait `ok` sur le seul
       * code de sortie, sans jamais REGARDER. C'est tres probablement l'origine des douze coquilles
       * trouvees le meme jour dans ce depot.
       *
       * Et une coquille ne coute pas que du disque : un `git status` lance dedans ne repond pas
       * « vide », git remonte l'arborescence et rapporte l'etat du depot PARENT. Douze coquilles ont
       * ainsi paru porter du travail, et cette fausse lecture a ete propagee jusque dans un message
       * de commit avant d'etre rattrapee.
       *
       * On ne retire QUE ce dont l'absence de valeur est demontree : le dossier ne contient AUCUN
       * fichier hors `.git`. Un residu qui porte quoi que ce soit reste en place et fait echouer le
       * nettoyage, plutot que d'etre efface en silence.
       */
      if (existsSync(path) && estCoquilleVide(path)) {
        try {
          this.removeDirFn(path)
        } catch {
          /* La coquille sera revue au prochain balayage : ne pas faire echouer une liberation
             reussie pour un dossier vide qu'on n'a pas pu retirer maintenant. */
        }
      }
      return { ok: true }
    }
    if (!force) {
      return { ok: false, detail: (remove.stderr || remove.stdout).trim() || undefined }
    }

    let filesystemDetail = ''
    try {
      this.removeDirFn(path)
    } catch (error) {
      filesystemDetail = error instanceof Error ? error.message : String(error)
    }
    const prune = this.tryGitFn(this.baseRepo, ['worktree', 'prune'])
    if (!existsSync(path) && prune.code === 0) return { ok: true }

    return {
      ok: false,
      detail: [
        (remove.stderr || remove.stdout).trim(),
        filesystemDetail,
        (prune.stderr || prune.stdout).trim()
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  /** Donne (ou réutilise) la copie isolée de l'agent. Idempotent. Ne touche pas le repo de base. */
  acquire(agentId: string, context?: WorktreeRunContext): string {
    const path = this.pathFor(agentId)
    if (existsSync(path)) {
      const ownershipIssue = this.ownershipIssue(path)
      if (ownershipIssue) throw new Error(ownershipIssue)
      return path
    }
    if (
      context &&
      (canonicalPath(context.workspacePath) !== canonicalPath(this.baseRepo) ||
        canonicalPath(context.worktreePath) !== canonicalPath(path))
    ) {
      throw new Error('Contexte de bureau incohérent avec ce dépôt.')
    }
    if (
      context &&
      (!/^[0-9a-f]{40,64}$/i.test(context.baseSha) ||
        (context.sourceSha !== undefined && !/^[0-9a-f]{40,64}$/i.test(context.sourceSha)))
    ) {
      throw new Error('SHA de départ du bureau invalide.')
    }
    const startRevision = context?.sourceSha ?? context?.baseSha ?? this.currentBaseBranch()
    if (
      context &&
      this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${startRevision}^{commit}`]).code !== 0
    ) {
      throw new Error('La révision capturée du bureau n’est plus disponible.')
    }
    mkdirSync(this.worktreeRoot, { recursive: true })
    this.git(this.baseRepo, ['worktree', 'add', '--detach', path, startRevision])
    if (context && this.git(path, ['rev-parse', 'HEAD']) !== startRevision) {
      this.cleanupWorktree(path)
      throw new Error('La copie créée ne correspond pas à la révision capturée.')
    }
    /*
     * Les dépendances sont reliées AVANT que l'agent ne travaille, sinon il ne pourra rien prouver.
     *
     * Une copie agent est un `git worktree add` : elle ne porte que les fichiers suivis, et
     * `node_modules` est ignoré par git. Mesuré le 2026-08-25 dans une copie fraîche :
     * `npx vitest run` échoue sur « Cannot find module 'vitest/config' » — vitest ne charge même
     * pas sa configuration. Sans preuve exécutable, `etatDeCloture` rend `red` et le contrôle final
     * affiche « Échec déjà déclaré », sur un travail pourtant fait et prouvé.
     *
     * Le résultat n'est pas jeté : une copie sans dépendances reste utilisable pour lire et éditer.
     */
    this.derniereLiaisonDependances = lierLesDependances(this.baseRepo, path)
    return path
  }

  /**
   * L'état des dépendances de la dernière copie créée, en une phrase destinée à la trace du run.
   *
   * `undefined` tant qu'aucune copie n'a été créée par cette instance : on ne rend pas une phrase
   * rassurante sur un geste qui n'a pas eu lieu.
   */
  etatDesDependances(): string | undefined {
    return this.derniereLiaisonDependances
      ? messageLiaison(this.derniereLiaisonDependances)
      : undefined
  }

  /** Contexte figé au début d'un run ; le coordinateur le persiste avant toute publication. */
  describe(agentId: string): WorktreeRunContext {
    const baseBranch = this.currentBaseBranch()
    return {
      workspacePath: this.baseRepo,
      worktreePath: this.pathFor(agentId),
      baseBranch,
      // Résout la branche lue, pas HEAD : un changement de branche entre ces deux appels ne peut
      // plus produire une paire branche/SHA incohérente.
      baseSha: this.git(this.baseRepo, ['rev-parse', `refs/heads/${baseBranch}`])
    }
  }

  /**
   * Prépare le snapshot d'un NOUVEAU job : fetch distant sans toucher au workspace, puis choisit la
   * révision la plus fraîche tant que local et origin/main|master restent linéaires. Une divergence
   * ne bloque plus le lancement (décision user 14/08 : Autowin auto-gère, il ne bloque pas) : le job
   * part de la base de publication (origin) et les commits locaux non intégrés sont EXCLUS et
   * NOMMÉS dans le contexte — même philosophie que les fichiers sales, visible jamais silencieux.
   */
  describeForLaunch(agentId: string): WorktreeRunContext {
    const local = this.describe(agentId)
    const remote = this.canonicalRemoteBase()
    let sourceSha = local.baseSha
    let excludedLocalCommits: string[] | undefined
    if (remote) {
      const localBeforeRemote =
        this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', local.baseSha, remote.sha])
          .code === 0
      const remoteBeforeLocal =
        this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', remote.sha, local.baseSha])
          .code === 0
      if (!localBeforeRemote && !remoteBeforeLocal) {
        sourceSha = remote.sha
        const listed = this.tryGitFn(this.baseRepo, [
          'rev-list',
          '--oneline',
          `${remote.sha}..${local.baseSha}`
        ])
        excludedLocalCommits =
          listed.code === 0 ? listed.stdout.split('\n').filter(Boolean) : undefined
      }
      if (localBeforeRemote) sourceSha = remote.sha
    }
    const excludedDirtyFiles = parsePorcelainPaths(
      this.git(this.baseRepo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    )
    const excludedDirtyFileLimit = 500
    return {
      ...local,
      sourceSha,
      ...(remote ? { canonicalBaseRef: remote.ref } : {}),
      excludedDirtyFiles: excludedDirtyFiles.slice(0, excludedDirtyFileLimit),
      excludedDirtyFileCount: excludedDirtyFiles.length,
      excludedDirtyFilesTruncated: excludedDirtyFiles.length > excludedDirtyFileLimit,
      ...(excludedLocalCommits
        ? {
            excludedLocalCommits: excludedLocalCommits.slice(0, 20),
            excludedLocalCommitCount: excludedLocalCommits.length
          }
        : {})
    }
  }

  /** Liste les fichiers modifiés (ajout/mod/suppr) dans la copie de l'agent. */
  /**
   * Recoupe une autorisation durable avec l'état Git réel avant toute reprise automatique.
   * Un JSON valide ne suffit pas : la copie doit être celle de ce dépôt et ses révisions doivent
   * exister dans la branche capturée.
   */
  validateRecoveryContext(
    agentId: string,
    context: WorktreeRecoveryContext
  ):
    | {
        ok: true
        decision?: 'resume-publication' | 'cleanup-only'
        publishedSha?: string
      }
    | {
        ok: false
        detail: string
        /*
         * VRAI quand le refus ne pourra JAMAIS reussir, quoi qu'on retente -- par opposition a un
         * refus transitoire (arbre occupe, base qui bouge) qui se repare tout seul.
         *
         * MESURE le 2026-08-24 sur l'app reelle : vingt-et-une copies occupaient le disque et
         * polluaient le Hub, toutes refusees pour ascendance rompue. Le systeme connaissait le
         * verdict et n'en faisait rien : il gardait la copie, et la RESTAURAIT meme au demarrage.
         *
         * Ce champ existe pour que l'appelant puisse AGIR sur le verdict sans avoir a reconnaitre
         * une phrase francaise dans `detail` -- ce qui serait une rustine, et casserait a la
         * premiere reformulation.
         */
        definitif?: true
      } {
    try {
      assertSafeId(agentId, 'agentId')
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    const path = this.pathFor(agentId)
    if (canonicalPath(context.worktreePath) !== canonicalPath(path)) {
      return { ok: false, detail: 'Le contexte durable ne correspond pas à ce dépôt.' }
    }
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(context.baseSha)) {
      /*
       * DEFINITIF : une base absente ou illisible est une valeur STOCKEE, pas un aleas. Aucun
       * reessai ne la rendra valide. Depuis que la reconstruction cesse de FABRIQUER une base pour
       * un run sans fiche, ce refus est le chemin honnete de ces runs -- et le marquer definitif
       * fait ranger leur copie au lieu de la laisser occuper le disque indefiniment. Le travail,
       * lui, reste joignable sur `autowin/recovery/<id>`.
       */
      return { ok: false, detail: 'Le SHA de départ durable est invalide.', definitif: true }
    }
    const sourceSha = context.sourceSha ?? context.baseSha
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(sourceSha) || !this.revisionExists(sourceSha)) {
      return { ok: false, detail: 'Le SHA source durable est invalide ou indisponible.' }
    }
    const branchRef = `refs/heads/${context.baseBranch}`
    if (
      this.tryGitFn(this.baseRepo, ['check-ref-format', '--branch', context.baseBranch]).code !==
        0 ||
      this.tryGitFn(this.baseRepo, ['show-ref', '--verify', '--quiet', branchRef]).code !== 0 ||
      !this.revisionExists(context.baseSha)
    ) {
      return { ok: false, detail: 'La branche ou le SHA durable n’existe plus dans ce dépôt.' }
    }
    if (
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', context.baseSha, branchRef])
        .code !== 0
    ) {
      return { ok: false, detail: 'Le SHA durable n’appartient plus à la branche capturée.' }
    }

    const publishedState =
      context.publication === 'published' || context.publication === 'cleanup-pending'
    const preparedAgentSha = context.agentSha ?? context.publishedSha
    const hasPreparedSha = Boolean(preparedAgentSha)
    const preparedShaIsValid =
      hasPreparedSha &&
      /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(preparedAgentSha!) &&
      this.revisionExists(preparedAgentSha!)
    const preparedShaIsPublished =
      preparedShaIsValid &&
      this.tryGitFn(this.baseRepo, [
        'merge-base',
        '--is-ancestor',
        context.publishedSha ?? preparedAgentSha!,
        branchRef
      ]).code === 0
    const publicationMarker = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      this.publicationMarkerRef(agentId)
    ])
    const markerSha = publicationMarker.code === 0 ? publicationMarker.stdout.trim() : undefined
    const markerIsValid =
      Boolean(markerSha) &&
      this.revisionExists(markerSha!) &&
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', context.baseSha, markerSha!])
        .code === 0 &&
      (!preparedAgentSha ||
        this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', preparedAgentSha, markerSha!])
          .code === 0)
    if (markerSha && !markerIsValid) {
      return { ok: false, detail: 'La transaction de publication durable est invalide.' }
    }
    const markerIsPublished =
      markerIsValid &&
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', markerSha!, branchRef]).code ===
        0
    if (!context.publishedSha && markerIsPublished) {
      return { ok: true, decision: 'cleanup-only', publishedSha: markerSha }
    }
    if (publishedState) {
      if (!preparedShaIsValid || !preparedShaIsPublished) {
        return {
          ok: false,
          detail: 'La publication durable ne peut pas être prouvée sur la branche capturée.'
        }
      }
      // `cleanupPublished` revérifie l'ownership juste avant toute mutation. Une copie devenue
      // étrangère ne doit pas effacer le fait déjà prouvé que la SHA est publiée.
      return { ok: true, decision: 'cleanup-only' }
    }
    if (hasPreparedSha && !preparedShaIsValid) {
      return { ok: false, detail: 'Le SHA préparé pour la publication est invalide.' }
    }
    if (preparedShaIsPublished) {
      if (!context.publishedSha) {
        const branchSha = this.tryGitFn(this.baseRepo, ['rev-parse', branchRef]).stdout.trim()
        if (branchSha !== preparedAgentSha) {
          return {
            ok: false,
            detail: 'La SHA exacte de la publication historique est indisponible.'
          }
        }
      }
      return {
        ok: true,
        decision: 'cleanup-only',
        publishedSha: context.publishedSha ?? preparedAgentSha
      }
    }

    if (!existsSync(path)) {
      return { ok: false, detail: 'La copie durable à reprendre n’existe plus.' }
    }
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) return { ok: false, detail: ownershipIssue }
    const head = this.tryGitFn(path, ['rev-parse', '--verify', 'HEAD'])
    if (
      head.code !== 0 ||
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(head.stdout.trim()) ||
      this.tryGitFn(path, ['merge-base', '--is-ancestor', sourceSha, head.stdout.trim()]).code !== 0
    ) {
      /*
       * DEFINITIF, et c'est le seul cas qu'on marque ainsi. Verifie a la main le 2026-08-24 sur
       * `agent__command-edit-04789dcc-...` : `git merge-base --is-ancestor <baseSha> <HEAD>` echoue
       * REELLEMENT -- la garde a raison, ce n'est pas un faux positif. Aucun reessai ne rendra la
       * copie descendante de sa base ; le travail, lui, reste joignable sur sa branche de secours.
       *
       * On reste CONSERVATEUR : les autres refus (propriete, copie absente, commit prepare qui a
       * bouge) ne sont PAS marques, parce qu'ils peuvent se reparer. Marquer trop large libererait
       * une copie encore publiable.
       */
      return {
        ok: false,
        detail: 'La copie ne descend pas du SHA de départ autorisé.',
        definitif: true
      }
    }
    if (preparedAgentSha && head.stdout.trim() !== preparedAgentSha) {
      return { ok: false, detail: 'La copie ne porte plus exactement le commit préparé.' }
    }
    if (preparedAgentSha) {
      const status = this.tryGitFn(path, ['status', '--porcelain=v1', '-z'])
      if (status.code !== 0 || status.stdout.trim()) {
        return { ok: false, detail: 'La copie préparée a changé avant la reprise.' }
      }
    }
    return { ok: true, decision: 'resume-publication' }
  }

  /**
   * PRÉ-VOL : fichiers non committés de la BASE, en LECTURE SEULE.
   *
   * `blockingDirtyFiles` répond à la même question mais à la FINALISATION, filtrée par les fichiers
   * que l'agent a touchés — impossible avant le run, où ces fichiers ne sont pas encore connus. Ce
   * pré-vol donne donc l'état brut de la base ; c'est l'appelant qui décide d'en faire un refus.
   *
   * Aucune écriture : un seul `git status`. Ni `stash`, ni `checkout`, ni ref. Une base illisible
   * rend une liste VIDE plutôt qu'une exception : un pré-vol en panne ne doit pas bloquer un run
   * qui, sans lui, serait parti (le refus de fin de course reste le filet).
   */
  baseDirtyFiles(): string[] {
    const status = this.tryGitFn(this.baseRepo, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ])
    if (status.code !== 0) return []
    return parsePorcelainPaths(status.stdout)
  }

  changedFiles(agentId: string): string[] {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return []
    /*
     * UN HEAD ILLISIBLE NE VEUT PAS DIRE « TOUT A CHANGE ».
     *
     * MESURE le 2026-08-25 : cinq bureaux dont la branche avait disparu se sont retrouves porteurs de
     * 1564 a 1572 fichiers « modifies » — le depot entier. `git status --untracked-files=all` sans
     * HEAD resoluble n'a aucune base de comparaison, donc il rend TOUT en nouveau. Ce lot fantome
     * repassait ensuite le bureau en attente de publication, et le repechage automatique le
     * reprenait trois fois.
     *
     * Rendre une liste VIDE est le seul verdict honnete : ce bureau n'a rien de publiable qu'on
     * puisse nommer. L'etat anormal, lui, n'est pas tu — `reconcileResidues` le NOMME.
     */
    if (this.refManquanteDeHead(path)) return []
    return [...new Set([...this.workingTreeFiles(path), ...this.preservedIgnoredFiles(path)])]
  }

  /** Lit le diff figé d'un conflit sans accepter de cwd ou de révision venant du renderer. */
  readConflictDiff(
    agentId: string,
    snapshot: { files: string[]; baseSha: string; agentSha: string }
  ): WorktreeConflictDiffResult {
    if (!SAFE_ID.test(agentId)) return { available: false, reason: 'invalid-agent' }
    const path = this.pathFor(agentId)
    if (!existsSync(path) || this.ownershipIssue(path)) {
      return { available: false, reason: 'ownership-unproven' }
    }
    const files = [...new Set(snapshot.files)]
    const validFiles =
      files.length > 0 &&
      files.every((file) => {
        if (!file || file.includes('\0') || isAbsolute(file) || file.split(/[\\/]/).includes('..'))
          return false
        const rel = relative(resolve(this.baseRepo), resolve(this.baseRepo, file))
        return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
      })
    if (!validFiles) return { available: false, reason: 'invalid-path' }
    for (const sha of [snapshot.baseSha, snapshot.agentSha]) {
      if (
        !/^[0-9a-f]{7,64}$/i.test(sha) ||
        this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${sha}^{commit}`]).code !== 0
      ) {
        return { available: false, reason: 'revision-unavailable' }
      }
    }
    const result = this.tryGitFn(this.baseRepo, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      snapshot.baseSha,
      snapshot.agentSha,
      '--',
      ...files
    ])
    if (result.code !== 0) return { available: false, reason: 'read-failed' }
    return { available: true, agentId, paths: files, diff: result.stdout }
  }

  /**
   * Full-auto : committe le travail de l'agent dans sa copie puis le fusionne dans le repo de base.
   * - Rien à fusionner → { outcome: 'nothing' }.
   * - Merge propre → { outcome: 'merged' } + copie supprimée.
   * - Conflit réel → { outcome: 'conflict', files } : merge AVORTÉ, copie CONSERVÉE.
   * - Base sale/refus Git → { outcome: 'blocked', files } : aucun faux conflit, copie CONSERVÉE.
   */
  /**
   * Enveloppe de `finalize` : TOUT refus repart avec une adresse, quand il y a quelque chose à sauver.
   *
   * Un juge externe a relevé le 2026-08-18 que la sécurisation n'était posée qu'au garde précoce
   * `operationInProgress`. Les refus DÉFINITIFS — `merge-failed` (quatre chemins) et `conflict` —
   * repartaient donc sans adresse, alors que ce sont les seuls que nulle reprise ne rattrape
   * (`merge-failed` est exclu des issues réessayables). On outillait le refus temporaire et on
   * laissait nu le refus définitif : l'inverse de ce qu'il faut.
   *
   * Un point de passage UNIQUE plutôt que cinq retours patchés : le geste est idempotent (il ne
   * réécrit pas une adresse déjà posée) et sans effet sur la base.
   */
  finalize(
    agentId: string,
    options: {
      baseBranch?: string
      expectedAgentSha?: string
      /**
       * Résolution humaine d'un conflit : `ours` garde le workspace sur les zones en conflit,
       * `theirs` garde la version de l'agent. Absent = merge strict (comportement automatique).
       */
      conflictStrategy?: 'ours' | 'theirs'
      onPrepared?: (agentSha: string, baseSha: string) => void
      onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
    } = {}
  ): FinalizeResult {
    const issue = this.finalizeSansSecours(agentId, options)
    if (issue.outcome !== 'blocked' && issue.outcome !== 'conflict') return issue
    if ('rescueRef' in issue && issue.rescueRef) return issue
    // JAMAIS sur `base-dirty` : ce refus protège du travail NON COMMITTÉ de l'utilisateur sur les
    // mêmes fichiers. Y committer la copie contredirait la garde qu'on vient d'honorer, et la DoD de
    // ce chantier exige explicitement qu'aucun ref ne soit écrit dans ce cas.
    if (issue.outcome === 'blocked' && issue.reason === 'base-dirty') return issue
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return issue
    return this.secureWorkBeforeRefusal(agentId, path)
      ? { ...issue, rescueRef: this.rescueRef(agentId) }
      : issue
  }

  private finalizeSansSecours(
    agentId: string,
    options: {
      baseBranch?: string
      expectedAgentSha?: string
      conflictStrategy?: 'ours' | 'theirs'
      onPrepared?: (agentSha: string, baseSha: string) => void
      onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
    } = {}
  ): FinalizeResult {
    const expectedBaseBranch = options.baseBranch ?? this.currentBaseBranch()
    const path = this.pathFor(agentId)
    if (!existsSync(path)) {
      const branch = `autowin/recovery/${agentId}`
      const ref = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', branch])
      if (ref.code !== 0) return { outcome: 'nothing', agentId }
      const restore = this.tryGitFn(this.baseRepo, ['worktree', 'add', path, branch])
      if (restore.code !== 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: [],
          reason: 'merge-failed',
          detail: 'La référence de récupération existe mais sa copie n’a pas pu être restaurée.'
        }
      }
    }

    // AVANT toute écriture : si la copie n'appartient pas à cette base, on sort sans `add` ni
    // `commit`. Déclencheur réel : au démarrage, `finalize` passe sur une copie laissée par un
    // autre workspace, où un développeur a du travail non commité — le commit `agent <id>` le
    // happait sur un HEAD détaché d'un dépôt tiers avant que la garde d'après ne dise « étrangère ».
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) {
      return {
        outcome: 'blocked',
        agentId,
        files: [],
        reason: 'merge-failed',
        detail: ownershipIssue
      }
    }

    const resumedCompensation = this.resumePendingCompensation(agentId, expectedBaseBranch)
    if (resumedCompensation) return resumedCompensation

    if (options.expectedAgentSha) {
      if (this.isPublished(options.expectedAgentSha, expectedBaseBranch)) {
        return this.cleanupPublished(agentId, options.expectedAgentSha, expectedBaseBranch)
      }
      const currentSha = this.git(path, ['rev-parse', 'HEAD'])
      const currentStatus = this.git(path, ['status', '--porcelain=v1', '-z'])
      if (currentSha !== options.expectedAgentSha || currentStatus.length > 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: this.changedFiles(agentId),
          reason: 'merge-failed',
          detail: 'La copie a changé après la préparation de sa publication.'
        }
      }
    }

    const existingOperationFiles = this.operationInProgress()
    if (existingOperationFiles) {
      // On refuse toujours de publier — mais plus les mains vides. Ce refus arrivait AVANT que le
      // travail de la copie soit committé : il restait donc en fichiers libres, et le rapport
      // annonçait « rien n'est publié » sans que rien ne soit atteignable autrement qu'en fouillant
      // un dossier de worktree. Mesuré le 2026-08-18 : 216 refus `base-in-progress` contre 86
      // `base-dirty`, parce que l'utilisateur travaille en continu dans la base — ce refus est la
      // norme, pas l'exception, et il ne doit pas laisser le travail sans adresse.
      //
      // Le ref de SECOURS est délibérément DISTINCT de `refs/autowin/publications/<id>` : ce dernier
      // est le candidat d'une transaction de publication dont la reprise exige `baseSha` ET `sha`
      // pour ancêtres, et y écrire tôt transformerait un réessai réparable en `merge-failed` dur dès
      // que la base avance. Séparer les deux rôles laisse la transaction et sa compensation
      // INTACTES : rien du chemin de publication n'est touché ici.
      return {
        outcome: 'blocked',
        agentId,
        files: existingOperationFiles,
        reason: 'base-in-progress',
        ...(this.secureWorkBeforeRefusal(agentId, path)
          ? { rescueRef: this.rescueRef(agentId) }
          : {})
      }
    }

    const ignoredFiles = this.preservedIgnoredFiles(path)
    if (ignoredFiles.length > 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: ignoredFiles,
        // PAS `merge-failed` : aucune fusion n'est tentée ici. Mesuré le 2026-08-21 (conv-1362) :
        // le libellé de fusion a envoyé le diagnostic chercher un conflit git inexistant.
        reason: 'ignored-deliverables',
        detail: 'La copie contient des fichiers ignorés non régénérables.'
      }
    }

    const dirty = this.git(path, ['status', '--porcelain=v1', '-z']).length > 0
    let committed = false
    if (dirty) {
      this.git(path, ['add', '-A'])
      this.git(path, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `agent ${agentId}`])
      committed = true
    }
    const sha = this.git(path, ['rev-parse', 'HEAD'])
    const baseSha = this.git(this.baseRepo, ['rev-parse', 'HEAD'])
    options.onPrepared?.(sha, baseSha)
    if (sha === baseSha) {
      const lateCommit = this.headAdvance(path, sha)
      if (lateCommit.advanced) {
        return {
          outcome: 'blocked',
          agentId,
          files: lateCommit.files,
          reason: 'merge-failed',
          detail: 'La copie a reçu un nouveau commit avant son nettoyage.'
        }
      }
      const unpublishedFiles = this.unpublishedFiles(path)
      if (unpublishedFiles.length > 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: unpublishedFiles,
          reason: 'merge-failed',
          detail: 'La copie a reçu de nouveaux fichiers avant son nettoyage.'
        }
      }
      // La copie n'a rien apporté au-delà de la base → rien à fusionner ; on range.
      const agentCleanup = this.cleanupAgentWorktree(agentId, path, sha)
      if (agentCleanup.advanced) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentCleanup.files,
          reason: 'merge-failed',
          detail: 'La copie a reçu un nouveau commit pendant son nettoyage.'
        }
      }
      if (!agentCleanup.ok) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentCleanup.files,
          reason: 'merge-failed',
          detail: 'La copie agent sans changement n’a pas pu être nettoyée.'
        }
      }
      return { outcome: 'nothing', agentId }
    }

    // Une copie dont le commit est INCONNU de cette base ne peut pas y être fusionnée : copie
    // laissée par un autre dépôt (le dossier de copies est partagé entre workspaces), ou objets
    // élagués. Sans cette garde, `git diff a...b` échouait en « Invalid symmetric difference
    // expression » — bruyant au démarrage, mais surtout la liste de fichiers repartait VIDE, donc
    // plus rien ne bloquait et la fusion s'enchaînait sur une copie étrangère.
    const unknown = [baseSha, sha].find((rev) => !this.revisionExists(rev))
    if (unknown) {
      return {
        outcome: 'blocked',
        agentId,
        files: [],
        reason: 'merge-failed',
        detail: `Le commit ${unknown.slice(0, 8)} n’existe pas dans ce dépôt : copie étrangère ou objets élagués.`
      }
    }

    const agentFiles = parseNullSeparatedPaths(
      this.git(this.baseRepo, ['diff', '--name-only', '-z', `${baseSha}...${sha}`])
    )
    const blockingDirtyFiles = this.blockingDirtyFiles(agentFiles)
    if (blockingDirtyFiles.length > 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: blockingDirtyFiles,
        reason: 'base-dirty'
      }
    }

    // Le merge potentiellement conflictuel s'exécute dans une copie éphémère appartenant à Autowin.
    // Le workspace utilisateur n'est publié que par fast-forward : il n'y a donc jamais de
    // MERGE_HEAD Autowin à attribuer puis à annuler dans la base.
    const integrationPath = join(this.worktreeRoot, `integration__${agentId}__${randomUUID()}`)
    const integrationAdd = this.tryGitFn(this.baseRepo, [
      'worktree',
      'add',
      '--detach',
      integrationPath,
      baseSha
    ])
    if (integrationAdd.code !== 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: agentFiles,
        reason: 'merge-failed',
        detail: (integrationAdd.stderr || integrationAdd.stdout).trim() || undefined
      }
    }
    let integrationResult: FinalizeResult
    try {
      integrationResult = (() => {
        const merge = this.tryGitFn(integrationPath, [
          '-c',
          'commit.gpgsign=false',
          'merge',
          '--no-edit',
          ...(options.conflictStrategy ? ['-X', options.conflictStrategy] : []),
          sha
        ])
        if (merge.code !== 0) {
          const operationFiles = this.operationInProgress(integrationPath)
          const files = operationFiles ?? []
          if (operationFiles) {
            const abort = this.tryGitFn(integrationPath, ['merge', '--abort'])
            if (abort.code !== 0) {
              const mergeDetail = (merge.stderr || merge.stdout).trim()
              const abortDetail = (abort.stderr || abort.stdout).trim()
              return {
                outcome: 'blocked',
                agentId,
                files: files.length > 0 ? files : agentFiles,
                reason: 'merge-failed',
                detail: [mergeDetail, `git merge --abort: ${abortDetail || 'échec inconnu'}`]
                  .filter(Boolean)
                  .join('\n')
              }
            }
          }
          if (files.length > 0) {
            // La copie agent reste intacte pour une résolution assistée ultérieure.
            return { outcome: 'conflict', agentId, files, baseSha, agentSha: sha }
          }
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'merge-failed',
            detail: (merge.stderr || merge.stdout).trim() || undefined
          }
        }

        const integratedSha = this.git(integrationPath, ['rev-parse', 'HEAD'])
        const operationBeforePublish = this.operationInProgress()
        if (operationBeforePublish) {
          return {
            outcome: 'blocked',
            agentId,
            files: operationBeforePublish,
            reason: 'base-in-progress'
          }
        }
        const dirtyBeforePublish = this.blockingDirtyFiles(agentFiles)
        if (dirtyBeforePublish.length > 0) {
          return {
            outcome: 'blocked',
            agentId,
            files: dirtyBeforePublish,
            reason: 'base-dirty'
          }
        }
        if (this.git(this.baseRepo, ['rev-parse', 'HEAD']) !== baseSha) {
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'base-in-progress',
            detail: 'La base a avancé pendant la préparation de l’intégration.'
          }
        }

        if (!this.isExpectedBaseBranch(expectedBaseBranch)) {
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'base-in-progress',
            detail: 'La branche courante a changé pendant la préparation de l’intégration.'
          }
        }

        const expectedIndexTree = this.git(this.baseRepo, ['write-tree'])
        const publicationRef = this.publicationMarkerRef(agentId)
        const existingPublication = this.tryGitFn(this.baseRepo, [
          'rev-parse',
          '--verify',
          publicationRef
        ])
        let publicationSha = integratedSha
        let createPublicationMarker = false
        if (existingPublication.code === 0) {
          const candidate = existingPublication.stdout.trim()
          const validCandidate =
            this.revisionExists(candidate) &&
            this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', baseSha, candidate])
              .code === 0 &&
            this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', sha, candidate]).code === 0
          if (!validCandidate) {
            return {
              outcome: 'blocked',
              agentId,
              files: agentFiles,
              reason: 'merge-failed',
              detail: 'La transaction de publication durable ne correspond plus à ce run.'
            }
          }
          publicationSha = candidate
        } else {
          createPublicationMarker = true
        }

        const publishHooksPath = this.preparePublishHooks(
          agentId,
          integrationPath,
          baseSha,
          publicationSha,
          expectedBaseBranch,
          publicationRef,
          agentFiles,
          expectedIndexTree
        )
        if (createPublicationMarker) {
          const marker = this.tryGitFn(this.baseRepo, [
            '-c',
            `core.hooksPath=${shellPath(publishHooksPath)}`,
            'update-ref',
            publicationRef,
            integratedSha
          ])
          if (marker.code !== 0) {
            const markerDetail = (marker.stderr || marker.stdout).trim()
            const guarded = markerDetail.includes('AUTOWIN_GUARD:')
            return {
              outcome: 'blocked',
              agentId,
              files: guarded ? this.workingTreeFiles(this.baseRepo) : agentFiles,
              reason: guarded ? 'base-in-progress' : 'merge-failed',
              detail:
                markerDetail || 'La transaction de publication n’a pas pu être rendue durable.'
            }
          }
        }
        options.onIntegrated?.(publicationSha, sha, baseSha)
        const publish = this.tryGitFn(this.baseRepo, [
          '-c',
          `core.hooksPath=${shellPath(publishHooksPath)}`,
          'merge',
          '--ff-only',
          publicationSha
        ])
        if (publish.code === 0 && existsSync(join(publishHooksPath, 'post-hook-change'))) {
          const hookRejected = existsSync(join(publishHooksPath, 'post-hook-rejected'))
          const compensation = this.compensatePostHookChange(
            agentId,
            publishHooksPath,
            agentFiles,
            baseSha,
            publicationSha,
            expectedBaseBranch
          )
          if (!compensation.ok) {
            return {
              outcome: 'blocked',
              agentId,
              files: compensation.files,
              reason: 'merge-failed',
              preserveAgentFiles: true,
              detail:
                compensation.detail ??
                'La publication compensée n’a pas pu être libérée sans course.'
            }
          }
          return {
            outcome: 'blocked',
            agentId,
            files: compensation.files,
            reason: hookRejected ? 'merge-failed' : 'base-in-progress',
            preserveAgentFiles: true,
            detail: hookRejected
              ? 'Le hook reference-transaction utilisateur a refusé la publication.'
              : 'L’index utilisateur a changé dans un hook pendant la publication.'
          }
        }
        if (publish.code === 0) {
          return { outcome: 'merged', agentId, committed, baseSha, publishedSha: publicationSha }
        }
        const publishDetail = (publish.stderr || publish.stdout).trim()
        if (existsSync(join(publishHooksPath, 'post-hook-change'))) {
          const hookRejected = existsSync(join(publishHooksPath, 'post-hook-rejected'))
          const compensation = this.compensatePostHookChange(
            agentId,
            publishHooksPath,
            agentFiles,
            baseSha,
            publicationSha,
            expectedBaseBranch,
            false
          )
          if (!compensation.ok) {
            return {
              outcome: 'blocked',
              agentId,
              files: compensation.files,
              reason: 'merge-failed',
              preserveAgentFiles: true,
              detail:
                compensation.detail ??
                'Le refus du hook n’a pas pu être compensé et libéré sans course.'
            }
          }
          return {
            outcome: 'blocked',
            agentId,
            files: compensation.files,
            reason: hookRejected ? 'merge-failed' : 'base-in-progress',
            preserveAgentFiles: true,
            detail: hookRejected
              ? 'Le hook reference-transaction utilisateur a refusé la publication.'
              : 'Le hook utilisateur a modifié le workspace ; la publication a été refusée.'
          }
        }
        if (!this.acknowledgePublication(agentId, publicationSha)) {
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'merge-failed',
            detail: 'La transaction refusée n’a pas pu être libérée sans course.'
          }
        }
        if (publishDetail.includes('AUTOWIN_GUARD:index-changed')) {
          return {
            outcome: 'blocked',
            agentId,
            files: this.workingTreeFiles(this.baseRepo),
            reason: 'base-in-progress',
            detail: 'L’index utilisateur a changé pendant la publication.'
          }
        }

        const operationAfterPublish = this.operationInProgress()
        if (operationAfterPublish) {
          return {
            outcome: 'blocked',
            agentId,
            files: operationAfterPublish,
            reason: 'base-in-progress'
          }
        }
        if (this.git(this.baseRepo, ['rev-parse', 'HEAD']) !== baseSha) {
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'base-in-progress',
            detail: 'La base a avancé pendant la publication de l’intégration.'
          }
        }

        if (!this.isExpectedBaseBranch(expectedBaseBranch)) {
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'base-in-progress',
            detail: 'La branche courante a changé pendant la publication de l’intégration.'
          }
        }

        const currentDirtyFiles = this.blockingDirtyFiles(agentFiles)
        if (currentDirtyFiles.length > 0) {
          return {
            outcome: 'blocked',
            agentId,
            files: currentDirtyFiles,
            reason: 'base-dirty'
          }
        }
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'merge-failed',
          detail: publishDetail || undefined
        }
      })()
    } catch {
      integrationResult = {
        outcome: 'blocked',
        agentId,
        files: agentFiles,
        reason: 'merge-failed',
        detail: 'La finalisation Git a échoué de façon inattendue.'
      }
    }

    const publishHooksPath = join(integrationPath, '.autowin-publish-hooks')
    if (
      existsSync(join(publishHooksPath, 'post-hook-change')) &&
      !existsSync(join(publishHooksPath, 'compensation-complete'))
    ) {
      const durablePlan = this.readCompensationPlan(agentId)
      if (
        !durablePlan ||
        durablePlan === 'invalid' ||
        !this.compensationPlanRefsMatch(durablePlan)
      ) {
        return {
          outcome: 'blocked',
          agentId,
          files: integrationResult.outcome === 'merged' ? agentFiles : integrationResult.files,
          reason: 'merge-failed',
          preserveAgentFiles: true,
          detail:
            (integrationResult.outcome === 'blocked' ? integrationResult.detail : undefined) ??
            'La copie d’intégration conserve les snapshots non encore promus de la compensation.'
        }
      }
    }
    const integrationCleanup = this.cleanupWorktree(integrationPath)
    if (!integrationCleanup.ok) {
      if (integrationResult.outcome !== 'merged') {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'merge-failed',
          detail: 'La copie d’intégration en échec n’a pas pu être nettoyée.'
        }
      }
      return {
        outcome: 'cleanup-pending',
        agentId,
        files: agentFiles,
        baseSha: integrationResult.baseSha,
        publishedSha: integrationResult.publishedSha ?? sha,
        agentSha: sha,
        detail: 'La copie d’intégration n’a pas pu être nettoyée.'
      }
    }

    if (integrationResult.outcome === 'merged') {
      const lateCommit = this.headAdvance(path, sha)
      if (lateCommit.advanced) {
        return {
          outcome: 'published-residue',
          agentId,
          files: lateCommit.files,
          baseSha: integrationResult.baseSha,
          publishedSha: integrationResult.publishedSha ?? sha,
          agentSha: sha,
          detail: 'La copie a reçu un nouveau commit pendant sa publication.'
        }
      }
      const unpublishedFiles = this.unpublishedFiles(path)
      if (unpublishedFiles.length > 0) {
        return {
          outcome: 'published-residue',
          agentId,
          files: unpublishedFiles,
          baseSha: integrationResult.baseSha,
          publishedSha: integrationResult.publishedSha ?? sha,
          agentSha: sha,
          detail: 'La copie a reçu de nouveaux fichiers pendant sa publication.'
        }
      }
      const agentCleanup = this.cleanupAgentWorktree(agentId, path, sha)
      if (agentCleanup.advanced) {
        return {
          outcome: 'published-residue',
          agentId,
          files: agentCleanup.files,
          baseSha: integrationResult.baseSha,
          publishedSha: integrationResult.publishedSha ?? sha,
          agentSha: sha,
          detail: 'La copie a reçu un nouveau commit pendant son nettoyage.'
        }
      }
      if (!agentCleanup.ok) {
        if (agentCleanup.files.length > 0) {
          return {
            outcome: 'published-residue',
            agentId,
            files: agentCleanup.files,
            baseSha: integrationResult.baseSha,
            publishedSha: integrationResult.publishedSha ?? sha,
            agentSha: sha,
            detail: 'La copie a reçu de nouveaux fichiers pendant son rangement.'
          }
        }
        return {
          outcome: 'cleanup-pending',
          agentId,
          files: agentFiles,
          baseSha: integrationResult.baseSha,
          publishedSha: integrationResult.publishedSha ?? sha,
          agentSha: sha,
          detail: 'La base est publiée, mais la copie agent n’a pas pu être nettoyée.'
        }
      }
    }
    return integrationResult
  }

  private isPublished(expectedSha: string, baseBranch?: string): boolean {
    const target = baseBranch ? `refs/heads/${baseBranch}` : 'HEAD'
    return (
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', expectedSha, target]).code === 0
    )
  }

  private publicationMarkerRef(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    return `refs/autowin/publications/${agentId}`
  }

  /**
   * Référence de SECOURS : elle donne une adresse durable au travail d'un run dont la publication a
   * été refusée. Distincte de `publicationMarkerRef` À DESSEIN — celle-là est le candidat d'une
   * transaction dont la reprise valide l'ascendance ; celle-ci ne promet rien d'autre que « le
   * travail est là, atteignable, non publié ».
   *
   * Nommée en ANGLAIS comme tous les espaces de noms de refs de ce fichier (`publications`,
   * `compensations`, `locks`, `recovery`). Elle s'appelait `secours` : un juge externe a relevé le
   * 2026-08-18 que c'était le seul namespace français du dépôt, invisible à un `grep` anglais.
   */
  private rescueRef(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    return `refs/autowin/rescue/${agentId}`
  }

  /**
   * Committe la copie si elle porte des changements non committés. Rend la SHA de sa tête.
   *
   * Le MÊME message que le commit de publication (`agent <id>`) est employé À DESSEIN : ce n'est pas
   * un commit de secours parallèle, c'est celui que la reprise publiera. Un libellé décoratif
   * polluait l'historique publié, et un test l'a attrapé en épinglant le message exact
   * (`worktree-recovery.integration`) — la bonne réaction était d'aligner le message, pas de
   * desserrer son assertion. Factorisé parce que `finalize` et `secureWorkBeforeRefusal` faisaient
   * la même séquence à l'identique (relevé par un juge externe).
   */
  private commitCopyIfDirty(agentId: string, path: string): { sha: string; committed: boolean } {
    const dirty = this.git(path, ['status', '--porcelain=v1', '-z']).length > 0
    if (dirty) {
      this.git(path, ['add', '-A'])
      this.git(path, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `agent ${agentId}`])
    }
    return { sha: this.git(path, ['rev-parse', 'HEAD']), committed: dirty }
  }

  /**
   * Committe le travail de la copie et lui donne une adresse durable, AVANT un refus de publication.
   *
   * Sans ça, un refus laissait le travail en fichiers libres dans un dossier de worktree : rien ne
   * le désignait, et le rapport disait « rien n'est publié » sans dire où regarder. Le geste est
   * volontairement minimal et sans effet sur la base : un commit dans la COPIE, puis un `update-ref`
   * d'une référence privée. Aucun hook de publication, aucune validation de l'arbre de
   * l'utilisateur — écrire ce ref ne touche ni sa branche, ni son index, ni ses fichiers.
   *
   * **FAIL-CLOSED sur l'ambiguïté.** Rend `true` uniquement sur preuve POSITIVE que la copie a
   * produit quelque chose. La version précédente déduisait « rien à sauver » de
   * `git rev-parse HEAD@{1}` : quand le reflog est absent (`core.logAllRefUpdates=false`, une
   * configuration git réelle et hors du contrôle de l'app), cette commande sort en 128, la garde ne
   * se déclenchait pas, et un ref était posé sur un commit STRICTEMENT INCHANGÉ en rendant `true` —
   * l'utilisateur lisait « travail atteignable » pour un travail inexistant. Un juge externe l'a
   * reproduit en isolation le 2026-08-18, sur du code déjà poussé, alors que le commentaire de cette
   * fonction affirmait exactement l'inverse. `rev-list --not --branches --remotes` répond à la vraie
   * question — « cette copie porte-t-elle des commits qu'aucune branche ne connaît ? » — sans
   * dépendre d'un reflog, et toute réponse illisible vaut refus.
   */
  private secureWorkBeforeRefusal(agentId: string, path: string): boolean {
    try {
      // Ordre choisi pour le COÛT : les lectures d'abord, et on sort au plus tôt. Ce chemin s'exécute
      // à CHAQUE refus, et un refus est la norme sur un dépôt partagé — deux tests de compensation,
      // déjà proches de leur budget, ont dépassé le délai sous charge quand la vérification
      // d'appartenance (3 appels git) était faite avant même de savoir s'il y avait quelque chose à
      // sauver. Le cas fréquent « rien à sauver » ne coûte donc plus qu'une lecture.
      const dirty = this.git(path, ['status', '--porcelain=v1', '-z']).length > 0
      if (!dirty) {
        // Répond à la vraie question — « cette copie porte-t-elle des commits qu'aucune branche ne
        // connaît ? » — sans dépendre d'un reflog. Toute réponse illisible vaut REFUS (fail-closed).
        const ahead = this.tryGitFn(path, [
          'rev-list',
          '--count',
          'HEAD',
          '--not',
          '--branches',
          '--remotes'
        ])
        if (ahead.code !== 0) return false
        if (Number.parseInt(ahead.stdout.trim() || '0', 10) === 0) return false
      }
      // JAMAIS d'écriture sans appartenance PROUVÉE, et ce contrôle vient AVANT le commit : trois
      // tests l'ont attrapé quand la sécurisation était trop large — une copie d'un autre dépôt, et
      // une copie dont l'appartenance Git est indémontrable, ne doivent recevoir AUCUNE écriture, pas
      // même un commit « pour les sauver ». Sécuriser est un service ; il ne justifie pas d'écrire là
      // où le reste du module s'interdit de toucher.
      if (this.ownershipIssue(path)) return false
      const { sha } = this.commitCopyIfDirty(agentId, path)
      return this.tryGitFn(this.baseRepo, ['update-ref', this.rescueRef(agentId), sha]).code === 0
    } catch {
      // Sécuriser est un BONUS : son échec ne doit jamais transformer un refus propre en exception.
      return false
    }
  }

  /** Supprime l'ancre transactionnelle seulement après persistance durable de la SHA publiée. */
  acknowledgePublication(agentId: string, publishedSha: string): boolean {
    const ref = this.publicationMarkerRef(agentId)
    const before = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    if (before.code !== 0) return true
    if (before.stdout.trim() !== publishedSha) return false
    const deletion = this.tryGitFn(this.baseRepo, ['update-ref', '-d', ref, publishedSha])
    const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    return deletion.code === 0 && current.code !== 0
  }

  /**
   * Reprend uniquement le rangement d'une copie dont la SHA est déjà dans la base.
   * Aucun commit ni merge n'est exécuté ici : une écriture tardive conserve le bureau.
   */
  cleanupPublished(
    agentId: string,
    publishedSha: string,
    baseBranch?: string,
    agentSha = publishedSha
  ): FinalizeResult {
    assertSafeId(agentId, 'agentId')
    if (!this.isPublished(publishedSha, baseBranch)) {
      return {
        outcome: 'blocked',
        agentId,
        files: [],
        reason: 'merge-failed',
        detail: 'La publication annoncée n’est pas présente dans la base.'
      }
    }

    if (existsSync(this.worktreeRoot)) {
      for (const entry of readdirSync(this.worktreeRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(`integration__${agentId}__`)) continue
        const cleanup = this.cleanupWorktree(join(this.worktreeRoot, entry.name))
        if (!cleanup.ok) {
          return {
            outcome: 'cleanup-pending',
            agentId,
            files: [],
            publishedSha,
            agentSha,
            detail: 'Le retour est publié ; le rangement de la copie technique sera réessayé.'
          }
        }
      }
    }

    const path = this.pathFor(agentId)
    if (!existsSync(path)) {
      const recoveryBranch = `autowin/recovery/${agentId}`
      const recoveryRef = this.tryGitFn(this.baseRepo, [
        'rev-parse',
        '--verify',
        `refs/heads/${recoveryBranch}`
      ])
      if (recoveryRef.code !== 0) return { outcome: 'merged', agentId, committed: false }
      const recoverySha = recoveryRef.stdout.trim()
      if (recoverySha !== agentSha) {
        const files = parseNullSeparatedPaths(
          this.tryGitFn(this.baseRepo, ['diff', '--name-only', '-z', `${agentSha}..${recoverySha}`])
            .stdout
        )
        return this.recoveredPublishedResidue(
          agentId,
          recoveryBranch,
          publishedSha,
          agentSha,
          files
        )
      }
      const deleteRef = this.deleteRecoveryRefIfExpected(recoveryBranch, agentSha)
      if (deleteRef.advanced) {
        return this.recoveredPublishedResidue(
          agentId,
          recoveryBranch,
          publishedSha,
          agentSha,
          deleteRef.files
        )
      }
      return deleteRef.deleted
        ? { outcome: 'merged', agentId, committed: false }
        : {
            outcome: 'cleanup-pending',
            agentId,
            files: [],
            publishedSha,
            agentSha,
            detail: 'Le retour est publié ; sa référence de récupération sera rangée plus tard.'
          }
    }
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) {
      return {
        outcome: 'cleanup-pending',
        agentId,
        files: [],
        publishedSha,
        agentSha,
        detail: ownershipIssue
      }
    }
    const lateCommit = this.headAdvance(path, agentSha)
    const unpublishedFiles = this.unpublishedFiles(path)
    if (lateCommit.advanced || unpublishedFiles.length > 0) {
      return {
        outcome: 'published-residue',
        agentId,
        files: [...new Set([...lateCommit.files, ...unpublishedFiles])],
        publishedSha,
        agentSha,
        detail: 'La copie a reçu du nouveau travail après sa publication et reste conservée.'
      }
    }
    const agentCleanup = this.cleanupAgentWorktree(agentId, path, agentSha)
    if (agentCleanup.advanced) {
      return {
        outcome: 'published-residue',
        agentId,
        files: agentCleanup.files,
        publishedSha,
        agentSha,
        detail: 'La copie a reçu un nouveau commit pendant son rangement.'
      }
    }
    if (!agentCleanup.ok) {
      if (agentCleanup.files.length > 0) {
        return {
          outcome: 'published-residue',
          agentId,
          files: agentCleanup.files,
          publishedSha,
          agentSha,
          detail: 'La copie a reçu de nouveaux fichiers pendant son rangement.'
        }
      }
      return {
        outcome: 'cleanup-pending',
        agentId,
        files: agentCleanup.files,
        publishedSha,
        agentSha,
        detail: 'Le retour est publié ; le rangement du bureau sera réessayé.'
      }
    }
    return { outcome: 'merged', agentId, committed: false }
  }

  /** Supprime la copie de l'agent (idempotent). */
  remove(agentId: string): void {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return
    if (this.hasActiveProcesses(agentId)) {
      throw new Error(`La copie ${agentId} est encore utilisée par un CLI actif.`)
    }
    const expectedSha = this.git(path, ['rev-parse', 'HEAD'])
    const result = this.cleanupAgentWorktree(agentId, path, expectedSha)
    if (!result.ok) {
      throw new Error(`La copie ${agentId} contient encore du travail et a été conservée.`)
    }
  }

  /**
   * ANCRE le commit d'un bureau sur sa branche de secours, s'il apporte quelque chose.
   *
   * Le dossier d'un bureau en HEAD DETACHE est la SEULE chose qui rend son commit joignable : Git
   * compte le HEAD d'un worktree parmi ses racines, mais aucun `for-each-ref` ne le voit. Supprimer
   * le dossier sans avoir pose de ref, c'est donc rendre le commit invisible au recensement et
   * candidat au `gc` -- meme geste, meme perte, quelle que soit la porte de sortie emprunte.
   *
   * Idempotent, et volontairement SILENCIEUX en cas d'echec : poser une adresse est un filet, pas une
   * condition. Un bureau qui n'apporte rien par rapport a la base n'en recoit pas -- on ne garde pas
   * d'adresse pour du vide.
   */
  private ancrerAvantSuppression(agentId: string, path: string): void {
    const branche = `autowin/recovery/${agentId}`
    const tete = this.tryGitFn(path, ['rev-parse', 'HEAD'])
    if (tete.code !== 0) return
    if (!this.apporteQuelqueChose(tete.stdout.trim(), 'HEAD')) return
    this.mettreAlAbriSiDivergente(branche, tete.stdout.trim())
    this.tryGitFn(this.baseRepo, ['branch', '-f', branche, tete.stdout.trim()])
  }

  /**
   * GARE le travail qu'une adresse de secours porte DEJA, avant qu'on ecrive par-dessus.
   *
   * DEFAUT VECU le 2026-08-26, signale par un juge contrarian puis REPRODUIT par un test : l'identite
   * d'un bureau est STABLE par tache (`cleDeBureau` — c'est tout le levier anti-residus du 25/08), donc
   * deux tentatives sur la meme cible partagent le meme `agentId`, donc la meme adresse de secours. Un
   * `branch -f` y ecrivait sans regarder : le travail de la tentative 1, correctement ancre, etait
   * DESANCRE par l'ancrage de la tentative 2. La perte n'etait pas supprimee, seulement decalee d'un
   * cran — on ne perdait plus au premier balayage, on perdait au second.
   *
   * On n'ecrase que ce qui ne perd rien : une adresse absente, identique, ou dont le nouveau commit
   * DESCEND (fast-forward). Sinon l'ancien sommet part sous une adresse distincte, dans le meme espace
   * `autowin/recovery/` — donc toujours vue par le recensement, dont le filtre accepte ce nom.
   *
   * Un ancien sommet qui n'apporte plus rien par rapport a la base n'est pas gare : on ne garde pas
   * d'adresse pour du vide.
   */
  private mettreAlAbriSiDivergente(branche: string, nouveauSha: string): void {
    const existant = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `refs/heads/${branche}`])
    if (existant.code !== 0) return
    const ancien = existant.stdout.trim()
    if (!ancien || ancien === nouveauSha) return
    const descend =
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', ancien, nouveauSha]).code === 0
    if (descend) return
    if (!this.apporteQuelqueChose(ancien, 'HEAD')) return
    this.tryGitFn(this.baseRepo, ['branch', '-f', `${branche}-${ancien.slice(0, 12)}`, ancien])
  }

  /**
   * Abandon d'un bureau retenu.
   *
   * Se documentait « appele seulement apres confirmation UI » — ce n'etait plus vrai : `identiteDeBureau`
   * l'appelle pour RECYCLER un bureau a la tentative suivante, sans qu'aucun humain ne voie rien. On
   * ancre donc avant de balayer, comme les autres portes de sortie.
   */
  /**
   * Retire les coquilles vides deja accumulees dans la racine des bureaux.
   *
   * La garde de `cleanupWorktree` tarit la PRODUCTION ; celle-ci nettoie le STOCK -- les coquilles
   * laissees avant qu'elle existe, ou par un chemin qui ne passe pas par le nettoyage (une session
   * concurrente, un `git worktree remove` lance a la main). `git worktree prune` ne les voit pas :
   * elles ne sont deja plus au registre.
   *
   * Ne retire QUE ce dont l'absence de valeur est demontree : aucun fichier hors `.git`.
   */
  balayerLesCoquilles(): string[] {
    return balayerCoquillesVides(this.worktreeRoot)
  }

  discard(agentId: string): void {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return
    if (this.hasActiveProcesses(agentId)) {
      throw new Error(`La copie ${agentId} est encore utilisée par un CLI actif.`)
    }
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) throw new Error(ownershipIssue)
    this.ancrerAvantSuppression(agentId, path)
    const cleanup = this.cleanupWorktree(path, true)
    if (!cleanup.ok) {
      throw new Error(cleanup.detail ?? `La copie ${agentId} n’a pas pu être supprimée.`)
    }
  }
}
