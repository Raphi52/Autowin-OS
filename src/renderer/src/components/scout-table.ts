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
  /** Note /100 normalisee quand la colonne Score en porte une de lisible. */
  score?: number
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
/**
 * Score → pastille : ≥70 vert, ≥40 jaune, sinon rouge — mais SEULEMENT si le score est interprétable
 * sur une échelle /100.
 *
 * Cause du bug corrigé : `cell.match(/\d+/)` prenait le PREMIER entier sans regarder l'échelle.
 * Déclencheurs constatés : « 8/10 » → 8 → pastille ROUGE alors que c'est excellent ; « #3 — 82 » → 3 →
 * rouge aussi. Une pastille fausse est pire qu'aucune pastille → `null` dès que ce n'est pas lisible.
 */
export function scoreSur100(cell: string): number | undefined {
  // Un rang « #3 » n'est pas un score : on le retire avant toute lecture de nombre.
  const cleaned = cell.replace(/#\s*\d+/g, ' ')
  const ratio = cleaned.match(/(\d+(?:[.,]\d+)?)\s*(?:\/|\bsur\b)\s*(\d+(?:[.,]\d+)?)/i)
  const num = (raw: string): number => Number(raw.replace(',', '.'))
  let score: number | undefined
  if (ratio) {
    const base = num(ratio[2])
    if (base <= 0) return undefined
    score = (num(ratio[1]) / base) * 100
  } else {
    const found = cleaned.match(/\d+(?:[.,]\d+)?/g)
    // Plusieurs nombres sans échelle explicite (« 82 (cf. 3 refs) ») = ambigu : on ne devine pas.
    if (!found || found.length !== 1) return undefined
    const value = num(found[0])
    // Un nombre nu ≤ 10 peut aussi bien être un /10 qu'un très mauvais /100 → non interprétable.
    if (value <= 10 && !/%/.test(cleaned)) return undefined
    score = value
  }
  if (!Number.isFinite(score) || score < 0 || score > 100) return undefined
  return score
}

/**
 * Pastille derivee de la note. Separee de `scoreSur100` pour que le NOMBRE reste disponible : le
 * panneau de selection l'affiche a cote du titre, et le jeter faisait disparaitre la note de chaque
 * ligne (regression vecue le 2026-08-18).
 */
export function scoreBand(cell: string): Band {
  const score = scoreSur100(cell)
  if (score === undefined) return null
  return score >= 70 ? 'g' : score >= 40 ? 'y' : 'r'
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
const isSeparator = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')

/** Cherche l'index de colonne dont l'en-tête matche un des mots-clés (insensible casse). */
function colOf(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)))
}

/**
 * Un en-tête n'est retenu que s'il est SUIVI d'un séparateur ET s'il porte réellement les colonnes
 * qu'on projette.
 *
 * Deux bugs corrigés ici :
 * 1. on ne prenait que le PREMIER candidat et on rendait `null` si son i+1 n'était pas un séparateur —
 *    une petite table de légende placée avant la vraie shortlist faisait perdre TOUT le rendu ;
 * 2. inversement, un tableau ÉTRANGER (« | Dimension | Score | Type | Note | ») était capturé à tort :
 *    `what`/`why`/`how` absents → toutes les colonnes sauf la 2ᵉ étaient silencieusement JETÉES et le
 *    contenu re-présenté comme une shortlist avec des pastilles inventées. D'où l'exigence de `what`
 *    PLUS l'une de `why`/`how`.
 */
/**
 * Colonnes qui jouent le role du « ou commencer » : le PREMIER PAS, mais aussi l'ANCRAGE et la
 * PREUVE. Mesure du 2026-08-19 en pilotant l'app : un scout a rendu
 * « Score | Type | Quoi | Ancrage fichier:ligne | Preuve que l'appelant manque », et le panneau a
 * cases a ete refuse en SILENCE — retombee en Markdown mort, sans aucun signal. La fonctionnalite
 * existait, testee et branchee, et devenait inatteignable des que le modele nommait ses colonnes
 * autrement. Un ancrage `fichier:ligne` EST un premier pas ; une preuve du manque EST la valeur.
 */
const COLONNES_DEPART = ['how', '1er pas', 'premier', 'first', 'ancrage', 'anchor', 'ou verifier']
const COLONNES_VALEUR = ['why', 'pourquoi', 'valeur', 'preuve', 'evidence', 'proof']

function isScoutHeader(headers: string[]): boolean {
  const joined = headers.join(' | ')
  const shape =
    (/impact/i.test(joined) && /effort|eff\./i.test(joined)) ||
    (/score/i.test(joined) && /what|type/i.test(joined))
  if (!shape) return false
  const hasWhat = colOf(headers, ['what', 'manquement', 'quoi', 'candidat']) >= 0
  const hasWhy = colOf(headers, COLONNES_VALEUR) >= 0
  const hasHow = colOf(headers, COLONNES_DEPART) >= 0
  // Un ancrage `fichier:ligne` nu, sans en-tete nommee, reste accepte : c'est la forme la plus
  // frequente et elle porte a elle seule le « ou commencer ».
  const ancrageNu = headers.some((h) => /fichier\s*:\s*ligne|file\s*:\s*line/i.test(h))
  return hasWhat && (hasWhy || hasHow || ancrageNu)
}

