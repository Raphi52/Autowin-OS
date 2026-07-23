import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

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

export interface WorktreeManagerOptions {
  baseRepo: string
  worktreeRoot: string
  /** Branche de base sur laquelle fusionner (défaut : la branche courante du repo). */
  baseBranch?: string
  git?: GitRunner
  /** tryGit injectable (tests) ; défaut = wrapper execFileSync non-jetant. */
  tryGitFn?: typeof tryGit
}

export class WorktreeManager {
  private readonly baseRepo: string
  private readonly worktreeRoot: string
  private readonly git: GitRunner
  private readonly tryGitFn: typeof tryGit
  private readonly baseBranch: string

  constructor(opts: WorktreeManagerOptions) {
    this.baseRepo = opts.baseRepo
    this.worktreeRoot = opts.worktreeRoot
    this.git = opts.git ?? defaultGit
    this.tryGitFn = opts.tryGitFn ?? tryGit
    this.baseBranch =
      opts.baseBranch ?? this.git(this.baseRepo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  }

  private pathFor(agentId: string): string {
    assertSafeId(agentId, 'agentId')
    return join(this.worktreeRoot, `agent__${agentId}`)
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
    const out = this.git(path, ['status', '--porcelain'])
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
   * - Conflit → { outcome: 'conflict', files } : merge AVORTÉ, copie CONSERVÉE (merge assisté).
   */
  finalize(agentId: string): FinalizeResult {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return { outcome: 'nothing', agentId }

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
      this.remove(agentId)
      return { outcome: 'nothing', agentId }
    }

    const merge = this.tryGitFn(this.baseRepo, [
      '-c',
      'commit.gpgsign=false',
      'merge',
      '--no-edit',
      sha
    ])
    if (merge.code === 0) {
      this.remove(agentId)
      return { outcome: 'merged', agentId, committed }
    }

    // Conflit : récupérer les fichiers en cause AVANT d'avorter, puis restaurer la base intacte.
    const conflictOut = this.tryGitFn(this.baseRepo, ['diff', '--name-only', '--diff-filter=U'])
    const files = conflictOut.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    this.tryGitFn(this.baseRepo, ['merge', '--abort'])
    // Copie CONSERVÉE (pas de remove) → merge assisté possible.
    return { outcome: 'conflict', agentId, files: files.length ? files : ['(fichier inconnu)'] }
  }

  /** Supprime la copie de l'agent (idempotent). */
  remove(agentId: string): void {
    const path = this.pathFor(agentId)
    if (!existsSync(path)) return
    this.git(this.baseRepo, ['worktree', 'remove', '--force', path])
  }
}
