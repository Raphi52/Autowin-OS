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

export interface MarkdownFenceDelimiter {
  marker: '`' | '~'
  length: number
  quoteDepth: number
}

interface MarkdownFenceLine extends MarkdownFenceDelimiter {
  trailing: string
}

function markdownContainerLine(line: string): { content: string; quoteDepth: number } {
  let content = line
  let quoteDepth = 0
  for (;;) {
    const quote = /^ {0,3}>[ \t]?/u.exec(content)
    if (!quote) break
    quoteDepth += 1
    content = content.slice(quote[0].length)
  }
  return { content, quoteDepth }
}

function markdownFenceLine(line: string): MarkdownFenceLine | undefined {
  const { content, quoteDepth } = markdownContainerLine(line)
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content)
  if (!match) return undefined
  return {
    marker: match[1][0] as '`' | '~',
    length: match[1].length,
    quoteDepth,
    trailing: match[2]
  }
}

export function markdownFenceDelimiter(line: string): MarkdownFenceDelimiter | undefined {
  const fence = markdownFenceLine(line)
  return fence
    ? { marker: fence.marker, length: fence.length, quoteDepth: fence.quoteDepth }
    : undefined
}

export function markdownFenceStateAfterLine(
  line: string,
  current: MarkdownFenceDelimiter | undefined
): MarkdownFenceDelimiter | undefined {
  const { quoteDepth } = markdownContainerLine(line)
  const active = current && quoteDepth < current.quoteDepth ? undefined : current
  const fence = markdownFenceLine(line)
  if (!fence) return active
  if (!active) {
    // CommonMark interdit un backtick dans l'info-string d'un fence backtick ouvrant.
    if (fence.marker === '`' && fence.trailing.includes('`')) return undefined
    return { marker: fence.marker, length: fence.length, quoteDepth: fence.quoteDepth }
  }
  const closes =
    fence.marker === active.marker &&
    fence.length >= active.length &&
    fence.quoteDepth === active.quoteDepth &&
    fence.trailing.trim().length === 0
  return closes ? undefined : active
}

