import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readGitGraph } from './git-graph-main'

let root = ''
let repo = ''

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' })
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'autowin-git-graph-'))
  repo = path.join(root, 'repo')
  git(root, 'init', '-b', 'main', repo)
  git(repo, 'config', 'user.email', 'tests@autowin.local')
  git(repo, 'config', 'user.name', 'Autowin Tests')
  await writeFile(path.join(repo, 'README.md'), '# test\n')
  git(repo, 'add', 'README.md')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'tag', 'v1.0.0')
  git(repo, 'branch', 'stale')
  git(repo, 'tag', '-a', 'annotated-stale', '-m', 'annotated release', 'stale')
  for (let index = 0; index < 25; index += 1) {
    await writeFile(path.join(repo, 'history.txt'), `${index}\n`)
    git(repo, 'add', 'history.txt')
    git(repo, 'commit', '-m', `history ${index}`)
  }
  const worktree = path.join(root, 'feature-wt')
  git(repo, 'worktree', 'add', '-b', 'feat/graph', worktree)
  await writeFile(path.join(worktree, 'graph.txt'), 'graph\n')
  git(worktree, 'add', 'graph.txt')
  git(worktree, 'commit', '-m', 'feat: graph')
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('readGitGraph', () => {
  it('conserve un depot sans commit comme disponible avec un historique vide', async () => {
    const emptyRepo = path.join(root, 'empty-repo')
    git(root, 'init', '-b', 'main', emptyRepo)

    const result = await readGitGraph(emptyRepo, 20)

    expect(result.available).toBe(true)
    expect(result.repositoryName).toBe('empty-repo')
    expect(result.branch).toBe('main')
    expect(result.commits).toEqual([])
    expect(result.refs).toEqual([])
    expect(result.worktrees).toHaveLength(1)
  })

  it('lit toutes les références, commits et worktrees sans mutation', async () => {
    const result = await readGitGraph(repo, 20)

    expect(result.available).toBe(true)
    expect(result.repositoryName).toBe('repo')
    expect(result.refs?.map((ref) => ref.name)).toEqual(
      expect.arrayContaining(['main', 'feat/graph', 'v1.0.0'])
    )
    expect(result.commits?.map((commit) => commit.subject)).toEqual(
      expect.arrayContaining(['initial', 'feat: graph'])
    )
    expect(result.worktrees).toHaveLength(2)
    expect(result.branch).toBe('main')
  })

  it('inclut le tip de chaque branche même hors de la fenêtre récente', async () => {
    const result = await readGitGraph(repo, 20)
    const stale = result.refs?.find((ref) => ref.name === 'stale')

    expect(stale).toBeDefined()
    expect(result.commits?.some((commit) => commit.hash === stale?.hash)).toBe(true)
  })

  it('rattache un tag annoté à son commit pelé', async () => {
    const result = await readGitGraph(repo, 20)
    const tag = result.refs?.find((ref) => ref.name === 'annotated-stale')

    expect(tag).toBeDefined()
    expect(result.commits?.some((commit) => commit.hash === tag?.hash)).toBe(true)
  })

  it('dégrade proprement hors dépôt Git', async () => {
    const result = await readGitGraph(root, 20)

    expect(result.available).toBe(false)
    expect(result.repoPath).toBe(root)
  })
})
