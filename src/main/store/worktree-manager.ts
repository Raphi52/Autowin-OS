import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { platform } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

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
function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} invalide (caractères non autorisés): ${value}`)
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

const defaultGit: GitRunner = (repo, args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

/** Comme defaultGit mais ne jette PAS : renvoie code + sorties (pour détecter un conflit de merge). */
function tryGit(
  repo: string,
  args: string[]
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
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
  | { outcome: 'conflict'; agentId: string; files: string[] }
  | {
      outcome: 'blocked'
      agentId: string
      files: string[]
      reason: 'base-dirty' | 'base-in-progress' | 'merge-failed'
      detail?: string
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
  processIdentityFn?: (pid: number) => string | undefined
}

const UNVERIFIED_LEASE_MAX_AGE_MS = 12 * 60 * 60 * 1_000

function defaultProcessIdentity(pid: number): string | undefined {
  try {
    if (platform() === 'win32') {
      const command =
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
        `$path = ''; try { $path = $p.Path } catch {}; ` +
        `Write-Output ($p.StartTime.ToUniversalTime().Ticks.ToString() + '|' + $path)`
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true
      }).trim()
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
      return `${startedAt}|${executable}`
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 3_000
    }).trim()
  } catch {
    return undefined
  }
}

export class WorktreeManager {
  private readonly baseRepo: string
  private readonly worktreeRoot: string
  private readonly git: GitRunner
  private readonly tryGitFn: typeof tryGit
  private readonly removeDirFn: (path: string) => void
  private readonly baseBranch: string
  private readonly processIdentity: (pid: number) => string | undefined

  constructor(opts: WorktreeManagerOptions) {
    this.baseRepo = opts.baseRepo
    this.worktreeRoot = opts.worktreeRoot
    this.git = opts.git ?? defaultGit
    this.tryGitFn = opts.tryGitFn ?? tryGit
    this.removeDirFn =
      opts.removeDirFn ?? ((path) => rmSync(path, { recursive: true, force: true }))
    this.baseBranch =
      opts.baseBranch ?? this.git(this.baseRepo, ['rev-parse', '--abbrev-ref', 'HEAD'])
    this.processIdentity = opts.processIdentityFn ?? defaultProcessIdentity
  }

  private pathFor(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    return join(this.worktreeRoot, `agent__${agentId}`)
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
      writeFileSync(intentPath, String(Date.now()))
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
        active = true
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
      if (lease.identity && currentIdentity && lease.identity !== currentIdentity) {
        rmSync(leasePath, { force: true })
        continue
      }
      const identityMatches =
        Boolean(lease.identity) && Boolean(currentIdentity) && lease.identity === currentIdentity
      const fallbackStillFresh =
        (!lease.identity || !currentIdentity) &&
        Date.now() - lease.recordedAt < UNVERIFIED_LEASE_MAX_AGE_MS
      try {
        process.kill(pid, 0)
        if (identityMatches || fallbackStillFresh) {
          active = true
        } else {
          rmSync(leasePath, { force: true })
        }
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === 'EPERM' &&
          (identityMatches || fallbackStillFresh)
        ) {
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
    const conflictOut = this.tryGitFn(repo, [
      'diff',
      '--name-only',
      '--diff-filter=U'
    ])
    const conflictFiles = conflictOut.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
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
    const dirtyFiles = this.git(this.baseRepo, [
      'status',
      '--porcelain',
      '--untracked-files=all'
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\S+\s+/, ''))
    const stagedFiles = this.git(this.baseRepo, ['diff', '--cached', '--name-only'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const dirtyOverlap = agentFiles.filter((file) => dirtyFiles.includes(file))
    return [...new Set([...stagedFiles, ...dirtyOverlap])]
  }

  private headAdvance(
    path: string,
    expectedSha: string
  ): { advanced: boolean; files: string[] } {
    const currentSha = this.git(path, ['rev-parse', 'HEAD'])
    if (currentSha === expectedSha) return { advanced: false, files: [] }
    const files = this.git(path, ['diff', '--name-only', `${expectedSha}..${currentSha}`])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
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
      const files = this.git(this.baseRepo, ['diff', '--name-only', `${expectedSha}..${durableSha}`])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      this.tryGitFn(this.baseRepo, ['worktree', 'add', path, branch])
      return { ok: false, advanced: true, files }
    }

    const deleteRef = this.tryGitFn(this.baseRepo, ['branch', '-D', branch])
    return { ok: deleteRef.code === 0, advanced: false, files: [] }
  }

  /**
   * Fichiers ignorés qui peuvent être de vrais livrables locaux. Les dépendances, caches et sorties
   * de build explicitement bornés sont régénérables ; tout autre fichier ignoré bloque le nettoyage.
   */
  private preservedIgnoredFiles(repo: string): string[] {
    const out = this.git(repo, [
      'ls-files',
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
      ':(exclude,glob)**/.DS_Store'
    ])
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  private workingTreeFiles(repo: string): string[] {
    return this.git(repo, ['status', '--porcelain', '--untracked-files=all'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\S+\s+/, ''))
  }

  /** Dernière barrière avant suppression : inclut les écritures suivies et ignorées arrivées tard. */
  private unpublishedFiles(repo: string): string[] {
    return [...new Set([...this.workingTreeFiles(repo), ...this.preservedIgnoredFiles(repo)])]
  }

  private isExpectedBaseBranch(): boolean {
    const currentRef = this.tryGitFn(this.baseRepo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    return currentRef.code === 0 && currentRef.stdout.trim() === this.baseBranch
  }

  private activeHooksDir(): string {
    const configured = this.tryGitFn(this.baseRepo, [
      'config',
      '--path',
      '--get',
      'core.hooksPath'
    ])
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
    integratedSha: string
  ): string {
    const hooksPath = join(integrationPath, '.autowin-publish-hooks')
    const inputPath = join(hooksPath, 'reference-transaction.input')
    const markerPath = join(hooksPath, 'preflight-passed')
    const activeHooksDir = this.activeHooksDir()
    const originalReferenceHook = join(activeHooksDir, 'reference-transaction')
    const originalPostMergeHook = join(activeHooksDir, 'post-merge')
    const expectedRef = `refs/heads/${this.baseBranch}`
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
  acquire(agentId: string): string {
    const path = this.pathFor(agentId)
    if (existsSync(path)) return path
    mkdirSync(this.worktreeRoot, { recursive: true })
    this.git(this.baseRepo, ['worktree', 'add', '--detach', path, this.baseBranch])
    return path
  }

  /** Liste les fichiers modifiés (ajout/mod/suppr) dans la copie de l'agent. */
  changedFiles(agentId: string): string[] {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return []
    return this.workingTreeFiles(path)
  }

  /**
   * Full-auto : committe le travail de l'agent dans sa copie puis le fusionne dans le repo de base.
   * - Rien à fusionner → { outcome: 'nothing' }.
   * - Merge propre → { outcome: 'merged' } + copie supprimée.
   * - Conflit réel → { outcome: 'conflict', files } : merge AVORTÉ, copie CONSERVÉE.
   * - Base sale/refus Git → { outcome: 'blocked', files } : aucun faux conflit, copie CONSERVÉE.
   */
  finalize(agentId: string): FinalizeResult {
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

    const dirty = this.git(path, ['status', '--porcelain']).length > 0
    let committed = false
    if (dirty) {
      this.git(path, ['add', '-A'])
      this.git(path, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `agent ${agentId}`])
      committed = true
    }
    const sha = this.git(path, ['rev-parse', 'HEAD'])
    const baseSha = this.git(this.baseRepo, ['rev-parse', 'HEAD'])
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

    const agentFiles = this.git(this.baseRepo, ['diff', '--name-only', `${baseSha}...${sha}`])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
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
          return { outcome: 'conflict', agentId, files }
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

      if (!this.isExpectedBaseBranch()) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'base-in-progress',
          detail: 'La branche courante a changé pendant la préparation de l’intégration.'
        }
      }

      const publishHooksPath = this.preparePublishHooks(integrationPath, baseSha, integratedSha)
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

      if (!this.isExpectedBaseBranch()) {
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
      return {
        outcome: 'blocked',
        agentId,
        files: agentFiles,
        reason: 'merge-failed',
        detail: 'La copie d’intégration n’a pas pu être nettoyée.'
      }
    }

    if (integrationResult.outcome === 'merged') {
      const lateCommit = this.headAdvance(path, sha)
      if (lateCommit.advanced) {
        return {
          outcome: 'blocked',
          agentId,
          files: lateCommit.files,
          reason: 'merge-failed',
          detail: 'La copie a reçu un nouveau commit pendant sa publication.'
        }
      }
      const unpublishedFiles = this.unpublishedFiles(path)
      if (unpublishedFiles.length > 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: unpublishedFiles,
          reason: 'merge-failed',
          detail: 'La copie a reçu de nouveaux fichiers pendant sa publication.'
        }
      }
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
          files: agentCleanup.files.length > 0 ? agentCleanup.files : agentFiles,
          reason: 'merge-failed',
          detail: 'La base est publiée, mais la copie agent n’a pas pu être nettoyée.'
        }
      }
    }
    return integrationResult
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
}
