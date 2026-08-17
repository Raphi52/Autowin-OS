import { fromMarkdown } from 'mdast-util-from-markdown'

/**
 * CARTE DE LIVRAISON d'une orchestration — les faits, pas une formule.
 *
 * Défaut mesuré sur conv-76 (2026-07-29) : 18 appels de sous-agents, 10,05 $ dépensés, et le fil
 * affichait « Workflow Autowin exécuté. » L'orchestrateur retourne pourtant statut, validité, blocage
 * de gate, coût, chemin du RUN et résultat — tout était jeté. C'est 92 % de la dépense d'une
 * conversation dont l'utilisateur ne voyait strictement rien.
 *
 * Partagé (`shared/`) parce que le main le formate et que le renderer en résume la version courte :
 * une seule définition de ce qui compte, pas deux qui divergent.
 */

export interface OrchestrationOutcome {
  status?: unknown
  valid?: unknown
  gateBlocked?: unknown
  costUsd?: unknown
  /** Somme des seuls appels tarifés ; null signifie qu'aucun prix n'est exposé. */
  knownCostUsd?: unknown
  /** Appels dont les tokens sont connus mais dont le fournisseur n'expose pas le prix. */
  unpricedCalls?: unknown
  runPath?: unknown
  runId?: unknown
  result?: unknown
  reused?: unknown
  learning?: {
    state?: unknown
    detail?: unknown
    candidateId?: unknown
    knowledgeId?: unknown
  }
  error?: unknown
}

export const ORCHESTRATION_ALREADY_ISSUED_REFUSAL =
  'Une orchestration a deja ete lancee dans ce tour. Termine avec son resultat ; un nouveau run exige un nouveau message utilisateur.'

export const AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX =
  'Clôture Autowin : gate validé, RUN fermé green'

