export type GitGraphRefKind = 'local' | 'remote' | 'tag'

export interface GitGraphRef {
  name: string
  fullName: string
  kind: GitGraphRefKind
  hash: string
  isHead: boolean
}

export interface GitGraphCommit {
  hash: string
  shortHash: string
  parents: string[]
  refs: string[]
  author: string
  date: string
  subject: string
}

export interface GitGraphWorktree {
  path: string
  head: string
  branch?: string
  detached: boolean
  locked: boolean
}

export interface GitGraphSnapshot {
  available: boolean
  repoPath: string
  repositoryName?: string
  head?: string
  branch?: string
  changeCount?: number
  refs?: GitGraphRef[]
  commits?: GitGraphCommit[]
  worktrees?: GitGraphWorktree[]
  truncated?: boolean
  error?: string
}

function records(input: string): string[] {
  return input
    .split('\x1e')
    .map((record) => record.replace(/^[\r\n]+|[\r\n]+$/g, ''))
    .filter(Boolean)
}

export function parseGitGraphRefs(input: string): GitGraphRef[] {
  return records(input).flatMap((record) => {
    const [objectHash = '', peeledHash = '', fullName = '', head = ''] = record.split('\x1f')
    const hash = peeledHash || objectHash
    let kind: GitGraphRefKind
    let name: string
    if (fullName.startsWith('refs/heads/')) {
      kind = 'local'
      name = fullName.slice('refs/heads/'.length)
    } else if (fullName.startsWith('refs/remotes/')) {
      kind = 'remote'
      name = fullName.slice('refs/remotes/'.length)
    } else if (fullName.startsWith('refs/tags/')) {
      kind = 'tag'
      name = fullName.slice('refs/tags/'.length)
    } else {
      return []
    }
    return [{ name, fullName, kind, hash, isHead: head.trim() === '*' }]
  })
}

export function parseGitGraphCommits(input: string): GitGraphCommit[] {
  return records(input).map((record) => {
    const [
      hash = '',
      shortHash = '',
      parentList = '',
      decorationList = '',
      author = '',
      date = '',
      subject = ''
    ] = record.split('\x1f')
    return {
      hash,
      shortHash,
      parents: parentList.trim() ? parentList.trim().split(/\s+/) : [],
      refs: decorationList
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean),
      author,
      date,
      subject
    }
  })
}

export function parseGitWorktrees(input: string): GitGraphWorktree[] {
  return input
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .flatMap((lines) => {
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
      const head = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length)
      if (!path || !head) return []
      const branchRef = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
      return [
        {
          path,
          head,
          ...(branchRef ? { branch: branchRef.replace(/^refs\/heads\//, '') } : {}),
          detached: lines.includes('detached'),
          locked: lines.some((line) => line === 'locked' || line.startsWith('locked '))
        }
      ]
    })
}
