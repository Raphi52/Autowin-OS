import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  parseGitGraphCommits,
  parseGitGraphRefs,
  parseGitWorktrees,
  selectGitGraphMainRef,
  type GitGraphSnapshot
} from '../shared/git-graph'
import { parseGitStatus } from '../shared/git-read'

const run = promisify(execFile)
const MAX_BUFFER = 8 * 1024 * 1024
const GRAPH_FORMAT = '%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s%x1e'

/**
 * Snapshot de topologie Git strictement READ-ONLY. Les commandes sont passées en argv sans shell,
 * bornées et dégradent vers `available:false` au lieu de faire remonter une exception via IPC.
 */
export async function readGitGraph(cwd: string, historyLimit = 240): Promise<GitGraphSnapshot> {
  const limit = Math.min(Math.max(Math.trunc(historyLimit), 20), 1000)
  try {
    const rootResult = await run('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    const repoPath = rootResult.stdout.trim()
    const [
      statusResult,
      refsResult,
      commitsResult,
      decoratedResult,
      worktreesResult,
      headHashResult
    ] = await Promise.all([
      run('git', ['status', '--porcelain=v2', '--branch'], {
        cwd: repoPath,
        windowsHide: true,
        maxBuffer: MAX_BUFFER
      }),
      run(
        'git',
        [
          'for-each-ref',
          '--format=%(objectname)%1f%(*objectname)%1f%(refname)%1f%(HEAD)%1e',
          'refs/heads',
          'refs/remotes',
          'refs/tags'
        ],
        { cwd: repoPath, windowsHide: true, maxBuffer: MAX_BUFFER }
      ),
      run(
        'git',
        [
          'log',
          '--exclude=refs/stash',
          '--all',
          '--topo-order',
          '--date-order',
          `-n${limit + 1}`,
          `--pretty=format:${GRAPH_FORMAT}`
        ],
        { cwd: repoPath, windowsHide: true, maxBuffer: MAX_BUFFER }
      ),
      run(
        'git',
        [
          'log',
          '--exclude=refs/stash',
          '--all',
          '--topo-order',
          '--date-order',
          '--simplify-by-decoration',
          `--pretty=format:${GRAPH_FORMAT}`
        ],
        { cwd: repoPath, windowsHide: true, maxBuffer: MAX_BUFFER }
      ),
      run('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoPath,
        windowsHide: true,
        maxBuffer: MAX_BUFFER
      }),
      run('git', ['rev-parse', '--verify', 'HEAD'], {
        cwd: repoPath,
        windowsHide: true,
        maxBuffer: MAX_BUFFER
      }).catch(() => undefined)
    ])

    const state = parseGitStatus(statusResult.stdout)
    const refs = parseGitGraphRefs(refsResult.stdout)
    const allCommits = parseGitGraphCommits(commitsResult.stdout)
    const recentCommits = allCommits.slice(0, limit)
    const recentHashes = new Set(recentCommits.map((commit) => commit.hash))
    const decoratedCommits = parseGitGraphCommits(decoratedResult.stdout).filter(
      (commit) => !recentHashes.has(commit.hash)
    )
    const commits = [...recentCommits, ...decoratedCommits]
    const displayedHashes = new Set(commits.map((commit) => commit.hash))
    const headRef = refs.find((ref) => ref.isHead)
    const headHash = headHashResult?.stdout.trim()
    const headCommit = commits.find((commit) => commit.hash === (headRef?.hash ?? headHash))
    const mainRef =
      selectGitGraphMainRef(refs) ??
      (headHash
        ? {
            name: 'HEAD',
            fullName: 'HEAD',
            kind: 'local' as const,
            hash: headHash,
            isHead: true
          }
        : undefined)
    const [mainLineHashes, mergedIntoMainHashes, openBranchHashes] = mainRef
      ? await Promise.all([
          run('git', ['rev-list', '--first-parent', mainRef.hash], {
            cwd: repoPath,
            windowsHide: true,
            maxBuffer: MAX_BUFFER
          }).then((result) =>
            result.stdout
              .trim()
              .split(/\r?\n/)
              .filter((hash) => displayedHashes.has(hash))
          ),
          run('git', ['rev-list', mainRef.hash], {
            cwd: repoPath,
            windowsHide: true,
            maxBuffer: MAX_BUFFER
          }).then((result) =>
            result.stdout
              .trim()
              .split(/\r?\n/)
              .filter((hash) => displayedHashes.has(hash))
          ),
          run('git', ['rev-list', '--branches', '--remotes', '--not', mainRef.hash], {
            cwd: repoPath,
            windowsHide: true,
            maxBuffer: MAX_BUFFER
          }).then((result) =>
            result.stdout
              .trim()
              .split(/\r?\n/)
              .filter((hash) => displayedHashes.has(hash))
          )
        ])
      : [[], [], []]

    return {
      available: true,
      repoPath,
      repositoryName: path.basename(repoPath),
      head: headCommit?.shortHash ?? headRef?.hash.slice(0, 7),
      branch: state.branch,
      changeCount: state.changes.length,
      refs,
      commits,
      mainLineHashes,
      mergedIntoMainHashes,
      openBranchHashes,
      worktrees: parseGitWorktrees(worktreesResult.stdout),
      truncated: allCommits.length > limit
    }
  } catch (error) {
    return {
      available: false,
      repoPath: cwd,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