const CLOSURE_LEADING_DECORATIONS =
  /^(?:(?:#{1,6}|>|[-+*•]|\d+[.)])\s+|\[[ xX]\]\s+|(?:✅|⚠️?|🧪)\s*|(?:\*\*|__|\*|_)\s*)+/u

const MARKDOWN_INLINE_WRAPPER_SOURCE = '(?:\\*\\*|__|\\*|_|\\[|\\](?:\\([^\\n)]*\\))?)'

const MARKDOWN_PUBLICATION_TERMINATED_SOURCE =
  `(?:(?:${MARKDOWN_INLINE_WRAPPER_SOURCE}\\s*)*publication\\s+` +
  `(?:${MARKDOWN_INLINE_WRAPPER_SOURCE}\\s*)*termin[ée]e` +
  `(?:\\s*${MARKDOWN_INLINE_WRAPPER_SOURCE})*)`

const AUTHORITATIVE_CLOSURE_SUFFIX_SOURCE = `(?:${MARKDOWN_PUBLICATION_TERMINATED_SOURCE}|aucune\\s+autre\\s+orchestration\\s+ni\\s+aucun\\s+second\\s+judge\\s+ne\\s+sont\\s+n[ée]cessaires\\s+dans\\s+ce\\s+tour)`

const AUTHORITATIVE_CLOSURE_BOUNDARY_SOURCE =
  '(?:\\s*\\.(?=\\s|$|[*_])|(?=\\s*(?:$|[,;:|·/—-]))|(?=\\s+(?:[ée]chec|erreur|interrompu|annul[ée]|failed|interrupted|cancelled)\\b))'

const AUTHORITATIVE_CLOSURE_PATTERN = new RegExp(
  `${AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX}(?:\\s*;\\s*${AUTHORITATIVE_CLOSURE_SUFFIX_SOURCE}${AUTHORITATIVE_CLOSURE_BOUNDARY_SOURCE}|${AUTHORITATIVE_CLOSURE_BOUNDARY_SOURCE})`,
  'iu'
)

export interface OrchestrationClosureSpan {
  start: number
  end: number
}

interface MarkdownAstNode {
  type?: string
  lang?: string | null
  position?: {
    start?: { line?: number; offset?: number }
    end?: { line?: number; offset?: number }
  }
  children?: MarkdownAstNode[]
}

interface PreservedTextLine {
  text: string
  ending: string
  originalIndex: number
  protected: boolean
}

function splitTextLines(text: string, protectedLines: ReadonlySet<number>): PreservedTextLine[] {
  if (!text) return [{ text: '', ending: '', originalIndex: 0, protected: false }]
  const lines: PreservedTextLine[] = []
  let start = 0
  let index = 0
  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    if (newline < 0) {
      lines.push({
        text: text.slice(start),
        ending: '',
        originalIndex: index,
        protected: protectedLines.has(index + 1)
      })
      break
    }
    const crlf = newline > start && text[newline - 1] === '\r'
    lines.push({
      text: text.slice(start, crlf ? newline - 1 : newline),
      ending: crlf ? '\r\n' : '\n',
      originalIndex: index,
      protected: protectedLines.has(index + 1)
    })
    start = newline + 1
    index += 1
  }
  return lines
}

/** Les lignes `code` du même parseur CommonMark que la pile ReactMarkdown. */
export function markdownCodeLineProtection(reports: readonly string[]): Array<Set<number>> {
  const lineCounts = reports.map((report) => report.split(/\r?\n/u).length)
  const starts: number[] = []
  let nextStart = 1
  for (const count of lineCounts) {
    starts.push(nextStart)
    nextStart += count
  }
  const protectedLines = reports.map(() => new Set<number>())
  try {
    const tree = fromMarkdown(reports.join('\n')) as MarkdownAstNode
    const visit = (node: MarkdownAstNode): void => {
      const start = node.position?.start?.line
      const end = node.position?.end?.line
      if (node.type === 'code' && start !== undefined && end !== undefined) {
        for (let reportIndex = 0; reportIndex < reports.length; reportIndex += 1) {
          const reportStart = starts[reportIndex]
          const reportEnd = reportStart + lineCounts[reportIndex] - 1
          const overlapStart = Math.max(start, reportStart)
          const overlapEnd = Math.min(end, reportEnd)
          for (let line = overlapStart; line <= overlapEnd; line += 1) {
            protectedLines[reportIndex].add(line - reportStart + 1)
          }
        }
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  } catch {
    // En cas d'entrée illisible, ne jamais détruire une preuve potentielle.
    return lineCounts.map(
      (count) => new Set(Array.from({ length: count }, (_, index) => index + 1))
    )
  }
  return protectedLines
}

/**
 * Préfixe de fence à réinjecter quand un fragment texte commence au milieu d'un bloc fenced.
 * Les actions restent des cartes séparées dans le DOM, mais elles ne doivent pas réinitialiser la
 * grammaire Markdown que l'hydratation a projetée sur le flux texte complet.
 */
export function markdownCodeContinuationPrefixes(
  reports: readonly string[]
): Array<string | undefined> {
  const lineCounts = reports.map((report) => report.split(/\r?\n/u).length)
  const starts: number[] = []
  let nextStart = 1
  for (const count of lineCounts) {
    starts.push(nextStart)
    nextStart += count
  }
  const prefixes = reports.map(() => undefined as string | undefined)
  const source = reports.join('\n')
  const lines = source.split(/\r?\n/u)
  try {
    const tree = fromMarkdown(source) as MarkdownAstNode
    const visit = (node: MarkdownAstNode): void => {
      if (node.type === 'code') {
        const start = node.position?.start?.line
        const end = node.position?.end?.line
        const offset = node.position?.start?.offset
        const fenced = offset !== undefined && /^(?:`{3,}|~{3,})/u.test(source.slice(offset))
        // Une fence `html-render` n'est exécutable que si son document complet reste dans un seul
        // bloc visuel. La recréer artificiellement après une carte action/artefact pourrait exécuter
        // un suffixe HTML privé de son contexte et produire un DOM différent de la source jointe.
        if (fenced && start !== undefined && end !== undefined) {
          const openingLine = lines[start - 1]
          const continuationPrefix =
            node.lang?.toLowerCase() === 'html-render'
              ? openingLine.replace(/html-render/iu, 'html')
              : openingLine
          for (let index = 1; index < starts.length; index += 1) {
            if (starts[index] > start && starts[index] <= end && prefixes[index] === undefined) {
              prefixes[index] = continuationPrefix
            }
          }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  } catch {
    // La protection principale échoue déjà fermée ; sans projection fiable, ne pas inventer de
    // fence de continuation qui pourrait activer `html-render`.
  }
  return prefixes
}

/** Réécrit seulement les lignes hors code, sans normaliser les octets des lignes protégées. */
export function rewriteUnprotectedMarkdownLines(
  text: string,
  protectedLines: ReadonlySet<number>,
  rewrite: (line: string) => string | undefined
): string {
  const original = splitTextLines(text, protectedLines)
  let changed = false
  const rewritten = original.flatMap((line): PreservedTextLine[] => {
    if (line.protected) return [line]
    const next = rewrite(line.text)
    if (next === line.text) return [line]
    changed = true
    return next === undefined ? [] : [{ ...line, text: next }]
  })
  if (!changed) return text
  const kept = rewritten.filter((line, index) => {
    if (line.protected || line.text.trim()) return true
    const previous = rewritten[index - 1]
    return !previous || previous.protected || previous.text.trim().length > 0
  })
  while (kept[0] && !kept[0].protected && !kept[0].text.trim()) kept.shift()
  while (kept.at(-1) && !kept.at(-1)?.protected && !kept.at(-1)?.text.trim()) kept.pop()
  const last = kept.at(-1)
  if (last && last.originalIndex < original.length - 1) last.ending = ''
  return kept.map((line) => `${line.text}${line.ending}`).join('')
}

/** Localise une vraie clause de clôture, mais jamais sa citation entre guillemets ou backticks. */
export function authoritativeOrchestrationClosureSpan(
  line: string
): OrchestrationClosureSpan | undefined {
  const searchable = line.replace(
    /«[^»\n]*»|"(?:\\.|[^"\\\n])*"|(?<![\p{L}\p{N}])'(?:\\.|[^'\\\n])*'|`[^`\n]*`/gu,
    (quoted) => ' '.repeat(quoted.length)
  )
  const match = AUTHORITATIVE_CLOSURE_PATTERN.exec(searchable)
  return match ? { start: match.index, end: match.index + match[0].length } : undefined
}

export function isAuthoritativeOrchestrationClosureLine(line: string): boolean {
  const candidate = line.trimStart().replace(CLOSURE_LEADING_DECORATIONS, '')
  return authoritativeOrchestrationClosureSpan(candidate)?.start === 0
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asCallCount(value: unknown): number {
  const count = asNumber(value)
  return count === undefined ? 0 : Math.max(0, Math.floor(count))
}

const PROOF_DECORATION_PREFIX =
  /^(?:(?:[-+*>•]|\d+[.)])\s+|\[[ xX]\]\s+|(?:✅|⚠️?|🧪)\s*|\|\s*|(?:\*\*|__|\*|_))+/u

function maskQuotedEvidence(text: string): string {
  return text.replace(
    /«[^»\n]*»|"(?:\\.|[^"\\\n])*"|(?<![\p{L}\p{N}])'(?:\\.|[^'\\\n])*'/gu,
    (quoted) => ' '.repeat(quoted.length)
  )
}

const RUN_LIFECYCLE_ASSERTION_SOURCE =
  'run\\s+(?:est\\s+)?(?:(?:(?:reste|toujours)\\s+)?(?:(?:standard\\s*\\/\\s*)?(?:open|ouvert))|encore\\s+ouvert)'

const LIFECYCLE_ASSERTION_SOURCE = `(?:${RUN_LIFECYCLE_ASSERTION_SOURCE}|(?:next|[ée]tape\\s+suivante|prochaine\\s+[ée]tape)\\s*:?[^\\n]*(?:commit(?:\\s+final)?|push|publication|livraison)|non\\s+(?:publi[ée]e?s?|commit[ée]e?s?)|publication\\s+(?:est\\s+)?(?:reste|non\\s+ex[ée]cut(?:[ée]e?s?)?|en\\s+attente|[àa]\\s+faire)|(?:modifications?|changements?)\\s+non\\s+(?:publi[ée]e?s?|commit[ée]e?s?)|(?:les\\s+)?changements?\\s+(?:(?:ne\\s+sont\\s+)?pas\\s+encore|non)\\s+publi[ée]s?|gate\\s+(?:est\\s+)?(?:(?:reste|toujours|encore)\\s+)?bloqu[ée]|(?:autoriser|d[ée]clencher)\\s+(?:la\\s+)?publication|(?:lancer|relancer)\\s+(?:le\\s+)?judge|judge\\s+[àa]\\s+lancer|judge[^\\n]*(?:refus[ée]|reste|non\\s+cl[oô]tur)|clean\\s+(?:puis|et)\\s+judge|encha[iî]ner\\s+clean[^\\n]*judge)`

const LIFECYCLE_WRAPPED_SOURCE =
  '(?:(?:\\*\\*|__|~~|\\*|_|\\[|`|\\/)\\s*)*' +
  LIFECYCLE_ASSERTION_SOURCE +
  '(?:\\s*(?:\\*\\*|__|~~|\\*|_|`|\\/|\\](?:\\([^\\n)]*\\))?))*'

const NEGATED_LIFECYCLE_BEFORE = new RegExp(
  `\\b(?:absence\\s+de|(?:aucune|z[ée]ro)\\s+(?:occurrence|mention)\\s+de|sans\\s+(?:occurrence|mention)\\s+de|il\\s+n['’]y\\s+a\\s+plus\\s+de)\\s+${LIFECYCLE_WRAPPED_SOURCE}`,
  'giu'
)

const NEGATED_LIFECYCLE_AFTER = new RegExp(
  `${LIFECYCLE_WRAPPED_SOURCE}\\s+(?:(?:(?:est|reste)\\s+)?(?:absent(?:e)?|introuvable|supprim[ée]e?|exclu(?:e)?|faux|fausse)|a\\s+disparu|n['’]appara[iî]t\\s+plus|n['’]est\\s+(?:pas\\s+pr[ée]sent|plus\\s+vrai)|ne\\s+(?:matche|correspond|contient|comprend|affiche|figure)\\s+(?:plus|pas)|=\\s*(?:false|0\\s+occurrences?))`,
  'giu'
)

const FORMATTED_LIFECYCLE_REFERENCE = /`[^`\n]+`|\[[^\]\n]+\]\([^)\n]*\)|\/[^/\n]+\/[a-z]*/giu

const ACTIVE_LIFECYCLE = new RegExp(
  `(?<![\\p{L}\\p{N}])${LIFECYCLE_ASSERTION_SOURCE}(?![\\p{L}\\p{N}])`,
  'iu'
)

const ACTIVE_RUN_LIFECYCLE = new RegExp(
  `(?<![\\p{L}\\p{N}])${RUN_LIFECYCLE_ASSERTION_SOURCE}(?![\\p{L}\\p{N}])`,
  'iu'
)

/** Masque seulement l'assertion lifecycle niée, pas les autres faits présents sur la même ligne. */
function maskNegatedLifecycleEvidence(text: string): string {
  return text
    .replace(NEGATED_LIFECYCLE_BEFORE, (assertion) => ' '.repeat(assertion.length))
    .replace(NEGATED_LIFECYCLE_AFTER, (assertion) => ' '.repeat(assertion.length))
}

function maskHistoricalLifecycleEvidence(text: string): string {
  return text.replace(FORMATTED_LIFECYCLE_REFERENCE, (formatted, offset: number) => {
    const literal = formatted.startsWith('`')
      ? formatted.slice(1, formatted.lastIndexOf('`'))
      : formatted.startsWith('[')
        ? (/^\[([^\]\n]+)\]/u.exec(formatted)?.[1] ?? formatted)
        : formatted.slice(1, formatted.lastIndexOf('/'))
    if (!ACTIVE_LIFECYCLE.test(literal)) return formatted
    const context = `${text.slice(Math.max(0, offset - 80), offset)} ${text.slice(offset + formatted.length, offset + formatted.length + 120)}`
    const historical =
      /\b(?:ancien(?:ne)?|historique|logs?|trace|assertion|cha[iî]ne\s+attendue)\b|\b(?:observ|figur|cit|captur|trouv)[\p{L}]*\s+(?:dans|par)\b/iu.test(
        context
      )
    const future = /\b(?:plan\s+restant|prochaine\s+[ée]tape|reste\s+[àa]\s+faire)\b/iu.test(
      context
    )
    return historical && !future ? ' '.repeat(formatted.length) : formatted
  })
}