export function markdownFenceTransition(
  line: string,
  current: MarkdownFenceDelimiter | undefined
): { state: MarkdownFenceDelimiter | undefined; protected: boolean } {
  const fence = markdownFenceDelimiter(line)
  const state = markdownFenceStateAfterLine(line, current)
  return { state, protected: Boolean(fence || (current && state)) }
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

const LIFECYCLE_ASSERTION_SOURCE =
  '(?:run\\s+(?:est\\s+)?(?:(?:(?:reste|toujours)\\s+)?open|encore\\s+ouvert)|non\\s+(?:publi[ée]e?s?|commit[ée]e?s?)|publication\\s+(?:est\\s+)?(?:reste|non\\s+ex[ée]cut(?:[ée]e?s?)?|en\\s+attente|[àa]\\s+faire)|(?:modifications?|changements?)\\s+non\\s+(?:publi[ée]e?s?|commit[ée]e?s?)|(?:les\\s+)?changements?\\s+(?:(?:ne\\s+sont\\s+)?pas\\s+encore|non)\\s+publi[ée]s?|gate\\s+(?:est\\s+)?(?:(?:reste|toujours|encore)\\s+)?bloqu[ée]|(?:autoriser|d[ée]clencher)\\s+(?:la\\s+)?publication|(?:lancer|relancer)\\s+(?:le\\s+)?judge|judge\\s+[àa]\\s+lancer|judge[^\\n]*(?:refus[ée]|reste|non\\s+cl[oô]tur)|clean\\s+(?:puis|et)\\s+judge|encha[iî]ner\\s+clean[^\\n]*judge)'

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

function lifecycleSearchable(text: string): string {
  return maskHistoricalLifecycleEvidence(maskNegatedLifecycleEvidence(maskQuotedEvidence(text)))
    .replace(/[`*_]/g, ' ')
    .trim()
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

function withoutStaleWorkerLifecycleLine(line: string): string | undefined {
  const text = line.trim()
  if (/^#{1,6}\s+(?:\d+[.)]\s*)?publication\s*$/iu.test(text)) return undefined
  const proofSubject = text.replace(PROOF_DECORATION_PREFIX, '')
  const proofLike = /^(?:preuve|tests?(?:\s+verts?)?|contr[oô]le|r[ée]sultat)\b/iu.test(
    proofSubject
  )
  const searchable = proofLike ? lifecycleSearchable(text) : text.replace(/[`*_]/g, ' ')

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
interface ReconciledLifecycleText {
  text: string
  fencedBy: MarkdownFenceDelimiter | undefined
}

function removeStaleWorkerLifecycleAdvice(
  report: string,
  initialFence: MarkdownFenceDelimiter | undefined
): ReconciledLifecycleText {
  let staleHeadingLevel: number | undefined
  let staleMarkerParagraph = false
  let fencedBy = initialFence
  const kept: string[] = []

  for (const line of report.split(/\r?\n/u)) {
    const fence = markdownFenceTransition(line, fencedBy)
    fencedBy = fence.state
    if (fence.protected) {
      kept.push(line)
      continue
    }
    if (isAuthoritativeOrchestrationClosureLine(line)) {
      staleHeadingLevel = undefined
      staleMarkerParagraph = false
      kept.push(line)
      continue
    }

    const heading = /^(\s*(#{1,6})\s+)(.+?)\s*$/u.exec(line)
    if (heading) {
      const level = heading[2].length
      if (staleHeadingLevel !== undefined && level <= staleHeadingLevel) {
        staleHeadingLevel = undefined
      }
      if (staleHeadingLevel !== undefined) continue
      staleMarkerParagraph = false
      if (isStaleWorkerLifecycleSection(line)) {
        staleHeadingLevel = level
        continue
      }
      const usefulHeading = withoutStaleWorkerLifecycleLine(heading[3])
      if (usefulHeading !== undefined) kept.push(`${heading[1]}${usefulHeading}`)
      continue
    }

    if (staleHeadingLevel !== undefined) continue
    if (!line.trim()) {
      staleMarkerParagraph = false
      kept.push(line)
      continue
    }
    if (isStaleWorkerLifecycleMarker(line)) {
      staleMarkerParagraph = true
      continue
    }
    if (staleMarkerParagraph) continue
    const usefulLine = withoutStaleWorkerLifecycleLine(line)
    if (usefulLine !== undefined) kept.push(usefulLine)
  }

  const joined = kept.join('\n')
  const changed = joined !== report.replace(/\r\n/gu, '\n')
  return {
    text: changed ? joined.replace(/\n{3,}/g, '\n\n').trim() : report,
    fencedBy
  }
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
  return isDeliveredOrchestrationOutcome(outcome)
    ? removeStaleWorkerLifecycleAdvice(report, undefined).text
    : report
}

/** Réconcilie un flux persisté sans perdre l'état d'un fence entre deux fragments texte. */
export function reconcileClosedOrchestrationTextParts(
  reports: readonly string[],
  outcome: OrchestrationOutcome,
  initialFence?: MarkdownFenceDelimiter
): string[] {
  if (!isDeliveredOrchestrationOutcome(outcome)) return [...reports]
  let fencedBy = initialFence
  return reports.map((report) => {
    const reconciled = removeStaleWorkerLifecycleAdvice(report, fencedBy)
    fencedBy = reconciled.fencedBy
    return reconciled.text
  })
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

/**
 * Texte de clôture d'une orchestration. Ne prétend JAMAIS un succès : `gateBlocked` ou `valid: false`
 * sont dits explicitement, même quand l'appel a « réussi » techniquement. Un gate qui bloque est un
 * échec de livraison, pas un détail.
 */
export function formatOrchestrationOutcome(
  ok: boolean,
  data: OrchestrationOutcome | undefined,
  errorMessage?: string
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
  if (visibleResult)
    lines.push(
      '',
      visibleResult.length > 4_000 ? `${visibleResult.slice(0, 4_000)}…[tronqué]` : visibleResult
    )
  return lines.join('\n')
}
