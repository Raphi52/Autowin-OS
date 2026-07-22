export type RagTraceStatus = 'injected' | 'not-injected' | 'unparseable' | 'unavailable'

export interface RagSourceTrace {
  rank: number
  path: string
  type: string
  scope: string
  author: string
  date: string
}

export interface RagTraceSummary {
  status: RagTraceStatus
  engine: 'Amitel Brain' | 'Contexte projet'
  query: string
  injectedCharacters: number
  sources: RagSourceTrace[]
}

const MARKER = '[AMITEL BRAIN REFERENCE DATA'
// Canal fichier de contexte projet (context-files.ts:79 → `=== CONTEXTE PROJET (<fichier>) ===`).
// Distinct du RAG Brain mais c'est bien du contexte INJECTÉ : sans cette détection, la carte
// affichait un faux « Non utilisé » alors qu'un CLAUDE.md/AGENTS.md était bien transmis au modèle.
const PROJECT_MARKER = /=== CONTEXTE PROJET \(([^)]*)\) ===/
const FILE_PREFIX = /^file:/i
const MARKDOWN_EXTENSION = /\.md$/i
const SOURCE = /^### Source\s+(\d+)\s+(?:—|-)\s+(.+)\r?$/gm

function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, found))
  else if (value && typeof value === 'object')
    Object.values(value as Record<string, unknown>).forEach((item) => stringsIn(item, found))
  return found
}

function empty(status: RagTraceStatus, engine: RagTraceSummary['engine'] = 'Amitel Brain'): RagTraceSummary {
  return {
    status,
    engine,
    query: '',
    injectedCharacters: 0,
    sources: []
  }
}

/** Détecte le canal « contexte projet » (CLAUDE.md/AGENTS.md/…) injecté hors RAG Brain. */
function summarizeProjectContext(request: object): RagTraceSummary | null {
  const marked = stringsIn(request).find((value) => PROJECT_MARKER.test(value))
  if (!marked) return null
  const match = PROJECT_MARKER.exec(marked)
  const file = match?.[1]?.trim() || 'fichier de contexte'
  // Borne le bloc au PROCHAIN délimiteur `=== …` (ou fin) : ne pas supposer que CONTEXTE PROJET
  // est le dernier bloc concaténé — sinon injectedCharacters gonfle avec tout ce qui suit.
  const start = marked.indexOf(match?.[0] ?? '')
  const rest = marked.slice(start)
  const next = rest.indexOf('\n=== ', (match?.[0]?.length ?? 0))
  const block = next === -1 ? rest : rest.slice(0, next)
  return {
    status: 'injected',
    engine: 'Contexte projet',
    query: '',
    injectedCharacters: block.length,
    sources: [{ rank: 1, path: file, type: 'contexte projet', scope: '', author: '', date: '' }]
  }
}

export function canonicalRagSourcePath(path: string): string {
  return path
    .trim()
    .replace(FILE_PREFIX, '')
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(MARKDOWN_EXTENSION, '')
    .toLocaleLowerCase('fr-FR')
}

export function summarizeRagTrace(request: unknown): RagTraceSummary {
  if (!request || typeof request !== 'object') return empty('unavailable')
  const marked = stringsIn(request).find((value) => value.includes(MARKER))
  // Pas de RAG Brain → replier sur le canal contexte projet avant de conclure « non injecté ».
  if (!marked) return summarizeProjectContext(request) ?? empty('not-injected')

  const markerIndex = marked.indexOf(MARKER)
  const query = marked.slice(0, markerIndex).trim()
  const context = marked.slice(markerIndex)
  const matches = [...context.matchAll(SOURCE)]
  const parsedSources = matches.map((match, index) => {
    const segmentStart = (match.index ?? 0) + match[0].length
    const segmentEnd = matches[index + 1]?.index ?? context.length
    const segment = context.slice(segmentStart, segmentEnd)
    const provenance = segment.match(/^Provenance:\s*(.*)$/m)?.[1] ?? ''
    const [type = '', scope = '', author = '', date = ''] = provenance
      .split('|')
      .map((part) => part.trim())
    return {
      rank: Number(match[1]),
      path: match[2].trim(),
      type,
      scope,
      author,
      date
    }
  })
  const seen = new Set<string>()
  const sources = parsedSources.filter((source) => {
    const key = canonicalRagSourcePath(source.path)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    status: sources.length > 0 ? 'injected' : 'unparseable',
    engine: 'Amitel Brain',
    query,
    injectedCharacters: context.length,
    sources
  }
}
