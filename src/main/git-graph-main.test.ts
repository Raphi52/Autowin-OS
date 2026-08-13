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
  git(repo, 'checkout', '-b', 'tag-only')
  await writeFile(path.join(repo, 'tag-only.txt'), 'tagged but not open\n')
  git(repo, 'add', 'tag-only.txt')
  git(repo, 'commit', '-m', 'archive: tag only')
  git(repo, 'tag', 'rescue/test')
  git(repo, 'checkout', 'main')
  git(repo, 'branch', '-D', 'tag-only')
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
  await writeFile(path.join(repo, 'stash-only.txt'), 'hidden stash payload\n')
  git(repo, 'stash', 'push', '--include-untracked', '-m', 'autowin-layout-test')
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

  it('reserve ouvert aux branches et exclut un historique porte seulement par un tag', async () => {
    const result = await readGitGraph(repo, 20)
    const openBranch = result.refs?.find((ref) => ref.name === 'feat/graph')
    const tagOnly = result.refs?.find((ref) => ref.name === 'rescue/test')
    expect(result.openBranchHashes).toContain(openBranch?.hash)
    expect(result.openBranchHashes).not.toContain(tagOnly?.hash)
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

  it('exclut les commits techniques du stash', async () => {
    const result = await readGitGraph(repo, 100)
    const subjects = result.commits?.map((commit) => commit.subject) ?? []
    expect(subjects).not.toContain('On main: autowin-layout-test')
    expect(subjects.some((subject) => subject.startsWith('index on main:'))).toBe(false)
    expect(subjects.some((subject) => subject.startsWith('untracked files on main:'))).toBe(false)
  })

  it('reconnait upstream/main sans remote HEAD', async () => {
    const detachedRepo = path.join(root, 'upstream-detached-repo')
    git(root, 'init', '-b', 'main', detachedRepo)
    git(detachedRepo, 'config', 'user.email', 'tests@autowin.local')
    git(detachedRepo, 'config', 'user.name', 'Autowin Tests')
    await writeFile(path.join(detachedRepo, 'base.txt'), 'base\n')
    git(detachedRepo, 'add', 'base.txt')
    git(detachedRepo, 'commit', '-m', 'base')
    const mainHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: detachedRepo,
      encoding: 'utf8'
    }).trim()
    git(detachedRepo, 'checkout', '-b', 'feature')
    await writeFile(path.join(detachedRepo, 'feature.txt'), 'feature\n')
    git(detachedRepo, 'add', 'feature.txt')
    git(detachedRepo, 'commit', '-m', 'feature')
    const featureHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: detachedRepo,
      encoding: 'utf8'
    }).trim()
    git(detachedRepo, 'checkout', '--detach', featureHash)
    git(detachedRepo, 'update-ref', 'refs/remotes/upstream/main', mainHash)
    git(detachedRepo, 'update-ref', 'refs/remotes/upstream/feature', featureHash)
    git(detachedRepo, 'branch', '-D', 'main')
    git(detachedRepo, 'branch', '-D', 'feature')
    const result = await readGitGraph(detachedRepo, 20)
    expect(result.mainLineHashes).toContain(mainHash)
    expect(result.openBranchHashes).toContain(featureHash)
  })
})
