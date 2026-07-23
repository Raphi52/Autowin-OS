/**
 * Parsers PURS de la sortie git (read-only) pour la surface "Source control". Aucune exécution ici —
 * l'exec vit côté main (git-read-main). Séparé pour être testable sans repo ni child_process.
 *
 * IMPORTANT (vision produit) : cette couche LIT seulement. Aucune action git n'est faite ici ni via
 * un bouton du renderer — les actions composent un PROMPT envoyé à l'agent.
 */

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
export interface GitChange {
  path: string
  status: GitFileStatus
  staged: boolean
}
export interface GitState {
  branch: string
  ahead: number
  behind: number
  changes: GitChange[]
}
export interface GitCommit {
  hash: string
  subject: string
}
export interface GitReadResult {
  available: boolean
  state?: GitState
  history?: GitCommit[]
  error?: string
}
export interface GitDiffResult {
  available: boolean
  diff?: string
  error?: string
}

function classify(code: string): GitFileStatus {
  if (code.includes('R')) return 'renamed'
  if (code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  return 'modified'
}

/** Parse `git status --porcelain=v2 --branch`. */
export function parseGitStatus(porcelain: string): GitState {
  const state: GitState = { branch: '', ahead: 0, behind: 0, changes: [] }
  for (const raw of porcelain.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('# branch.head ')) {
      state.branch = line.slice('# branch.head '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line)
      if (m) {
        state.ahead = Number(m[1])
        state.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // "1 XY ... <path>"  |  "2 XY ... <path>\t<orig>"
      const fields = line.split(' ')
      const xy = fields[1] ?? '..'
      const rest = line.startsWith('2 ') ? (line.split('\t')[0] ?? '') : line
      const path = rest.split(' ').slice(8).join(' ').trim() || (line.split('\t')[0]?.split(' ').slice(8).join(' ') ?? '')
      const staged = xy[0] !== '.'
      state.changes.push({ path, status: classify(xy), staged })
    } else if (line.startsWith('? ')) {
      state.changes.push({ path: line.slice(2).trim(), status: 'untracked', staged: false })
    }
  }
  return state
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta'
export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/** Parse un diff unifié (`git diff --no-color`) en lignes typées pour un rendu coloré read-only. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('@@')) lines.push({ kind: 'hunk', text: line })
    else if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ')
    )
      lines.push({ kind: 'meta', text: line })
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line })
    else lines.push({ kind: 'context', text: line })
  }
  // supprime une éventuelle dernière ligne vide (split trailing \n)
  if (lines.length && lines[lines.length - 1].text === '') lines.pop()
  return lines
}

/** Parse `git log --pretty=format:%h%x09%s -n N`. */
export function parseGitLog(text: string): GitCommit[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter(Boolean)
    .map((l) => {
      const tab = l.indexOf('\t')
      return tab < 0
        ? { hash: l.trim(), subject: '' }
        : { hash: l.slice(0, tab).trim(), subject: l.slice(tab + 1).trim() }
    })
}
