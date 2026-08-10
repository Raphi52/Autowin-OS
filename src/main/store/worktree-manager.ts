import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
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
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { WorktreeConflictDiffResult } from '../../shared/worktree-activity-model'
import { isSameProcessIdentity } from '../process-identity'
import { parsePorcelainPaths } from '../run-autoclose'
import { WorktreeOperationClient } from './worktree-operation-client'
import type { WorktreeRecoveryInventory } from './worktree-operation-protocol'

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
const GIT_COMMAND_TIMEOUT_MS = 30_000
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
  | { outcome: 'merged'; agentId: string; committed: boolean }
  | { outcome: 'nothing'; agentId: string }
  | { outcome: 'conflict'; agentId: string; files: string[]; baseSha: string; agentSha: string }
  | {
      outcome: 'cleanup-pending'
      agentId: string
      files: string[]
      publishedSha: string
      detail?: string
      worktreeAvailable?: boolean
    }
  | {
      outcome: 'published-residue'
      agentId: string
      files: string[]
      publishedSha: string
      detail?: string
    }
  | {
      outcome: 'blocked'
      agentId: string
      files: string[]
      reason: 'base-dirty' | 'base-in-progress' | 'merge-failed'
      detail?: string
    }

export interface WorktreeRunContext {
  workspacePath: string
  worktreePath: string
  baseBranch: string
  baseSha: string
}

export interface WorktreeRecoveryContext extends Omit<WorktreeRunContext, 'workspacePath'> {
  publication: 'pending' | 'integrating' | 'published' | 'cleanup-pending'
  publishedSha?: string
}

export interface WorktreeManagerOptions {
  baseRepo: string
  worktreeRoot: string
  /** Branche de base sur laquelle fusionner (défaut : la branche courante du repo). */
  baseBranch?: string
  git?: GitRunner
  /** tryGit injectable (tests) ; défaut = wrapper execFileSync non-jetant. */
  tryGitFn?: typeof tryGit
  /** Suppression disque injectable pour simuler les verrous Windows dans les tests. */
  removeDirFn?: (path: string) => void
  /** Identité stable du processus (démarrage + exécutable), injectable pour les tests. */
  processIdentityFn?: (pid: number) => string | null | undefined
  nowFn?: () => number
  /** Désactive le client worker à l'intérieur du worker lui-même. */
  disableAsyncOperations?: boolean
  operationTimeoutMs?: number
}

const SPAWN_INTENT_MAX_AGE_MS = 2 * 60 * 1_000

/**
 * Âge minimal avant qu'une copie agent SANS aucun travail récupérable soit considérée abandonnée.
 * Marge délibérément large : un run vivant qui n'a pas encore posé son lease (fenêtre acquire →
 * markSpawnIntent) reste hors de portée du balayage.
 */
const ABANDONED_AGENT_MIN_AGE_MS = 24 * 60 * 60 * 1_000

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

