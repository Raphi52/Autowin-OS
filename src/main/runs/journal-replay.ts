/**
 * Relire ce qu'un agent a produit PENDANT que l'app était absente.
 *
 * Les CLI écrivent leur sortie brute dans un journal fichier et survivent à la mort de l'app. Ce
 * journal n'était jamais relu : au retour, le travail existait sur le disque mais restait invisible,
 * et l'utilisateur croyait l'avoir perdu — donc relançait.
 *
 * On n'essaie PAS de reconstituer le flux complet du provider (outils, preuves, coûts) : ce serait
 * réécrire son analyseur. On extrait ce qui répond à la question « qu'est-ce qui s'est passé ? » —
 * le texte produit par l'agent — en tolérant les deux formats et tout ce qu'on ne comprend pas.
 */

export interface JournalRecap {
  /** Texte produit par l'agent pendant l'absence, dans l'ordre. */
  text: string
  /** Lignes d'événement reconnues — permet de dire « il a travaillé » même sans texte final. */
  events: number
  /** Lignes illisibles : comptées, jamais devinées. */
  unreadable: number
  /** Erreurs stderr reconnues avec une signature forte et conservées pour Auto-Kaizen. */
  diagnostics: JournalDiagnostic[]
  coverage: {
    total: number
    structured: number
    diagnostics: number
    blockages: number
    noise: number
    lostProof: number
    structuredPercent: number
  }
}

function isKnownNoise(line: string): boolean {
  return /^(?:Wall time|Process exited with code|Duration|Start at):/i.test(line)
}

export interface JournalDiagnostic {
  kind: 'stderr-error' | 'command-failed'
  classification: 'diagnostic' | 'blockage'
  line: number
  summary: string
  detail: string
}

function diagnosticOfEvent(
  event: Record<string, unknown>,
  index: number
): JournalDiagnostic | undefined {
  if (event.type !== 'item.completed') return undefined
  const item = event.item as Record<string, unknown> | undefined
  if (!item || item.type !== 'command_execution') return undefined
  const exitCode = typeof item.exit_code === 'number' ? item.exit_code : undefined
  if (exitCode === 0 || (exitCode === undefined && item.status !== 'failed')) return undefined
  const command = typeof item.command === 'string' ? item.command.trim() : 'commande inconnue'
  const output = typeof item.aggregated_output === 'string' ? item.aggregated_output.trim() : ''
  const summary = `Commande en échec (${exitCode ?? 'signal'}) : ${command}`
  const detail = `${summary}${output ? `\n\n${output}` : ''}`
  return {
    kind: 'command-failed',
    classification: 'blockage',
    line: index + 1,
    summary: summary.length <= 240 ? summary : `${summary.slice(0, 240)}…`,
    detail: detail.length <= 8_000 ? detail : `${detail.slice(0, 8_000)}…`
  }
}

function diagnosticOf(line: string, index: number): JournalDiagnostic | undefined {
  const match = line.match(/^\S+\s+ERROR\s+[^:]+:\s*(?:error=)?(.+)$/i)
  if (!match) return undefined
  const detail = match[1].trim()
  return {
    kind: 'stderr-error',
    classification:
      /\b(?:fail(?:ed|ure)?|refus\w*|denied|unavailable|not found|exit code|timed out|exception|fatal)\b/i.test(
        detail
      )
        ? 'blockage'
        : 'diagnostic',
    line: index + 1,
    summary: detail.length <= 240 ? detail : `${detail.slice(0, 240)}…`,
    detail: line.length <= 2_000 ? line : `${line.slice(0, 2_000)}…`
  }
}

/** Texte porté par une ligne de journal, quel que soit le provider. `undefined` = rien d'exploitable. */
function textOf(line: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const event = parsed as Record<string, unknown>

  // Claude CLI (stream-json) : { type: 'assistant', message: { content: [{ type: 'text', text }] } }
  if (event.type === 'assistant') {
    const message = event.message as
      { content?: Array<{ type?: string; text?: string }> } | undefined
    const pieces = (message?.content ?? [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
      .map((part) => part.text as string)
    return pieces.length ? pieces.join('\n') : undefined
  }

  // Codex CLI (JSONL) : { type: 'item.completed', item: { type: 'agent_message', text } }
  if (event.type === 'item.completed') {
    const item = event.item as { type?: string; text?: string } | undefined
    if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      return item.text
    }
  }
  return undefined
}

/** Une ligne JSON valide compte comme un événement, même si elle ne porte pas de texte. */
function isEvent(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line)
    return Boolean(parsed) && typeof parsed === 'object'
  } catch {
    return false
  }
}

