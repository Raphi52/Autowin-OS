/**
 * Parse le tableau markdown d'un retour "scout" (shortlist rankée) en lignes structurées, pour le
 * rendre comme un VRAI tableau à pastilles (design "Ledger dense", façon Claude Code) au lieu du
 * tableau markdown brut. PUR (aucune dépendance) → testable directement.
 *
 * Reconnaît un tableau markdown dont l'en-tête contient « Impact » ET « Effort » (la signature d'un
 * scout). Chaque ligne → { num, impact, effort, type, what, why, how }.
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
    (l) => isTableRow(l) && /impact/i.test(l) && /effort|eff\./i.test(l)
  )
  if (headerIdx < 0) return null
  const headers = cells(lines[headerIdx])
  if (!isSeparator(lines[headerIdx + 1] ?? '')) return null

  const iNum = colOf(headers, ['#', 'num'])
  const iImpact = colOf(headers, ['impact', 'imp.'])
  const iEffort = colOf(headers, ['effort', 'eff.'])
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
      impact: band(at(iImpact)),
      effort: band(at(iEffort)),
      type: scoutType(at(iType)),
      what: at(iWhat, c[iWhat >= 0 ? iWhat : 1] ?? ''),
      why: at(iWhy),
      how: at(iHow)
    })
  }
  return rows.length ? rows : null
}