export class WorktreeManager {
  private readonly baseRepo: string
  private readonly worktreeRoot: string
  private readonly git: GitRunner
  private readonly tryGitFn: typeof tryGit
  private readonly removeDirFn: (path: string) => void
  private readonly configuredBaseBranch?: string
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
    this.configuredBaseBranch = opts.baseBranch
    this.processIdentity = opts.processIdentityFn ?? defaultProcessIdentity
    this.now = opts.nowFn ?? Date.now
    const operationWorkerPath = join(__dirname, 'worktree-operation-worker.js')
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
              ...(this.configuredBaseBranch ? { baseBranch: this.configuredBaseBranch } : {})
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
      const resolvedContext = context ?? this.describe(agentId)
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
      onPrepared?: (agentSha: string, baseSha: string) => void
    } = {}
  ): Promise<FinalizeResult> {
    if (!this.operationClient) return this.finalize(agentId, options)
    const { onPrepared, ...serializable } = options
    return this.operationClient.run(
      { operation: 'finalize', agentId, options: serializable },
      onPrepared
    )
  }

  async cleanupPublishedAsync(
    agentId: string,
    expectedSha: string,
    baseBranch?: string
  ): Promise<FinalizeResult> {
    return this.operationClient
      ? this.operationClient.run({
          operation: 'cleanupPublished',
          agentId,
          expectedSha,
          baseBranch
        })
      : this.cleanupPublished(agentId, expectedSha, baseBranch)
  }

  /** Vrai uniquement quand les opérations Git sont réellement déportées hors du main Electron. */
  operationsAreIsolated(): boolean {
    return Boolean(this.operationClient)
  }

  recoveryInventory(): WorktreeRecoveryInventory {
    const residues = this.reconcileResidues()
    const agents = this.listAgentIds().map((agentId) => {
      let context: WorktreeRunContext | undefined
      try {
        context = this.describe(agentId)
      } catch {
        context = undefined
      }
      return {
        agentId,
        ...(context ? { context } : {}),
        active: this.hasActiveProcesses(agentId),
        changedFiles: this.changedFiles(agentId)
      }
    })
    return { residues, agents }
  }

  async recoveryInventoryAsync(): Promise<WorktreeRecoveryInventory> {
    return this.operationClient
      ? this.operationClient.run({ operation: 'recoveryInventory' })
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
  private gitCommonDir(repo: string): string | undefined {
    const probe = this.tryGitFn(repo, ['rev-parse', '--git-common-dir'])
    if (probe.code !== 0) return undefined
    const raw = probe.stdout.trim()
    if (!raw) return undefined
    return isAbsolute(raw) ? raw : resolve(repo, raw)
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

  private ownershipIssue(path: string): string | undefined {
    const foreign = this.foreignCopyDetail(path)
    if (foreign) return foreign
    if (!this.gitCommonDir(path) || !this.gitCommonDir(this.baseRepo)) {
      return `Impossible de prouver l’appartenance Git de la copie ${path} : aucune écriture n’y est faite.`
    }
    return undefined
  }

  /** Inventorie les copies Autowin récupérables après un arrêt du processus. */
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
   * Les copies d'intégration sont jetables (la copie agent ou la base porte toujours la donnée).
   * Une quarantaine est restaurée vers son bureau d'origine, sans jamais être publiée.
   */
  reconcileResidues(): {
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
      const cleanup = this.cleanupWorktree(path)
      if (cleanup.ok) result.cleaned += 1
      else {
        result.blocked.push({
          path,
          detail: cleanup.detail ?? 'La copie d’intégration orpheline n’a pas pu être nettoyée.'
        })
      }
    }

    const swept = this.sweepAbandonedAgentCopies()
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
  private sweepAbandonedAgentCopies(): string[] {
    const swept: string[] = []
    if (!existsSync(this.worktreeRoot)) return swept

    for (const entry of readdirSync(this.worktreeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('agent__')) continue
      const agentId = entry.name.slice('agent__'.length)
      if (!SAFE_ID.test(agentId)) continue
      const path = join(this.worktreeRoot, entry.name)
      if (this.ownershipIssue(path)) continue

      let ageMs: number
      try {
        ageMs = this.now() - statSync(path).mtimeMs
      } catch {
        continue
      }
      if (!(ageMs >= ABANDONED_AGENT_MIN_AGE_MS)) continue

      if (this.hasActiveProcesses(agentId)) continue
      if (this.unpublishedFiles(path).length > 0) continue

      const head = this.tryGitFn(path, ['rev-parse', 'HEAD'])
      if (head.code !== 0) continue
      const sha = head.stdout.trim()
      if (!/^[0-9a-f]{40,64}$/i.test(sha)) continue
      const containing = this.tryGitFn(this.baseRepo, [
        'for-each-ref',
        '--contains',
        sha,
        '--count=1',
        '--format=%(refname)'
      ])
      if (containing.code !== 0 || !containing.stdout.trim()) continue

      if (this.cleanupWorktree(path, false).ok) swept.push(agentId)
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
    const stagedFiles = parseNullSeparatedPaths(
      this.git(this.baseRepo, ['diff', '--cached', '--name-only', '-z'])
    )
    const dirtyOverlap = agentFiles.filter((file) => dirtyFiles.includes(file))
    return [...new Set([...stagedFiles, ...dirtyOverlap])]
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
    expectedSha: string,
    files: string[]
  ): FinalizeResult {
    if (!this.restoreRecoveryWorktree(agentId, branch)) {
      return {
        outcome: 'cleanup-pending',
        agentId,
        files,
        publishedSha: expectedSha,
        worktreeAvailable: false,
        detail:
          'Le retour est publié et la référence plus récente est protégée ; Autowin réessaiera de recréer son bureau.'
      }
    }
    return {
      outcome: 'published-residue',
      agentId,
      files,
      publishedSha: expectedSha,
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
    integrationPath: string,
    baseSha: string,
    integratedSha: string,
    expectedBaseBranch: string
  ): string {
    const hooksPath = join(integrationPath, '.autowin-publish-hooks')
    const inputPath = join(hooksPath, 'reference-transaction.input')
    const markerPath = join(hooksPath, 'preflight-passed')
    const activeHooksDir = this.activeHooksDir()
    const originalReferenceHook = join(activeHooksDir, 'reference-transaction')
    const originalPostMergeHook = join(activeHooksDir, 'post-merge')
    const expectedRef = `refs/heads/${expectedBaseBranch}`
    mkdirSync(hooksPath, { recursive: true })

    const chainReferenceHook = existsSync(originalReferenceHook)
      ? `${shellQuote(shellPath(originalReferenceHook))} "$@" < ${shellQuote(shellPath(inputPath))}\n` +
        'original_status=$?\n' +
        '[ "$original_status" -eq 0 ] || exit "$original_status"\n'
      : ''
    const referenceHook = `#!/bin/sh
state="$1"
cat > ${shellQuote(shellPath(inputPath))} || exit 90
if [ "$state" = "prepared" ] && [ ! -f ${shellQuote(shellPath(markerPath))} ]; then
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
  git diff --cached --quiet -- || {
    echo "AUTOWIN_GUARD:index-staged" >&2
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
  : > ${shellQuote(shellPath(markerPath))} || exit 97
fi
if [ "$state" = "prepared" ]; then
  while read -r old_sha new_sha ref_name; do
    case "$ref_name" in
      refs/heads/*)
        if [ "$ref_name" != ${shellQuote(expectedRef)} ] || [ "$old_sha" != ${shellQuote(baseSha)} ] || [ "$new_sha" != ${shellQuote(integratedSha)} ]; then
          echo "AUTOWIN_GUARD:unexpected-ref-update" >&2
          exit 96
        fi
        ;;
    esac
  done < ${shellQuote(shellPath(inputPath))}
fi
${chainReferenceHook}exit 0
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

  private cleanupWorktree(path: string, force = true): { ok: boolean; detail?: string } {
    const remove = this.tryGitFn(this.baseRepo, [
      'worktree',
      'remove',
      ...(force ? ['--force'] : []),
      path
    ])
    if (remove.code === 0) return { ok: true }
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
    if (context && !/^[0-9a-f]{40,64}$/i.test(context.baseSha)) {
      throw new Error('SHA de départ du bureau invalide.')
    }
    const startRevision = context?.baseSha ?? this.currentBaseBranch()
    if (
      context &&
      this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${startRevision}^{commit}`]).code !== 0
    ) {
      throw new Error('La révision capturée du bureau n’est plus disponible.')
    }
    mkdirSync(this.worktreeRoot, { recursive: true })
    this.git(this.baseRepo, ['worktree', 'add', '--detach', path, startRevision])
    if (context && this.git(path, ['rev-parse', 'HEAD']) !== context.baseSha) {
      this.cleanupWorktree(path)
      throw new Error('La copie créée ne correspond pas à la révision capturée.')
    }
    return path
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
    { ok: true; decision?: 'resume-publication' | 'cleanup-only' } | { ok: false; detail: string } {
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
      return { ok: false, detail: 'Le SHA de départ durable est invalide.' }
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
    const hasPreparedSha = Boolean(context.publishedSha)
    const preparedShaIsValid =
      hasPreparedSha &&
      /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(context.publishedSha!) &&
      this.revisionExists(context.publishedSha!)
    const preparedShaIsPublished =
      preparedShaIsValid &&
      this.tryGitFn(this.baseRepo, [
        'merge-base',
        '--is-ancestor',
        context.publishedSha!,
        branchRef
      ]).code === 0
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
    if (preparedShaIsPublished) return { ok: true, decision: 'cleanup-only' }

    if (!existsSync(path)) {
      return { ok: false, detail: 'La copie durable à reprendre n’existe plus.' }
    }
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) return { ok: false, detail: ownershipIssue }
    const head = this.tryGitFn(path, ['rev-parse', '--verify', 'HEAD'])
    if (
      head.code !== 0 ||
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(head.stdout.trim()) ||
      this.tryGitFn(path, ['merge-base', '--is-ancestor', context.baseSha, head.stdout.trim()])
        .code !== 0
    ) {
      return { ok: false, detail: 'La copie ne descend pas du SHA de départ autorisé.' }
    }
    if (context.publishedSha && head.stdout.trim() !== context.publishedSha) {
      return { ok: false, detail: 'La copie ne porte plus exactement le commit préparé.' }
    }
    if (context.publishedSha) {
      const status = this.tryGitFn(path, ['status', '--porcelain=v1', '-z'])
      if (status.code !== 0 || status.stdout.trim()) {
        return { ok: false, detail: 'La copie préparée a changé avant la reprise.' }
      }
    }
    return { ok: true, decision: 'resume-publication' }
  }

  changedFiles(agentId: string): string[] {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return []
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
  finalize(
    agentId: string,
    options: {
      baseBranch?: string
      expectedAgentSha?: string
      onPrepared?: (agentSha: string, baseSha: string) => void
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
      return {
        outcome: 'blocked',
        agentId,
        files: existingOperationFiles,
        reason: 'base-in-progress'
      }
    }

    const ignoredFiles = this.preservedIgnoredFiles(path)
    if (ignoredFiles.length > 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: ignoredFiles,
        reason: 'merge-failed',
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

        const publishHooksPath = this.preparePublishHooks(
          integrationPath,
          baseSha,
          integratedSha,
          expectedBaseBranch
        )
        const publish = this.tryGitFn(this.baseRepo, [
          '-c',
          `core.hooksPath=${shellPath(publishHooksPath)}`,
          'merge',
          '--ff-only',
          integratedSha
        ])
        if (publish.code === 0) return { outcome: 'merged', agentId, committed }

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
          detail: (publish.stderr || publish.stdout).trim() || undefined
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
        publishedSha: sha,
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
          publishedSha: sha,
          detail: 'La copie a reçu un nouveau commit pendant sa publication.'
        }
      }
      const unpublishedFiles = this.unpublishedFiles(path)
      if (unpublishedFiles.length > 0) {
        return {
          outcome: 'published-residue',
          agentId,
          files: unpublishedFiles,
          publishedSha: sha,
          detail: 'La copie a reçu de nouveaux fichiers pendant sa publication.'
        }
      }
      const agentCleanup = this.cleanupAgentWorktree(agentId, path, sha)
      if (agentCleanup.advanced) {
        return {
          outcome: 'published-residue',
          agentId,
          files: agentCleanup.files,
          publishedSha: sha,
          detail: 'La copie a reçu un nouveau commit pendant son nettoyage.'
        }
      }
      if (!agentCleanup.ok) {
        if (agentCleanup.files.length > 0) {
          return {
            outcome: 'published-residue',
            agentId,
            files: agentCleanup.files,
            publishedSha: sha,
            detail: 'La copie a reçu de nouveaux fichiers pendant son rangement.'
          }
        }
        return {
          outcome: 'cleanup-pending',
          agentId,
          files: agentFiles,
          publishedSha: sha,
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

  /**
   * Reprend uniquement le rangement d'une copie dont la SHA est déjà dans la base.
   * Aucun commit ni merge n'est exécuté ici : une écriture tardive conserve le bureau.
   */
  cleanupPublished(agentId: string, expectedSha: string, baseBranch?: string): FinalizeResult {
    assertSafeId(agentId, 'agentId')
    if (!this.isPublished(expectedSha, baseBranch)) {
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
            publishedSha: expectedSha,
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
      if (recoverySha !== expectedSha) {
        const files = parseNullSeparatedPaths(
          this.tryGitFn(this.baseRepo, [
            'diff',
            '--name-only',
            '-z',
            `${expectedSha}..${recoverySha}`
          ]).stdout
        )
        return this.recoveredPublishedResidue(agentId, recoveryBranch, expectedSha, files)
      }
      const deleteRef = this.deleteRecoveryRefIfExpected(recoveryBranch, expectedSha)
      if (deleteRef.advanced) {
        return this.recoveredPublishedResidue(agentId, recoveryBranch, expectedSha, deleteRef.files)
      }
      return deleteRef.deleted
        ? { outcome: 'merged', agentId, committed: false }
        : {
            outcome: 'cleanup-pending',
            agentId,
            files: [],
            publishedSha: expectedSha,
            detail: 'Le retour est publié ; sa référence de récupération sera rangée plus tard.'
          }
    }
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) {
      return {
        outcome: 'cleanup-pending',
        agentId,
        files: [],
        publishedSha: expectedSha,
        detail: ownershipIssue
      }
    }
    const lateCommit = this.headAdvance(path, expectedSha)
    const unpublishedFiles = this.unpublishedFiles(path)
    if (lateCommit.advanced || unpublishedFiles.length > 0) {
      return {
        outcome: 'published-residue',
        agentId,
        files: [...new Set([...lateCommit.files, ...unpublishedFiles])],
        publishedSha: expectedSha,
        detail: 'La copie a reçu du nouveau travail après sa publication et reste conservée.'
      }
    }
    const agentCleanup = this.cleanupAgentWorktree(agentId, path, expectedSha)
    if (agentCleanup.advanced) {
      return {
        outcome: 'published-residue',
        agentId,
        files: agentCleanup.files,
        publishedSha: expectedSha,
        detail: 'La copie a reçu un nouveau commit pendant son rangement.'
      }
    }
    if (!agentCleanup.ok) {
      if (agentCleanup.files.length > 0) {
        return {
          outcome: 'published-residue',
          agentId,
          files: agentCleanup.files,
          publishedSha: expectedSha,
          detail: 'La copie a reçu de nouveaux fichiers pendant son rangement.'
        }
      }
      return {
        outcome: 'cleanup-pending',
        agentId,
        files: agentCleanup.files,
        publishedSha: expectedSha,
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

  /** Abandon EXPLICITE d'un bureau retenu ; appelé seulement après confirmation UI. */
  discard(agentId: string): void {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return
    if (this.hasActiveProcesses(agentId)) {
      throw new Error(`La copie ${agentId} est encore utilisée par un CLI actif.`)
    }
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) throw new Error(ownershipIssue)
    const cleanup = this.cleanupWorktree(path, true)
    if (!cleanup.ok) {
      throw new Error(cleanup.detail ?? `La copie ${agentId} n’a pas pu être supprimée.`)
    }
  }
}
