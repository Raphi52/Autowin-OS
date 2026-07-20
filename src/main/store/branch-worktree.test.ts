import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { branchWorktreePath, ensureBranchWorktree, removeBranchWorktree } from './branch-worktree'

const roots: string[] = []
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-wt-'))
  roots.push(dir)
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  }
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'base')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  return dir
}

afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('branch-worktree (isolation par branche)', () => {
  it('crée un worktree isolé, idempotent, puis le supprime', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wtroot-'))
    roots.push(wtRoot)

    const path1 = ensureBranchWorktree(repo, wtRoot, 'conv-1', 'branch-A-2')
    expect(existsSync(join(path1, 'a.txt'))).toBe(true) // contenu du repo présent
    expect(
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: path1,
        encoding: 'utf8'
      }).trim()
    ).toBe('true')

    // idempotent : même chemin, pas d'erreur
    const path2 = ensureBranchWorktree(repo, wtRoot, 'conv-1', 'branch-A-2')
    expect(path2).toBe(path1)

    // isolation : écrire dans le worktree ne touche pas le repo de base
    writeFileSync(join(path1, 'a.txt'), 'modifié-dans-worktree')
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()
    ).toBe('')

    removeBranchWorktree(repo, wtRoot, 'conv-1', 'branch-A-2')
    expect(existsSync(path1)).toBe(false)
    // idempotent : re-supprimer ne jette pas
    expect(() => removeBranchWorktree(repo, wtRoot, 'conv-1', 'branch-A-2')).not.toThrow()
  })

  it('rejette un id de traversée de chemin (path traversal)', () => {
    expect(() => branchWorktreePath('/root', '..\\..\\evil', 'branch-A-2')).toThrow()
    expect(() => branchWorktreePath('/root', 'conv-1', '../../../etc')).toThrow()
    expect(() => branchWorktreePath('/root', 'conv 1', 'branch-A-2')).toThrow() // espace
  })
})
