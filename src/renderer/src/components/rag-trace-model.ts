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
  engine: 'Amitel Brain'
  query: string
  injectedCharacters: number
  sources: RagSourceTrace[]
}

const MARKER = '[AMITEL BRAIN REFERENCE DATA'
const SOURCE = /^### Source\s+(\d+)\s+(?:—|-)\s+(.+)\r?$/gm

function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, found))
  else if (value && typeof value === 'object')
    Object.values(value as Record<string, unknown>).forEach((item) => stringsIn(item, found))
  return found
}

function empty(status: RagTraceStatus): RagTraceSummary {
  return {
    status,
    engine: 'Amitel Brain',
    query: '',
    injectedCharacters: 0,
    sources: []
  }
}

export function summarizeRagTrace(request: unknown): RagTraceSummary {
  if (!request || typeof request !== 'object') return empty('unavailable')
  const marked = stringsIn(request).find((value) => value.includes(MARKER))
  if (!marked) return empty('not-injected')

  const markerIndex = marked.indexOf(MARKER)
  const query = marked.slice(0, markerIndex).trim()
  const context = marked.slice(markerIndex)
  const matches = [...context.matchAll(SOURCE)]
  const sources = matches.map((match, index) => {
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

  return {
    status: sources.length > 0 ? 'injected' : 'unparseable',
    engine: 'Amitel Brain',
    query,
    injectedCharacters: context.length,
    sources
  }
}
