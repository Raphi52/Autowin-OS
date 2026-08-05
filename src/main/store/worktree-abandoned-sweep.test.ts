import { describe, expect, it, afterEach, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'

/**
 * Cause racine mesurée le 2026-08-05 : la finalisation ne supprime la copie agent que sur le chemin
 * `merged`. Tout run terminé sans publication (échec, abandon, crash) laissait donc un worktree
 * définitif — 811 accumulés sur le dépôt Autowin OS, `git worktree list` passé de 65 ms à un timeout
 * de 2 min. Ces tests fixent la frontière : la copie STÉRILE part, la copie qui porte quoi que ce
 * soit de récupérable reste.
 */

const roots: string[] = []
const DAY_MS = 24 * 60 * 60 * 1_000

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-sweep-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'ligne1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** `aged` décale l'horloge du manager : la copie devient plus vieille que la fenêtre de spawn. */
function manager(repo: string, aged: boolean): WorktreeManager {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-sweeproot-'))
  roots.push(worktreeRoot)
  return new WorktreeManager({
    baseRepo: repo,
    worktreeRoot,
    nowFn: () => Date.now() + (aged ? 2 * DAY_MS : 0)
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('balayage des copies agent abandonnées', () => {
  it('supprime une copie abandonnée qui ne porte aucun travail récupérable', () => {
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-sterile')

    expect(wm.reconcileResidues().swept).toEqual(['run-sterile'])
    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'worktree', 'list')).not.toContain('run-sterile')
  })

  it('conserve une copie porteuse de fichiers non publiés', () => {
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-dirty')
    writeFileSync(join(path, 'travail.txt'), 'non publié\n')

    expect(wm.reconcileResidues().swept).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })

  it('conserve une copie dont le commit n’est atteignable par aucune référence', () => {
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-commit')
    writeFileSync(join(path, 'travail.txt'), 'commité mais jamais publié\n')
    git(path, 'add', 'travail.txt')
    git(path, 'commit', '-q', '-m', 'travail agent')

    expect(wm.reconcileResidues().swept).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })

  it('conserve une copie récente : un run vivant sans lease encore posé', () => {
    const repo = tempRepo()
    const wm = manager(repo, false)
    const path = wm.acquire('run-jeune')

    expect(wm.reconcileResidues().swept).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })

  it('conserve une copie abandonnée mais encore tenue par un processus vivant', () => {
    const repo = tempRepo()
    const wm = manager(repo, true)
    const path = wm.acquire('run-tenu')
    wm.markProcess('run-tenu', process.pid, true)

    expect(wm.reconcileResidues().swept).toBeUndefined()
    expect(existsSync(path)).toBe(true)
  })
})
