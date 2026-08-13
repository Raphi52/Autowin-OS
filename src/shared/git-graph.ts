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
  lockedReason?: string
  prunableReason?: string
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
  mainLineHashes?: string[]
  mergedIntoMainHashes?: string[]
  openBranchHashes?: string[]
  worktrees?: GitGraphWorktree[]
  truncated?: boolean
  error?: string
}

export function selectGitGraphMainRef(refs: GitGraphRef[]): GitGraphRef | undefined {
  return (
    refs.find((ref) => ref.fullName === 'refs/heads/main') ??
    refs.find((ref) => ref.fullName === 'refs/remotes/origin/main') ??
    refs.find((ref) => /^refs\/remotes\/[^/]+\/main$/.test(ref.fullName)) ??
    refs.find((ref) => /^refs\/remotes\/[^/]+\/HEAD$/.test(ref.fullName)) ??
    refs.find((ref) => ref.fullName === 'refs/heads/master') ??
    refs.find((ref) => /^refs\/remotes\/[^/]+\/master$/.test(ref.fullName)) ??
    refs.find((ref) => ref.fullName === 'refs/heads/trunk') ??
    refs.find((ref) => /^refs\/remotes\/[^/]+\/trunk$/.test(ref.fullName)) ??
    refs.find((ref) => ref.isHead)
  )
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
  const blocks = input.includes('\0')
    ? input.split('\0\0').map((block) => block.split('\0').filter(Boolean))
    : input
        .trim()
        .split(/\r?\n\r?\n/)
        .map((block) => block.split(/\r?\n/))

  return blocks.flatMap((fields) => {
    const path = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length)
    const head = fields.find((field) => field.startsWith('HEAD '))?.slice('HEAD '.length)
    if (!path || !head) return []
    const branchRef = fields.find((field) => field.startsWith('branch '))?.slice('branch '.length)
    const lockedField = fields.find((field) => field === 'locked' || field.startsWith('locked '))
    const prunableField = fields.find(
      (field) => field === 'prunable' || field.startsWith('prunable ')
    )
    const lockedReason = lockedField?.slice('locked'.length).trim()
    const prunableReason = prunableField?.slice('prunable'.length).trim()
    return [
      {
        path,
        head,
        ...(branchRef ? { branch: branchRef.replace(/^refs\/heads\//, '') } : {}),
        detached: fields.includes('detached'),
        locked: Boolean(lockedField),
        ...(lockedReason ? { lockedReason } : {}),
        ...(prunableField
          ? { prunableReason: prunableReason || 'entrée déclarée prunable par Git' }
          : {})
      }
    ]
  })
}
