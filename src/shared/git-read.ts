/**
 * Parsers PURS de la sortie git (read-only) pour la surface "Source control". Aucune exécution ici —
 * l'exec vit côté main (git-read-main). Séparé pour être testable sans repo ni child_process.
 *
 * IMPORTANT (vision produit) : cette couche LIT seulement. Aucune action git n'est faite ici ni via
 * un bouton du renderer — les actions composent un PROMPT envoyé à l'agent.
 */

export type GitFileStatus =
  'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  /** Fichier de la conversation déjà commité : diff = son dernier commit, pas l'arbre courant. */
  | 'committed'
  /** Modifié par la conversation puis retouché depuis ailleurs : listé, diff non attribuable. */
  | 'retouched'
export interface GitChange {
  path: string
  status: GitFileStatus
  staged: boolean
  /** Présent uniquement dans la vue Projet agrégée quand le diff vit dans un worktree. */
  workspaceRoot?: string
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
  /** Avertissement affiché au-dessus du diff (ex. : il inclut des changements venus d'ailleurs). */
  note?: string
}

function classify(code: string): GitFileStatus {
  if (code.includes('R')) return 'renamed'
  if (code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  return 'modified'
}

/** Les echappements a une lettre de `quote_c_style` (git, quote.c), en octets. */
const ECHAPPEMENTS_C: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92
}

/**
 * LE VRAI NOM D'UN CHEMIN CITE PAR GIT — heal conv-204, 2026-10-10.
 *
 * Avec `core.quotePath` (defaut), git ecrit entre guillemets, a la maniere du C, tout chemin qui
 * porte un octet non ASCII ou un caractere special : `"accentu\303\251.ts"` pour `accentué.ts`. Ce
 * texte n'est le nom d'AUCUN fichier : garde tel quel, `git diff -- <ce texte>` ne trouve rien et
 * les modifications du fichier deviennent invisibles. Les sequences `\ooo` sont des OCTETS, a
 * reassembler en UTF-8. Un champ qui n'est pas entierement entre guillemets est rendu intact :
 * git cite toujours un chemin qui commence par un guillemet, donc aucun vrai nom n'est confondu.
 */
export function decoderCheminGit(champ: string): string {
  if (champ.length < 2 || !champ.startsWith('"') || !champ.endsWith('"')) return champ
  const caracteres = Array.from(champ.slice(1, -1))
  const encodeur = new TextEncoder()
  const octets: number[] = []
  for (let i = 0; i < caracteres.length; i += 1) {
    const c = caracteres[i] as string
    if (c !== '\\') {
      octets.push(...encodeur.encode(c))
      continue
    }
    const octal = /^[0-7]{1,3}/.exec(caracteres.slice(i + 1, i + 4).join(''))?.[0]
    if (octal) {
      octets.push(parseInt(octal, 8))
      i += octal.length
      continue
    }
    const code = ECHAPPEMENTS_C[caracteres[i + 1] ?? '']
    if (code !== undefined) {
      octets.push(code)
      i += 1
      continue
    }
    octets.push(92) // barre isolee : git n'en produit pas, on la garde telle quelle
  }
  return new TextDecoder().decode(new Uint8Array(octets))
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
      const pathFieldIndex = line.startsWith('2 ') ? 9 : 8
      const path =
        rest.split(' ').slice(pathFieldIndex).join(' ').trim() ||
        (line.split('\t')[0]?.split(' ').slice(pathFieldIndex).join(' ') ?? '')
      const staged = xy[0] !== '.'
      state.changes.push({ path: decoderCheminGit(path), status: classify(xy), staged })
    } else if (line.startsWith('u ')) {
      // "u XY <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>" : fichier en CONFLIT de fusion.
      const path = line.split(' ').slice(10).join(' ').trim()
      state.changes.push({ path: decoderCheminGit(path), status: 'conflicted', staged: false })
    } else if (line.startsWith('? ')) {
      const path = decoderCheminGit(line.slice(2).trim())
      state.changes.push({ path, status: 'untracked', staged: false })
    }
  }
  return state
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta'
export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** Numéro de ligne AVANT modification (absent pour un ajout / une ligne meta). */
  oldLine?: number
  /** Numéro de ligne APRÈS modification (absent pour une suppression / une ligne meta). */
  newLine?: number
}

/** Parse un diff unifié (`git diff --no-color`) en lignes typées pour un rendu coloré read-only. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = []
  // Compteurs de position tenus depuis l'en-tête de hunk `@@ -old,n +new,m @@` : c'est ce qui permet
  // de dire QUELLE ligne du fichier a changé, au lieu d'un simple +/- sans repère.
  let oldCursor = 0
  let newCursor = 0
  // Lignes encore attendues dans le hunk courant (tirées des longueurs de l'en-tête) : tant qu'il en
  // reste, « --- x » est une ligne RETIRÉE « -- x » et « +++ x » une ligne AJOUTÉE « ++ x », pas un en-tête.
  let oldRestant = 0
  let newRestant = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('@@')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (header) {
        oldCursor = Number(header[1])
        newCursor = Number(header[3])
        oldRestant = header[2] === undefined ? 1 : Number(header[2])
        newRestant = header[4] === undefined ? 1 : Number(header[4])
      }
      lines.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('\\')) {
      // « \ No newline at end of file » : annotation, ni ajout, ni suppression, ni contexte.
      lines.push({ kind: 'meta', text: line })
    } else if (oldRestant > 0 || newRestant > 0) {
      if (line.startsWith('+')) {
        lines.push({ kind: 'add', text: line, newLine: newCursor++ })
        newRestant--
      } else if (line.startsWith('-')) {
        lines.push({ kind: 'del', text: line, oldLine: oldCursor++ })
        oldRestant--
      } else {
        lines.push({ kind: 'context', text: line, oldLine: oldCursor++, newLine: newCursor++ })
        oldRestant--
        newRestant--
      }
    } else if (
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
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line, newLine: newCursor++ })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line, oldLine: oldCursor++ })
    else lines.push({ kind: 'context', text: line, oldLine: oldCursor++, newLine: newCursor++ })
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
