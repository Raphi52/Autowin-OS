import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Vrais dépôts git en tmp : sous charge parallèle, le budget vitest par défaut (5 s) est trop court. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeManager } from './worktree-manager'

const roots: string[] = []

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-recovery-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'base\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

function manager(repo: string): { manager: WorktreeManager; worktreeRoot: string } {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-recovery-root-'))
  roots.push(worktreeRoot)
  return {
    manager: new WorktreeManager({ baseRepo: repo, worktreeRoot }),
    worktreeRoot
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('récupération des worktrees après redémarrage', () => {
  it(
    'reprend et finalise réellement une copie laissée par le processus précédent',
    () => {
      const repo = tempRepo()
      const previous = manager(repo)
      const orphanPath = previous.manager.acquire('run-crashed')
      writeFileSync(join(orphanPath, 'recovered.txt'), 'récupéré\n')

      const restartedManager = new WorktreeManager({
        baseRepo: repo,
        worktreeRoot: previous.worktreeRoot
      })
      const coordinator = new RunWorktreeCoordinator({ manager: restartedManager })

      expect(readFileSync(join(repo, 'recovered.txt'), 'utf8')).toContain('récupéré')
      expect(restartedManager.listAgentIds()).toEqual([])
      expect(coordinator.activity()).toEqual([
        expect.objectContaining({ agentId: 'run-crashed', state: 'merged' })
      ])
    },
    10_000
  )

  it('conserve une copie contenant un fichier ignoré non jetable', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore tmp')
    const previous = manager(repo)
    const orphanPath = previous.manager.acquire('run-ignored')
    writeFileSync(join(orphanPath, 'result.tmp'), 'livrable ignoré\n')

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot
    })
    const coordinator = new RunWorktreeCoordinator({ manager: restartedManager })

    expect(existsSync(join(orphanPath, 'result.tmp'))).toBe(true)
    expect(restartedManager.listAgentIds()).toEqual(['run-ignored'])
    expect(coordinator.activity()).toEqual([
      expect.objectContaining({
        agentId: 'run-ignored',
        state: 'blocked',
        files: [{ path: 'result.tmp', kind: 'mod' }],
        attentionReason: 'merge-failed'
      })
    ])
  })

  it(
    'conserve un fichier arrivé pendant la publication juste avant le nettoyage',
    () => {
      const repo = tempRepo()
      writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
      git(repo, 'add', '.gitignore')
      git(repo, 'commit', '-q', '-m', 'ignore tmp')
      const previous = manager(repo)
      const orphanPath = previous.manager.acquire('run-late-write')
      writeFileSync(join(orphanPath, 'tracked.txt'), 'travail suivi\n')
      let injected = false
      const tryGitFn = (dir: string, args: string[]) => {
        if (
          !injected &&
          dir === repo &&
          args[0] === 'worktree' &&
          args[1] === 'repair' &&
          args.at(-1)?.includes('.quarantine')
        ) {
          injected = true
          writeFileSync(join(args.at(-1)!, 'late.tmp'), 'arrivé pendant la publication\n')
        }
        const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
        return {
          code: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? ''
        }
      }

      const restartedManager = new WorktreeManager({
        baseRepo: repo,
        worktreeRoot: previous.worktreeRoot,
        tryGitFn
      })
      const coordinator = new RunWorktreeCoordinator({ manager: restartedManager })

      expect(readFileSync(join(repo, 'tracked.txt'), 'utf8')).toContain('travail suivi')
      expect(existsSync(join(orphanPath, 'late.tmp'))).toBe(true)
      expect(restartedManager.listAgentIds()).toEqual(['run-late-write'])
      expect(coordinator.activity()).toEqual([
        expect.objectContaining({
          agentId: 'run-late-write',
          state: 'blocked',
          files: [{ path: 'late.tmp', kind: 'mod' }]
        })
      ])
    },
    10_000
  )

  it(
    'attend la fin du CLI vivant avant de reprendre sa copie',
    () => {
      const repo = tempRepo()
      const previous = manager(repo)
      const orphanPath = previous.manager.acquire('run-active')
      writeFileSync(join(orphanPath, 'active.txt'), 'encore en cours\n')
      previous.manager.markProcess('run-active', process.pid, true)

      const restartedManager = new WorktreeManager({
        baseRepo: repo,
        worktreeRoot: previous.worktreeRoot
      })
      const coordinator = new RunWorktreeCoordinator({ manager: restartedManager })

      expect(existsSync(join(repo, 'active.txt'))).toBe(false)
      expect(existsSync(orphanPath)).toBe(true)
      expect(coordinator.activity()).toEqual([
        expect.objectContaining({ agentId: 'run-active', state: 'working' })
      ])

      restartedManager.markProcess('run-active', process.pid, false)
      coordinator.retryRecovery()

      expect(readFileSync(join(repo, 'active.txt'), 'utf8')).toContain('encore en cours')
      expect(restartedManager.listAgentIds()).toEqual([])
    },
    10_000
  )

  it(
    'conserve un commit arrivé pendant la publication au lieu de supprimer sa copie',
    () => {
      const repo = tempRepo()
      const previous = manager(repo)
      const orphanPath = previous.manager.acquire('run-late-commit')
      writeFileSync(join(orphanPath, 'tracked.txt'), 'travail publié\n')
      let injected = false
      const tryGitFn = (dir: string, args: string[]) => {
        if (
          !injected &&
          dir === repo &&
          args[0] === 'worktree' &&
          args[1] === 'repair' &&
          args.at(-1)?.includes('.quarantine')
        ) {
          injected = true
          const quarantinePath = args.at(-1)!
          writeFileSync(join(quarantinePath, 'late-commit.txt'), 'commit tardif\n')
          git(quarantinePath, 'add', 'late-commit.txt')
          git(quarantinePath, 'commit', '-q', '-m', 'late commit')
        }
        const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
        return {
          code: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? ''
        }
      }

      const restartedManager = new WorktreeManager({
        baseRepo: repo,
        worktreeRoot: previous.worktreeRoot,
        tryGitFn
      })
      const coordinator = new RunWorktreeCoordinator({ manager: restartedManager })

      expect(readFileSync(join(repo, 'tracked.txt'), 'utf8')).toContain('travail publié')
      expect(existsSync(join(repo, 'late-commit.txt'))).toBe(false)
      expect(existsSync(join(orphanPath, 'late-commit.txt'))).toBe(true)
      expect(restartedManager.listAgentIds()).toEqual(['run-late-commit'])
      expect(coordinator.activity()).toEqual([
        expect.objectContaining({
          agentId: 'run-late-commit',
          state: 'blocked',
          files: [{ path: 'late-commit.txt', kind: 'mod' }]
        })
      ])
    },
    10_000
  )

  it('nettoie une copie qui ne contient que des sorties régénérables', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), 'node_modules\nout\n.eslintcache\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore generated')
    const current = manager(repo)
    const path = current.manager.acquire('run-generated')
    mkdirSync(join(path, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(path, 'out'), { recursive: true })
    writeFileSync(join(path, 'node_modules', 'pkg', 'index.js'), 'generated\n')
    writeFileSync(join(path, 'out', 'bundle.js'), 'generated\n')
    writeFileSync(join(path, '.eslintcache'), 'generated\n')

    expect(current.manager.finalize('run-generated')).toMatchObject({ outcome: 'nothing' })
    expect(current.manager.listAgentIds()).toEqual([])
  })
})