function lifecycleSearchableSource(text: string): string {
  return maskHistoricalLifecycleEvidence(
    maskNegatedLifecycleEvidence(maskQuotedEvidence(text))
  ).replace(/[`*_]/g, ' ')
}

function lifecycleSearchable(text: string): string {
  return lifecycleSearchableSource(text).trim()
}

function factualSuffixAfterStale(text: string, staleEnd: number): string | undefined {
  const tail = text.slice(staleEnd)
  const boundary = /(?:[.;:—|·,/]\s+|\s+-\s+)/u.exec(tail)
  if (!boundary) return undefined
  const candidate = tail.slice(boundary.index + boundary[0].length).trim()
  if (!candidate) return undefined
  const searchable = lifecycleSearchable(candidate)
  const staleLead =
    /^(?:maintenant|reste\s+[àa]\s+faire|recommand[ée]|encha[iî]ner|clean)(?=\s|[”—:,-]|$)/iu.test(
      searchable
    ) && /\b(?:publication|commit|judge|clean)\b/iu.test(searchable)
  return ACTIVE_LIFECYCLE.test(searchable) || staleLead ? undefined : candidate
}

function splitMarkdownTableCells(line: string): string[] | undefined {
  const text = line.trim()
  if (!text.startsWith('|') || !text.endsWith('|')) return undefined
  const cells: string[] = []
  let start = 1
  let codeMarkerLength = 0
  for (let index = 1; index < text.length - 1; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text[index] === '`') {
      let end = index + 1
      while (text[end] === '`') end += 1
      const length = end - index
      if (codeMarkerLength === 0) codeMarkerLength = length
      else if (codeMarkerLength === length) codeMarkerLength = 0
      index = end - 1
      continue
    }
    if (text[index] === '|' && codeMarkerLength === 0) {
      cells.push(text.slice(start, index))
      start = index + 1
    }
  }
  cells.push(text.slice(start, -1))
  return cells.length >= 2 ? cells : undefined
}

