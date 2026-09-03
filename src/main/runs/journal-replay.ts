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
  /**
   * Actions outillées relues dans l'ordre (« Bash · npx vitest », « Edit · src/x.ts »).
   *
   * DEFAUT VECU (conv-152, reprise du 2026-09-03, tour 57656364-053f-40e6-bc8e-91efd5b74e39) : la
   * fenêtre relue du journal `c63dd8c1-ee90-480f-a852-beba47d2ae8f.stdout.jsonl` comptait 308
   * lignes, 21 messages assistant — dont ZERO texte : 12 appels d'outils et de la réflexion. Le
   * récapitulatif n'ayant que le texte à montrer, il a affiché « 308 étape(s) enregistrée(s), aucun
   * message final », et l'utilisateur a répondu « la reprise a pas marché ». Les 12 actions étaient
   * pourtant sur le disque : on les extrait.
   */
  actions: string[]
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

/** Actions outillées portées par une ligne de journal. Liste vide = rien d'exploitable. */
function actionsOf(line: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const event = parsed as Record<string, unknown>

  // Claude CLI : { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } }
  if (event.type === 'assistant') {
    const message = event.message as
      | { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> }
      | undefined
    return (message?.content ?? [])
      .filter((part) => part?.type === 'tool_use' && typeof part.name === 'string')
      .map((part) => libelleAction(part.name as string, part.input))
  }

  // Codex CLI : { type: 'item.completed', item: { type: 'command_execution', command } }
  if (event.type === 'item.completed') {
    const item = event.item as { type?: string; command?: string } | undefined
    if (item?.type === 'command_execution' && typeof item.command === 'string' && item.command.trim()) {
      return [libelleAction('Bash', { command: item.command })]
    }
  }
  return []
}

/** « outil · cible » — la cible est le premier argument parlant, jamais l'objet entier. */
function libelleAction(nom: string, input: Record<string, unknown> | undefined): string {
  const cible = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']
    .map((cle) => input?.[cle])
    .find((valeur): valeur is string => typeof valeur === 'string' && valeur.trim().length > 0)
  if (!cible) return nom
  const propre = cible.replace(/\s+/g, ' ').trim()
  return `${nom} · ${propre.length <= 120 ? propre : `${propre.slice(0, 120)}…`}`
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
  const actions: string[] = []
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
    actions.push(...actionsOf(trimmed))
  }
  return {
    text: textes.join('\n\n'),
    actions,
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
  // Un recap fabrique a la main (tests, appelants anciens) peut ne pas porter `actions`.
  const actionsRelues = recap.actions ?? []
  if (recap.events === 0 && !recap.text && recap.unreadable === 0) return undefined
  const entete = stillWorking
    ? "Reprise du fil — l'agent a continué de travailler pendant que l'application était fermée, et il travaille encore."
    : "Reprise du fil — voici ce que l'agent a produit pendant que l'application était fermée."
  // Sans texte final, les ACTIONS relues sont le seul fil que l'utilisateur puisse remonter :
  // « 308 étape(s) » ne dit rien, « Bash · npx vitest … » dit ce qui s'est passé.
  const journalDesActions = actionsRelues.length
    ? `\n\nCe qu'il a fait (${actionsRelues.length} action(s) relues) :\n` +
      actionsRelues
        .slice(-12)
        .map((action) => `- ${action}`)
        .join('\n')
    : ''
  const corps = recap.text
    ? `${recap.text}${journalDesActions}`
    : actionsRelues.length
      ? `Aucun message final à cet instant, mais le détail des actions est intact.${journalDesActions}`
      : `${recap.events} étape(s) enregistrée(s), aucun message final à cet instant.`
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
