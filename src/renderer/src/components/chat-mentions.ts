/**
 * Mentions de contexte du composer : `@run…` / `@fichier…`.
 *
 * Pourquoi : un prompt unique échoue surtout parce que l'utilisateur DÉCRIT ses cibles au lieu de
 * les DÉSIGNER. La palette de mentions donne les cibles réellement présentes dans l'état (runs déjà
 * chargés, pièces jointes / chemins déjà cités) et insère une référence RÉSOLUE, non ambiguë.
 *
 * 100 % pur (aucun React, aucun IPC) → testable directement. Calqué sur `matchSlashCommands`.
 */

export type MentionKind = 'run' | 'file'

export interface MentionCandidate {
  kind: MentionKind
  /** Identifiant stable inséré dans le prompt (sujet de run, chemin de fichier). */
  id: string
  /** Libellé affiché dans la palette. */
  label: string
  /** Précision affichée à droite (statut du run, taille du fichier…). */
  hint?: string
}

export interface MentionSources {
  runs: MentionCandidate[]
  files: MentionCandidate[]
}

export interface MentionQuery {
  /** Index du `@` dans le texte. */
  start: number
  /** Ce qui est tapé après le `@` (sans le `@`). */
  query: string
}

const MENTION_LIMIT = 8

/** Un `@` ne déclenche une mention que s'il commence un mot (début de texte ou blanc devant). */
export function activeMentionQuery(
  input: string,
  caret: number = input.length
): MentionQuery | null {
  const pos = Math.max(0, Math.min(caret, input.length))
  const at = input.lastIndexOf('@', pos - 1)
  if (at < 0) return null
  if (at > 0 && !/\s/.test(input[at - 1])) return null
  const query = input.slice(at + 1, pos)
  // Une mention ne franchit ni un blanc ni une seconde `@`.
  if (/[\s@]/.test(query)) return null
  return { start: at, query }
}

function prefixKind(query: string): { kind?: MentionKind; needle: string } {
  const m = /^(run|fichier|file)[:/]?(.*)$/i.exec(query)
  if (!m) return { needle: query }
  const head = m[1].toLowerCase()
  return { kind: head === 'run' ? 'run' : 'file', needle: m[2] }
}

function scoreMatch(candidate: MentionCandidate, needle: string): boolean {
  if (!needle) return true
  const n = needle.toLowerCase()
  return candidate.id.toLowerCase().includes(n) || candidate.label.toLowerCase().includes(n)
}

/**
 * Candidats pour la mention en cours de frappe. `[]` = pas de palette (rien tapé après `@`, ou
 * aucune cible). Les runs passent avant les fichiers : c'est la cible la plus coûteuse à retaper.
 */
export function matchMentions(
  input: string,
  sources: MentionSources,
  caret: number = input.length
): MentionCandidate[] {
  const active = activeMentionQuery(input, caret)
  if (!active) return []
  const { kind, needle } = prefixKind(active.query)
  const pool =
    kind === 'run'
      ? sources.runs
      : kind === 'file'
        ? sources.files
        : [...sources.runs, ...sources.files]
  return pool.filter((c) => scoreMatch(c, needle)).slice(0, MENTION_LIMIT)
}

/** Référence textuelle insérée dans le prompt (et re-résolue à l'envoi). */
function mentionRef(candidate: MentionCandidate): string {
  return `@${candidate.kind === 'run' ? 'run' : 'fichier'}:${candidate.id}`
}

/** Remplace la mention en cours de frappe par la référence résolue, et rend le nouveau curseur. */
export function applyMention(
  input: string,
  candidate: MentionCandidate,
  caret: number = input.length
): { text: string; caret: number } {
  const active = activeMentionQuery(input, caret)
  const ref = `${mentionRef(candidate)} `
  if (!active) return { text: input + ref, caret: input.length + ref.length }
  const pos = Math.max(0, Math.min(caret, input.length))
  const text = input.slice(0, active.start) + ref + input.slice(pos)
  return { text, caret: active.start + ref.length }
}

const PATH_RE = /(?:^|[\s"'`(])((?:[\w.-]+\/)+[\w.-]+\.\w{1,6})/g

/**
 * Sources de mentions dérivées de l'état DÉJÀ en mémoire : aucun nouvel IPC, aucun balayage disque.
 * - runs : ceux que le panneau workflows a déjà chargés ;
 * - fichiers : pièces jointes courantes + chemins cités dans les messages récents.
 */
export function buildMentionSources(input: {
  runs?: Array<{ subject: string; summary?: { status?: string } }>
  attachments?: Array<{ name: string }>
  citedTexts?: string[]
}): MentionSources {
  const runs: MentionCandidate[] = (input.runs ?? []).map((r) => ({
    kind: 'run',
    id: r.subject,
    label: r.subject,
    hint: r.summary?.status
  }))
  const files: MentionCandidate[] = []
  const seen = new Set<string>()
  const push = (id: string, label: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    files.push({ kind: 'file', id, label })
  }
  for (const a of input.attachments ?? []) push(a.name, a.name)
  for (const text of input.citedTexts ?? [])
    for (const m of text.matchAll(PATH_RE)) push(m[1], m[1].split('/').pop() ?? m[1])
  return { runs, files }
}

const REF_RE = /@(run|fichier|file):([^\s]+)/g

/** Les références présentes dans un texte, résolues contre les sources connues. */
export function collectMentionRefs(text: string, sources: MentionSources): MentionCandidate[] {
  const out: MentionCandidate[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(REF_RE)) {
    const kind: MentionKind = m[1].toLowerCase() === 'run' ? 'run' : 'file'
    const id = m[2]
    const key = `${kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const pool = kind === 'run' ? sources.runs : sources.files
    out.push(pool.find((c) => c.id === id) ?? { kind, id, label: id })
  }
  return out
}

/**
 * Prompt effectivement ENVOYÉ : le texte tapé, suivi d'un bloc de contexte explicite listant les
 * cibles désignées. Sans mention, le texte est rendu inchangé (aucun bruit ajouté).
 */
export function resolveMentionsForSend(text: string, sources: MentionSources): string {
  const refs = collectMentionRefs(text, sources)
  if (refs.length === 0) return text
  const lines = refs.map((r) =>
    r.kind === 'run' ? `- run ${r.id}${r.hint ? ` (${r.hint})` : ''}` : `- fichier ${r.id}`
  )
  return `${text}\n\n[contexte désigné]\n${lines.join('\n')}`
}