function stripStaleLifecycleClause(cell: string): string {
  let rewritten = cell
  // Une cellule peut cumuler plusieurs conclusions périmées. On retire une clause à la fois puis
  // on reparcourt le résultat : un seul `exec` laissait la seconde contradiction visible à côté de
  // la clôture autoritative. La borne empêche toute boucle en cas de future regex non consommatrice.
  for (let pass = 0; pass < 32; pass += 1) {
    const searchable = lifecycleSearchableSource(rewritten)
    // Dans un tableau d'audit, une mention de rôle `judge` peut précéder le vrai statut du RUN.
    // Le statut du RUN est plus précis que le motif générique et doit donc gagner.
    const staleSignal = ACTIVE_RUN_LIFECYCLE.exec(searchable) ?? ACTIVE_LIFECYCLE.exec(searchable)
    if (!staleSignal) return rewritten

    const staleStart = staleSignal.index
    const staleEnd = staleStart + staleSignal[0].length
    const prefix = rewritten.slice(0, staleStart)
    const separators = [...prefix.matchAll(/(?:[.!?;:,](?:[*_]+)?\s+|[—–]\s*|\s-\s+)/gu)]
    const previous = separators.at(-1)
    // Si une suppression précédente a consommé le séparateur, conserver le préfixe factuel au lieu
    // de traiter toute la cellule comme une unique clause lifecycle.
    const clauseStart = previous?.index ?? (prefix.trim() ? staleStart : 0)
    const tail = rewritten.slice(staleEnd)
    const next = /^\s*(?:[*_`]+\s*)*(?:[.!?;,]\s*|[—–]\s*|\s-\s+)/u.exec(tail)
    const clauseEnd = next ? staleEnd + next[0].length : staleEnd
    const before = rewritten.slice(0, clauseStart).trimEnd()
    const after = rewritten.slice(clauseEnd).trimStart()
    const nextValue = [before, after].filter(Boolean).join(' ')
    if (nextValue === rewritten) return rewritten
    rewritten = nextValue
  }
  return rewritten
}

/** Réconcilie cellule par cellule pour qu'un statut périmé ne supprime jamais toute une ligne. */
function withoutStaleLifecycleTableRow(line: string): string | undefined {
  const cells = splitMarkdownTableCells(line)
  if (!cells) return undefined
  const rewritten = cells.map(stripStaleLifecycleClause)
  if (rewritten.every((cell, index) => cell === cells[index])) return line
  // Compatibilité avec les anciennes preuves à deux cellules : une dernière cellule entièrement
  // périmée disparaît, tandis qu'une vraie ligne multi-colonnes conserve sa géométrie.
  if (rewritten.length === 2 && !rewritten[1].trim()) rewritten.pop()
  if (rewritten.every((cell) => !cell.trim())) return ''
  return `| ${rewritten.map((cell) => cell.trim()).join(' | ')} |`
}

function withoutStaleWorkerLifecycleLine(line: string): string | undefined {
  const text = line.trim()
  if (/^#{1,6}\s+(?:\d+[.)]\s*)?publication\s*$/iu.test(text)) return undefined
  const tableRow = withoutStaleLifecycleTableRow(line)
  if (tableRow !== undefined) return tableRow || undefined
  const proofSubject = text.replace(PROOF_DECORATION_PREFIX, '')
  const proofLike = /^(?:preuve|tests?(?:\s+verts?)?|contr[oô]le|r[ée]sultat)\b/iu.test(
    proofSubject
  )
  // Les citations historiques et les négations sont des preuves même sans préfixe « Preuve: ».
  // Restreindre ce masquage aux lignes proof-like effaçait des diagnostics autonomes tels que
  // « Ancienne trace : `RUN reste open` » ou « Aucune occurrence de RUN open ».
  const searchable = lifecycleSearchable(text)

  const staleSignal = ACTIVE_LIFECYCLE.exec(searchable)
  const staleLead =
    /^(?:maintenant|reste\s+[àa]\s+faire|recommand[ée]|encha[iî]ner|clean)(?=\s|[—:,-]|$)/iu.test(
      searchable
    ) && /\b(?:publication|commit|judge|clean)\b/iu.test(searchable)
  if (!staleSignal && !staleLead) return line

  if (staleSignal && proofLike) {
    const proofPrefix = text
      .slice(0, staleSignal.index)
      .trimEnd()
      .replace(/(?:\*\*|__|\*|_|\[|`|\/)\s*$/u, '')
      .trimEnd()
    const hasProofBoundary = /[.!?;:—|-]$/u.test(proofPrefix)
    const proof = proofPrefix
      .trimEnd()
      .replace(/\s*(?:[—-]|[;,:])\s*$/u, '')
      .trimEnd()
    const proofContent = proof
      .replace(PROOF_DECORATION_PREFIX, '')
      .replace(/^(?:preuve|tests?(?:\s+verts?)?|contr[oô]le|r[ée]sultat)\b\s*:?\s*/iu, '')
      .trim()
    const suffixProof = factualSuffixAfterStale(text, staleSignal.index + staleSignal[0].length)
    if (hasProofBoundary && proofContent) return suffixProof ? `${proof} ${suffixProof}` : proof
    if (suffixProof) return suffixProof
  }
  return undefined
}

