import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** Rejette tout id pouvant produire une traversée de chemin (`..`, `/`, `\`, espaces…). */
function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} invalide (caractères non autorisés): ${value}`)
}

/** Chemin déterministe du worktree d'une branche de conversation (ids validés). */
export function branchWorktreePath(
  worktreeRoot: string,
  conversationId: string,
  branchId: string
): string {
  assertSafeId(conversationId, 'conversationId')
  assertSafeId(branchId, 'branchId')
  return join(worktreeRoot, `${conversationId}__${branchId}`)
}

/**
 * Garantit un worktree git ISOLÉ pour une branche de conversation (garde R2 du
 * RUN branches-rewind : un rewind sur une branche n'affecte pas les autres ni le
 * repo de base). Détaché sur HEAD, idempotent. NE modifie PAS le working tree de
 * base. Le flip LIVE (faire pointer l'orchestrator dessus) est un pas dédié, non
 * inclus ici : ce module reste pur et testable hors du vrai repo.
 */
export function ensureBranchWorktree(
  baseRepo: string,
  worktreeRoot: string,
  conversationId: string,
  branchId: string
): string {
  const path = branchWorktreePath(worktreeRoot, conversationId, branchId)
  if (existsSync(path)) return path
  mkdirSync(worktreeRoot, { recursive: true })
  git(baseRepo, ['worktree', 'add', '--detach', path, 'HEAD'])
  return path
}

/** Supprime le worktree d'une branche (idempotent). */
export function removeBranchWorktree(
  baseRepo: string,
  worktreeRoot: string,
  conversationId: string,
  branchId: string
): void {
  const path = branchWorktreePath(worktreeRoot, conversationId, branchId)
  if (!existsSync(path)) return
  git(baseRepo, ['worktree', 'remove', '--force', path])
}
