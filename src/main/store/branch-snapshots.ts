import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function git(repo: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env
  }).trim()
}

/**
 * Snapshot NON DESTRUCTIF de l'état courant du working tree (suivi + non suivi,
 * .gitignore respecté). Utilise un GIT_INDEX_FILE temporaire : l'index, HEAD et
 * le working tree de l'utilisateur ne sont JAMAIS modifiés (garde R1 du RUN
 * branches-rewind). Renvoie le sha d'un commit « dangling » chaîné sur HEAD, à
 * référencer par un tour de conversation pour un rewind ultérieur.
 *
 * NB : ceci est la moitié SÛRE de la Phase 2 (capture seule). Le restore, qui
 * modifie le working tree, est un increment dédié avec ses propres gardes.
 */
export function snapshotWorkspace(repo: string, message: string): string {
  const indexDir = mkdtempSync(join(tmpdir(), 'autowin-idx-'))
  const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: join(indexDir, 'index') }
  try {
    let parents: string[] = []
    try {
      const head = git(repo, ['rev-parse', 'HEAD'])
      git(repo, ['read-tree', head], env) // capture aussi les suppressions vs HEAD
      parents = ['-p', head]
    } catch {
      // repo sans commit initial : snapshot orphelin
    }
    git(repo, ['add', '-A'], env)
    const tree = git(repo, ['write-tree'], env)
    return git(repo, ['commit-tree', tree, ...parents, '-m', message], env)
  } finally {
    rmSync(indexDir, { recursive: true, force: true })
  }
}