function isStaleWorkerLifecycleSection(line: string): boolean {
  const heading = /^\s*#{1,6}\s+(.+?)\s*$/u.exec(line)?.[1]
  if (!heading) return false
  const title = heading.replace(/[`*_]/g, '').trim()
  if (isStaleWorkerLifecycleMarker(title)) return true
  return /^(?:\d+[.)]\s*)?(?:publication|maintenant|reste\s+[àa]\s+faire|recommand[ée])(?=\s|$)/iu.test(
    title
  )
}

function isStaleWorkerLifecycleMarker(line: string): boolean {
  const text = line
    .trim()
    .replace(/^#{1,6}\s+/u, '')
    .replace(/\*\*/gu, '')
    .trim()
  return /^(?:📍\s*maintenant|⏳\s*reste\s+[àa]\s+faire|👉\s*recommand(?:é|ée|ation))(?=\s|[—:,-]|$)/iu.test(
    text
  )
}

/**
 * Le rapport du worker est capturé AVANT la gate et la publication. Une fois l'issue structurée
 * `succeeded` connue, ses preuves restent utiles mais ses recommandations de cycle de vie deviennent
 * fausses. On retire uniquement ces lignes, jamais les tests, diffs ou diagnostics.
 */
function removeStaleWorkerLifecycleAdvice(
  report: string,
  protectedLines: ReadonlySet<number>
): string {
  let staleHeadingLevel: number | undefined
  let staleMarkerParagraph = false
  return rewriteUnprotectedMarkdownLines(report, protectedLines, (line) => {
    if (isAuthoritativeOrchestrationClosureLine(line)) {
      staleHeadingLevel = undefined
      staleMarkerParagraph = false
      return line
    }

    const heading = /^(\s*(#{1,6})\s+)(.+?)\s*$/u.exec(line)
    if (heading) {
      const level = heading[2].length
      if (staleHeadingLevel !== undefined && level <= staleHeadingLevel) {
        staleHeadingLevel = undefined
      }
      if (staleHeadingLevel !== undefined) return undefined
      staleMarkerParagraph = false
      if (isStaleWorkerLifecycleSection(line)) {
        staleHeadingLevel = level
        return undefined
      }
      const usefulHeading = withoutStaleWorkerLifecycleLine(heading[3])
      return usefulHeading === undefined ? undefined : `${heading[1]}${usefulHeading}`
    }

    if (staleHeadingLevel !== undefined) return undefined
    if (!line.trim()) {
      staleMarkerParagraph = false
      return line
    }
    if (isStaleWorkerLifecycleMarker(line)) {
      staleMarkerParagraph = true
      return undefined
    }
    return staleMarkerParagraph ? undefined : withoutStaleWorkerLifecycleLine(line)
  })
}

type ClosingMarker = 'fait' | 'maintenant' | 'reste' | 'recommande'

function structuredClosingMarker(line: string): ClosingMarker | undefined {
  const text = line
    .trim()
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^\*\*/u, '')
    .replace(/\*\*(?=\s*(?:[:：—–-]|$))/u, '')
    .trim()
  if (/^✅\s*Fait(?=\s|[:：—–-]|$)/u.test(text)) return 'fait'
  if (/^📍️?\s*Maintenant(?=\s|[:：—–-]|$)/u.test(text)) return 'maintenant'
  if (/^⏳️?\s*Reste à faire(?=\s|[:：—–-]|$)/u.test(text)) return 'reste'
  if (/^👉\s*Recommandé(?=\s|[:：—–-]|$)/u.test(text)) return 'recommande'
  return undefined
}

/** Retire uniquement un bloc de clôture COMPLET et final déjà produit par le worker. */
function removeExistingStructuredClosingBlock(
  report: string,
  protectedLines: ReadonlySet<number>
): string {
  const lines = report.split(/\r?\n/u)
  const wanted: ClosingMarker[] = ['fait', 'maintenant', 'reste', 'recommande']
  let wantedIndex = 0
  let start = -1
  let end = -1
  let now = -1
  for (const [index, line] of lines.entries()) {
    if (protectedLines.has(index + 1)) continue
    const marker = structuredClosingMarker(line)
    if (marker === wanted[wantedIndex]) {
      if (wantedIndex === 0) start = index
      if (marker === 'maintenant') now = index
      wantedIndex += 1
      if (wantedIndex === wanted.length) {
        end = index + 1
        break
      }
    } else if (marker === 'fait') {
      start = index
      now = -1
      wantedIndex = 1
    }
  }
  if (wantedIndex !== wanted.length || start < 0 || now < 0 || end < 0) return report

  // Le dernier intitulé contient normalement sa recommandation sur la même ligne. Si elle est
  // portée par le paragraphe suivant, retire aussi ce paragraphe, mais jamais les preuves placées
  // après une ligne vide : elles appartiennent au rapport, pas à l'ancien footer.
  const recommendedLine = lines[end - 1].trim().replace(/^#{1,6}\s*/u, '')
  const recommendedLabel = /^👉\s*(?:\*\*)?Recommandé(?:\*\*)?/u.exec(recommendedLine)?.[0]
  const inlineRecommendation = recommendedLabel
    ? recommendedLine.slice(recommendedLabel.length).trim().replace(/^[:：—–-]\s*/u, '')
    : ''
  if (!inlineRecommendation) {
    while (end < lines.length && lines[end].trim()) end += 1
  }

  // Le contenu sous « Fait » porte les preuves du worker (tests, fichiers, checksum). Conserve-le
  // comme corps du rapport ; seuls l'ancien intitulé et les rubriques de cycle de vie sont remplacés.
  const inlineFact = lines[start]
    .trim()
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^(?:\*\*)?✅\s*Fait(?:\*\*)?\s*(?:[:：—–-]\s*)?/u, '')
    .trim()
  const facts = [...(inlineFact ? [inlineFact] : []), ...lines.slice(start + 1, now)]
  return [...lines.slice(0, start), ...facts, ...lines.slice(end)].join('\n').trimEnd()
}

interface OpenFence {
  marker: '`' | '~'
  length: number
  prefix: string
}

/** Détecte la fence CommonMark encore ouverte au point de coupe, afin d'isoler le footer. */
function openMarkdownFence(text: string): OpenFence | undefined {
  let open: OpenFence | undefined
  for (const line of text.split(/\r?\n/u)) {
    if (!open) {
      const match = /^((?:(?: {0,3}> ?)+)? {0,3})(`{3,}|~{3,})(.*)$/u.exec(line)
      if (!match) continue
      const fence = match[2]
      if (fence[0] === '`' && /`/u.test(match[3])) continue
      open = {
        marker: fence[0] as '`' | '~',
        length: fence.length,
        prefix: match[1]
      }
      continue
    }
    const candidate = line.slice(open.prefix.length)
    const fence = candidate.match(open.marker === '`' ? /^`{3,}/u : /^~{3,}/u)?.[0]
    if (fence && fence.length >= open.length && candidate.slice(fence.length).trim() === '') {
      open = undefined
    }
  }
  return open
}

function boundedMarkdownResult(result: string, maxLength = 4_000): string {
  if (result.length <= maxLength) return result
  const truncated = result.slice(0, maxLength)
  const open = openMarkdownFence(truncated)
  const closure = open ? `\n${open.prefix}${open.marker.repeat(open.length)}` : ''
  return `${truncated}${closure}\n…[tronqué]`
}

export function isDeliveredOrchestrationOutcome(outcome: OrchestrationOutcome): boolean {
  return (
    asString(outcome.status) === 'succeeded' &&
    outcome.valid === true &&
    outcome.gateBlocked === false &&
    outcome.reused === false
  )
}

/**
 * Réconcilie aussi les anciens messages déjà persistés : leur texte worker a été écrit avant la
 * publication, mais leur action `orchestrate` conserve l'outcome structuré qui fait autorité.
 */
export function reconcileClosedOrchestrationText(
  report: string,
  outcome: OrchestrationOutcome
): string {
  if (!isDeliveredOrchestrationOutcome(outcome)) return report
  const protectedLines = markdownCodeLineProtection([report])[0]
  const withoutExistingClosingBlock = removeExistingStructuredClosingBlock(report, protectedLines)
  const remainingProtectedLines = markdownCodeLineProtection([withoutExistingClosingBlock])[0]
  return removeStaleWorkerLifecycleAdvice(withoutExistingClosingBlock, remainingProtectedLines)
}

/** Réconcilie un flux persisté en projetant d'abord ses spans Markdown sur tous les fragments. */
export function reconcileClosedOrchestrationTextParts(
  reports: readonly string[],
  outcome: OrchestrationOutcome,
  mutableStart = 0
): string[] {
  if (!isDeliveredOrchestrationOutcome(outcome)) return [...reports]
  const protectedLines = markdownCodeLineProtection(reports)
  return reports.map((report, index) =>
    index < mutableStart ? report : removeStaleWorkerLifecycleAdvice(report, protectedLines[index])
  )
}

/** Libellé de coût honnête, compatible avec les anciens résultats qui n'avaient que `costUsd`. */
export function formatExecutionCostCoverage(data: OrchestrationOutcome): string | undefined {
  const hasCoverage = Object.prototype.hasOwnProperty.call(data, 'knownCostUsd')
  const knownCost = asNumber(data.knownCostUsd)
  const unpricedCalls = asCallCount(data.unpricedCalls)
  const unpricedLabel = `${unpricedCalls} appel${unpricedCalls > 1 ? 's' : ''} non chiffré${unpricedCalls > 1 ? 's' : ''}`

  if (hasCoverage && data.knownCostUsd === null) {
    return unpricedCalls > 0 ? `coût non exposé · ${unpricedLabel}` : 'coût non exposé'
  }
  if (hasCoverage && knownCost !== undefined) {
    return unpricedCalls > 0
      ? `${knownCost.toFixed(2)} $ connus · ${unpricedLabel}`
      : `${knownCost.toFixed(2)} $`
  }
  const legacyCost = asNumber(data.costUsd)
  return legacyCost === undefined ? undefined : `${legacyCost.toFixed(2)} $`
}

/** Nom lisible du run à partir de son chemin (le dossier `<sujet>-workspace`). */
export function runLabelFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const workspace = [...segments].reverse().find((segment) => segment.endsWith('-workspace'))
  return workspace?.replace(/-workspace$/, '') ?? segments.at(-2)
}

/** Bloc final dérivé uniquement de l'issue structurée, après retrait du statut provisoire du worker. */
function deliveredClosingBlock(): string[] {
  return [
    '---',
    '✅ Fait',
    '1. Le résultat demandé a été produit et validé.',
    '📍 Maintenant : la tâche demandée est terminée et son résultat est disponible.',
    '⏳ Reste à faire : rien.',
    '👉 Recommandé : passer à la prochaine demande.'
  ]
}

/** Reconnaît le footer synthétisé par Autowin, sans confondre un bloc libre produit par le worker. */
function authoritativeDeliveredClosingBlockSpan(
  report: string
): { start: number; end: number } | undefined {
  const protectedLines = markdownCodeLineProtection([report])[0]
  const lines = report.split(/\r?\n/u)
  const visible = lines.map((line, index) => (protectedLines.has(index + 1) ? undefined : line.trim()))
  const fact = visible.indexOf('✅ Fait')
  const factLine = visible[fact + 1]
  if (
    fact < 0 ||
    (factLine !== '1. Workflow livré : gate validé et RUN fermé green.' &&
      factLine !== '1. Le résultat demandé a été produit et validé.')
  ) {
    return undefined
  }
  const now = visible.findIndex(
    (line, index) => index > fact && line?.startsWith('📍 Maintenant :')
  )
  const remaining = visible.indexOf('⏳ Reste à faire : rien.', now + 1)
  const recommended = visible.indexOf(
    '👉 Recommandé : passer à la prochaine demande.',
    remaining + 1
  )
  if (!(fact < now && now < remaining && remaining < recommended)) return undefined
  const start = fact > 0 && visible[fact - 1] === '---' ? fact - 1 : fact
  return { start, end: recommended + 1 }
}

export function hasAuthoritativeDeliveredClosingBlock(report: string): boolean {
  return authoritativeDeliveredClosingBlockSpan(report) !== undefined
}

/** Retire un ancien footer vert exact quand une issue plus récente fait autorité. */
export function removeAuthoritativeDeliveredClosingBlock(report: string): string {
  const span = authoritativeDeliveredClosingBlockSpan(report)
  if (!span) return report
  const lines = report.split(/\r?\n/u)
  return [...lines.slice(0, span.start), ...lines.slice(span.end)].join('\n').trimEnd()
}

/**
 * Texte de clôture d'une orchestration. Ne prétend JAMAIS un succès : `gateBlocked` ou `valid: false`
 * sont dits explicitement, même quand l'appel a « réussi » techniquement. Un gate qui bloque est un
 * échec de livraison, pas un détail.
 */
export function formatOrchestrationOutcome(
  ok: boolean,
  data: OrchestrationOutcome | undefined,
  errorMessage?: string,
  closingNotice?: string
): string {
  if (!ok) {
    return `Échec du workflow : ${asString(errorMessage) ?? asString(data?.error) ?? 'raison non rapportée'}`
  }
  const outcome = data ?? {}
  const gateBlocked = outcome.gateBlocked === true
  const invalid = outcome.valid === false
  const delivered = isDeliveredOrchestrationOutcome(outcome)
  const status = asString(outcome.status)
  const cost = formatExecutionCostCoverage(outcome)
  const run = runLabelFromPath(asString(outcome.runPath) ?? asString(outcome.runId))
  const result = asString(outcome.result)
  const visibleResult = result ? reconcileClosedOrchestrationText(result, outcome) : result
  const learningState = asString(outcome.learning?.state)
  const learningDetail = asString(outcome.learning?.detail)

  const headline = gateBlocked
    ? '⛔ Workflow BLOQUÉ par le gate — livrable non validé'
    : invalid
      ? '⚠️ Workflow terminé mais le juge a REFUSÉ le livrable'
      : outcome.reused === true
        ? '↻ Workflow déjà en cours réutilisé (aucun nouveau run lancé)'
        : delivered
          ? '✅ Workflow terminé'
          : '⚠️ Workflow terminé — preuve incomplète de livraison'

  const facts = [
    status && `statut ${status}`,
    cost && (cost.startsWith('coût ') ? cost : `coût ${cost}`),
    run && `run « ${run} »`
  ].filter((fact): fact is string => Boolean(fact))

  const lines = [facts.length ? `${headline} · ${facts.join(' · ')}` : headline]
  if (learningState) {
    const learningLabels: Record<string, string> = {
      none: 'aucune leçon proposée',
      off: 'apprentissage désactivé',
      shadow: 'leçon simulée',
      inbox: 'leçon gardée en revue',
      escrow: 'leçon en attente de confirmation',
      published: 'leçon prouvée publiée',
      suppressed: 'doublon ou leçon non recevable écarté',
      unknown: 'état de la leçon inconnu'
    }
    lines.push(
      `Brain : ${learningLabels[learningState] ?? learningState}${learningDetail ? ` — ${learningDetail}` : ''}`
    )
  }
  if (visibleResult) lines.push('', boundedMarkdownResult(visibleResult))
  if (closingNotice?.trim()) lines.push('', closingNotice.trim())
  if (delivered) lines.push('', ...deliveredClosingBlock())
  return lines.join('\n')
}
