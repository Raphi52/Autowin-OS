import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
}

export class WorktreeManager {
  private readonly baseRepo: string
  private readonly worktreeRoot: string
  private readonly git: GitRunner
  private readonly tryGitFn: typeof tryGit
  private readonly removeDirFn: (path: string) => void
  private readonly baseBranch: string

  constructor(opts: WorktreeManagerOptions) {
    this.baseRepo = opts.baseRepo
    this.worktreeRoot = opts.worktreeRoot
    this.git = opts.git ?? defaultGit
    this.tryGitFn = opts.tryGitFn ?? tryGit
    this.removeDirFn =
      opts.removeDirFn ?? ((path) => rmSync(path, { recursive: true, force: true }))
    this.baseBranch =
      opts.baseBranch ?? this.git(this.baseRepo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  }

  private pathFor(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    return join(this.worktreeRoot, `agent__${agentId}`)
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

  private cleanupWorktree(path: string): { ok: boolean; detail?: string } {
    const remove = this.tryGitFn(this.baseRepo, ['worktree', 'remove', '--force', path])
    if (remove.code === 0) return { ok: true }

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
    const out = this.git(path, ['status', '--porcelain', '--untracked-files=all'])
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\S+\s+/, ''))
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
    if (!existsSync(path)) return { outcome: 'nothing', agentId }

    const existingOperationFiles = this.operationInProgress()
    if (existingOperationFiles) {
      return {
        outcome: 'blocked',
        agentId,
        files: existingOperationFiles,
        reason: 'base-in-progress'
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
      // La copie n'a rien apporté au-delà de la base → rien à fusionner ; on range.
      const agentCleanup = this.cleanupWorktree(path)
      if (!agentCleanup.ok) {
        return {
          outcome: 'blocked',
          agentId,
          files: [],
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
      const agentCleanup = this.cleanupWorktree(path)
      if (!agentCleanup.ok) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
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
    this.git(this.baseRepo, ['worktree', 'remove', '--force', path])
  }
}