export function parseScoutTable(text: string): ScoutRow[] | null {
  const lines = text.split('\n')
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (!isTableRow(lines[i])) continue
    if (!isSeparator(lines[i + 1] ?? '')) continue
    if (!isScoutHeader(cells(lines[i]))) continue
    headerIdx = i
    break
  }
  if (headerIdx < 0) return null
  const headers = cells(lines[headerIdx])

  const iNum = colOf(headers, ['#', 'num'])
  const iImpact = colOf(headers, ['impact', 'imp.'])
  const iEffort = colOf(headers, ['effort', 'eff.'])
  const iScore = colOf(headers, ['score'])
  const iType = colOf(headers, ['type'])
  const iWhat = colOf(headers, ['what', 'manquement', 'quoi', 'candidat'])
  const iWhy = colOf(headers, COLONNES_VALEUR)
  const iHow = colOf(headers, COLONNES_DEPART)

  /**
   * Une ligne de STRUCTURE n'est pas un candidat.
   *
   * Mesure du 2026-08-19, en pilotant l'app : le scout a repete son en-tete TROIS fois et intercale
   * ses separateurs. Toute ligne `|...|` suivant l'en-tete etant prise pour une donnee, le panneau
   * affichait CINQ candidats a cocher pour UN seul vrai — les autres etant « Quoi » (un intitule de
   * colonne) et « --- » (un separateur). Deux d'entre eux ont ete coches et ont declenche une chaine
   * `/frame` complete, qui a du expliquer que « les deux candidats sont des lignes structurelles du
   * tableau, pas des sujets realisables ». Un candidat qui n'existe pas coute un tour entier.
   *
   * On SAUTE ces lignes au lieu de s'arreter : un separateur au milieu ne doit pas faire perdre les
   * candidats qui le suivent.
   */
  const memeQueEntete = (c: string[]): boolean =>
    c.length === headers.length &&
    c.every(
      (cellule, index) => cellule.trim().toLowerCase() === headers[index].trim().toLowerCase()
    )
  const separateur = (c: string[]): boolean =>
    c.length > 0 && c.every((cellule) => /^:?-{2,}:?$/u.test(cellule.trim()))

  const rows: ScoutRow[] = []
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!isTableRow(lines[i])) break
    const c = cells(lines[i])
    if (separateur(c) || memeQueEntete(c)) continue
    /**
     * UNE LIGNE INCOMPLETE N'EST PAS UN CANDIDAT.
     *
     * `isTableRow` accepte une ligne sur son SEUL `|` d'ouverture : la derniere ligne d'un tableau
     * coupe par un stream interrompu la franchit, et le repli `at(idx, '')` remplissait alors de
     * vides les colonnes absentes. Mesure du 2026-08-27 (conv-1475) : un 7e candidat dont le
     * « Pourquoi » s'arretait en plein mot (« chaque onglet visite reste MONTE dan ») est devenu
     * COCHABLE et a lance une chaine `/frame` sur un besoin ampute, sans aucun signal. Mieux vaut
     * six candidats entiers qu'un septieme qu'on croit lisible.
     */
    if (c.length < headers.length) continue
    const at = (idx: number, fallback = ''): string =>
      idx >= 0 && idx < c.length ? c[idx] : fallback
    const note = iScore >= 0 ? scoreSur100(at(iScore)) : undefined
    rows.push({
      num: at(iNum, String(rows.length + 1)),
      ...(note === undefined ? {} : { score: note }),
      // Une colonne « Score » peut porter un NOMBRE (« 82 », « 8/10 ») ou une PASTILLE (« 🟢 ») :
      // constate le 2026-08-18 (conv-1293), le modele met souvent la pastille. Le nombre reste
      // prioritaire ; a defaut on relit la meme cellule comme un emoji, plutot que de rendre une
      // ligne sans aucun repere. On n'invente PAS de note depuis une pastille (`score` reste vide) :
      // ce serait une precision fausse.
      impact: iImpact >= 0 ? band(at(iImpact)) : (scoreBand(at(iScore)) ?? band(at(iScore))),
      effort: iEffort >= 0 ? band(at(iEffort)) : null,
      type: scoutType(at(iType)),
      // `iWhat` est garanti présent par `isScoutHeader` : plus de repli sur la colonne 1 « au hasard ».
      what: at(iWhat),
      why: at(iWhy),
      how: at(iHow)
    })
  }
  return rows.length ? rows : null
}