/** Résume les lignes d'un journal. Ne jette jamais : un journal illisible rend un récapitulatif vide. */
export function summarizeJournal(lines: readonly string[]): JournalRecap {
  const textes: string[] = []
  const diagnostics: JournalDiagnostic[] = []
  let events = 0
  let unreadable = 0
  let total = 0
  let noise = 0
  let unstructuredDiagnostics = 0
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    total += 1
    if (!isEvent(trimmed)) {
      unreadable += 1
      const diagnostic = diagnosticOf(trimmed, index)
      if (diagnostic) {
        diagnostics.push(diagnostic)
        unstructuredDiagnostics += 1
      } else if (isKnownNoise(trimmed)) noise += 1
      continue
    }
    events += 1
    const event = JSON.parse(trimmed) as Record<string, unknown>
    const diagnostic = diagnosticOfEvent(event, index)
    if (diagnostic) diagnostics.push(diagnostic)
    const text = textOf(trimmed)
    if (text) textes.push(text)
  }
  return {
    text: textes.join('\n\n'),
    events,
    unreadable,
    diagnostics,
    coverage: {
      total,
      structured: events,
      diagnostics: diagnostics.filter((item) => item.classification === 'diagnostic').length,
      blockages: diagnostics.filter((item) => item.classification === 'blockage').length,
      noise,
      lostProof: Math.max(0, unreadable - unstructuredDiagnostics - noise),
      structuredPercent: total === 0 ? 100 : Math.round((events / total) * 100)
    }
  }
}

/**
 * Phrase à afficher dans la conversation au retour de l'app. Dit ce qui s'est passé ET ce qu'on ne
 * sait pas — un récapitulatif qui prétendrait tout savoir serait pire que pas de récapitulatif.
 */
export function recapMessage(recap: JournalRecap, stillWorking: boolean): string | undefined {
  if (recap.events === 0 && !recap.text && recap.unreadable === 0) return undefined
  const entete = stillWorking
    ? "Reprise du fil — l'agent a continué de travailler pendant que l'application était fermée, et il travaille encore."
    : "Reprise du fil — voici ce que l'agent a produit pendant que l'application était fermée."
  const corps = recap.text
    ? recap.text
    : `${recap.events} étape(s) enregistrée(s), aucun message final à cet instant.`
  /*
   * LES COMPTEURS INTERNES NE SORTENT QUE S'ILS DISENT QUELQUE CHOSE.
   *
   * Mesure du 2026-09-03 (conv-18) : l'utilisateur relit son fil et y trouve « Couverture
   * structuree : 100 % (222/222) · 0 diagnostic(s) · 0 blocage(s) · 0 bruit(s) · 0 perte(s) de
   * preuve. » — cinq chiffres de mecanique interne, tous neutres, reposes a CHAQUE retour de
   * l'app. Un journal relu en entier n'a aucune reserve a formuler : la taire ne retire aucune
   * information a l'utilisateur, et lui rend un fil lisible.
   *
   * Des qu'une ligne n'a pas ete comprise, ou qu'une erreur exploitable a ete vue, la reserve
   * redevient due et les compteurs repartent avec elle : c'est la qu'ils informent vraiment.
   */
  if (recap.unreadable === 0 && recap.diagnostics.length === 0) {
    return `${entete}\n\n${corps}`
  }
  const coverage =
    `\n\nCouverture structurée : ${recap.coverage.structuredPercent} % ` +
    `(${recap.coverage.structured}/${recap.coverage.total}) · ` +
    `${recap.coverage.diagnostics} diagnostic(s) · ${recap.coverage.blockages} blocage(s) · ` +
    `${recap.coverage.noise} bruit(s) · ${recap.coverage.lostProof} perte(s) de preuve.`
  if (recap.unreadable > 0) {
    const diagnosticSummary = recap.diagnostics
      .slice(0, 3)
      .map((diagnostic) => `- ${diagnostic.summary}`)
      .join('\n')
    const reserve =
      `\n\n⚠️ ${recap.unreadable} ligne(s) non structurée(s) : ` +
      `${recap.coverage.noise} bruit(s), ${recap.coverage.lostProof} perte(s) de preuve.` +
      (recap.diagnostics.length
        ? ` ${recap.diagnostics.length} erreur(s) exploitable(s) détectée(s) pour Auto-Kaizen.\n${diagnosticSummary}`
        : '')
    return `${entete}\n\n${corps}${coverage}${reserve}`
  }
  return `${entete}\n\n${corps}${coverage}`
}
