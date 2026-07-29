/**
 * Parse le tableau markdown d'un retour "scout" (shortlist rankée) en lignes structurées, pour le
 * rendre comme un VRAI tableau à pastilles (design "Ledger dense", façon Claude Code) au lieu du
 * tableau markdown brut. PUR (aucune dépendance) → testable directement.
 *
 * Reconnaît un tableau markdown dont l'en-tête contient « Impact » ET « Effort », OU « Score » avec
 * « What »/« Type » (format du brief scout src/main/phase-briefs.ts). Chaque ligne →
 * { num, impact, effort, type, what, why, how } ; un Score /100 est mappé en pastille impact
 * (≥70 vert, ≥40 jaune, sinon rouge) et effort reste null.
 */

export type Band = 'g' | 'y' | 'r' | null
export type ScoutType = 'fix' | 'new' | null
export interface ScoutRow {
  num: string
  impact: Band
  effort: Band
  type: ScoutType
  what: string
  why: string
  how: string
}

function band(cell: string): Band {
  if (cell.includes('🟢')) return 'g'
  if (cell.includes('🟡')) return 'y'
  if (cell.includes('🔴')) return 'r'
  return null
}
/** Score /100 (format « Score | Type | What | Why | How ») → pastille : ≥70 vert, ≥40 jaune, sinon rouge. */
function scoreBand(cell: string): Band {
  const m = cell.match(/\d+/)
  if (!m) return null
  const n = Number(m[0])
  return n >= 70 ? 'g' : n >= 40 ? 'y' : 'r'
}
function scoutType(cell: string): ScoutType {
  if (cell.includes('🆕') || /\bnew\b/i.test(cell)) return 'new'
  if (cell.includes('🔧') || /\bfix\b/i.test(cell)) return 'fix'
  return null
}
function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split('|').map((c) => c.trim())
}
const isTableRow = (line: string): boolean => line.trim().startsWith('|')
const isSeparator = (line: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')

/** Cherche l'index de colonne dont l'en-tête matche un des mots-clés (insensible casse). */
function colOf(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)))
}

export function parseScoutTable(text: string): ScoutRow[] | null {
  const lines = text.split('\n')
  const headerIdx = lines.findIndex(
    (l) =>
      isTableRow(l) &&
      ((/impact/i.test(l) && /effort|eff\./i.test(l)) || (/score/i.test(l) && /what|type/i.test(l)))
  )
  if (headerIdx < 0) return null
  const headers = cells(lines[headerIdx])
  if (!isSeparator(lines[headerIdx + 1] ?? '')) return null

  const iNum = colOf(headers, ['#', 'num'])
  const iImpact = colOf(headers, ['impact', 'imp.'])
  const iEffort = colOf(headers, ['effort', 'eff.'])
  const iScore = colOf(headers, ['score'])
  const iType = colOf(headers, ['type'])
  const iWhat = colOf(headers, ['what', 'manquement', 'quoi', 'candidat'])
  const iWhy = colOf(headers, ['why', 'pourquoi', 'valeur'])
  const iHow = colOf(headers, ['how', '1er pas', 'premier', 'first'])

  const rows: ScoutRow[] = []
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!isTableRow(lines[i])) break
    const c = cells(lines[i])
    const at = (idx: number, fallback = ''): string => (idx >= 0 && idx < c.length ? c[idx] : fallback)
    rows.push({
      num: at(iNum, String(rows.length + 1)),
      impact: iImpact >= 0 ? band(at(iImpact)) : scoreBand(at(iScore)),
      effort: iEffort >= 0 ? band(at(iEffort)) : null,
      type: scoutType(at(iType)),
      what: at(iWhat, c[iWhat >= 0 ? iWhat : 1] ?? ''),
      why: at(iWhy),
      how: at(iHow)
    })
  }
  return rows.length ? rows : null
}
