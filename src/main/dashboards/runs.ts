// Parseur de RUN.md pour le dashboard des runs vivants (candidat ④/visu workflow).

/** Résumé normalisé d'un RUN.md pour affichage dashboard. */
export type RunSummary = {
  status: 'open' | 'red' | 'green' | 'degraded-closed' | 'unknown'
  regime?: string
  dodTotal: number
  dodChecked: number
  journalEvents: number
  defauts: number
  subject?: string
}

const STATUSES = new Set(['open', 'red', 'green', 'degraded-closed'])

/**
 * Extrait les lignes d'une section `## Heading` jusqu'au prochain heading `## `
 * (ou la fin du document).
 */
function extractSection(lines: string[], heading: string): string[] {
  // Match le heading exact OU avec un suffixe (« ## Besoin (Phase 1 — …) ») :
  // sinon un titre de section annoté ferait rater tout le contenu (DoD 0/0).
  const startIdx = lines.findIndex((l) => {
    const t = l.trim()
    return t === heading || t.startsWith(heading + ' ')
  })
  if (startIdx === -1) return []

  const section: string[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) break
    section.push(line)
  }
  return section
}

/**
 * Parse un RUN.md (format kit Autowin) en RunSummary.
 * - status/regime lus depuis les lignes `status: X` / `regime: X`.
 * - DoD compté sous `## Besoin` (cases `- [ ]` / `- [x]`).
 * - journalEvents = lignes commençant par `[` sous `## Journal`.
 * - defauts = lignes non vides/non-commentaire sous `## Défauts`.
 */
export function parseRun(md: string, subject?: string): RunSummary {
  const lines = md.split(/\r?\n/)

  let status: RunSummary['status'] = 'unknown'
  let regime: string | undefined

  // status/regime ne sont lus que dans le HEADER (avant le 1er heading `## `) :
  // sinon un `status:` en texte libre dans le Journal fausserait le dashboard.
  const firstHeading = lines.findIndex((l) => l.startsWith('## '))
  const headerLines = firstHeading === -1 ? lines : lines.slice(0, firstHeading)

  for (const line of headerLines) {
    const statusMatch = line.match(/^\s*status:\s*(\S+)/i)
    if (statusMatch && status === 'unknown') {
      const value = statusMatch[1].toLowerCase()
      if (STATUSES.has(value)) {
        status = value as RunSummary['status']
      }
    }

    const regimeMatch = line.match(/^\s*regime:\s*(\S+)/i)
    if (regimeMatch && regime === undefined) {
      regime = regimeMatch[1]
    }
  }

  const besoinLines = extractSection(lines, '## Besoin')
  let dodTotal = 0
  let dodChecked = 0
  for (const line of besoinLines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
      dodTotal++
      dodChecked++
    } else if (trimmed.startsWith('- [ ]')) {
      dodTotal++
    }
  }

  const journalLines = extractSection(lines, '## Journal')
  const journalEvents = journalLines.filter((l) => l.trim().startsWith('[')).length

  const defautsLines = extractSection(lines, '## Défauts')
  const defauts = defautsLines.filter((l) => {
    const trimmed = l.trim()
    return trimmed.length > 0 && !trimmed.startsWith('<!--') && !trimmed.startsWith('//')
  }).length

  return { status, regime, dodTotal, dodChecked, journalEvents, defauts, subject }
}

/** True si le run est bloqué : status open/red, ou DoD incomplète. */
export function isBlocked(s: RunSummary): boolean {
  return s.status === 'open' || s.status === 'red' || s.dodChecked < s.dodTotal
}
