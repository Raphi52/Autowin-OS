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
    const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined
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
  let events = 0
  let unreadable = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!isEvent(trimmed)) {
      unreadable += 1
      continue
    }
    events += 1
    const text = textOf(trimmed)
    if (text) textes.push(text)
  }
  return { text: textes.join('\n\n'), events, unreadable }
}

/**
 * Phrase à afficher dans la conversation au retour de l'app. Dit ce qui s'est passé ET ce qu'on ne
 * sait pas — un récapitulatif qui prétendrait tout savoir serait pire que pas de récapitulatif.
 */
export function recapMessage(recap: JournalRecap, stillWorking: boolean): string | undefined {
  if (recap.events === 0 && !recap.text) return undefined
  const entete = stillWorking
    ? "Reprise du fil — l'agent a continué de travailler pendant que l'application était fermée, et il travaille encore."
    : "Reprise du fil — voici ce que l'agent a produit pendant que l'application était fermée."
  const corps = recap.text
    ? recap.text
    : `${recap.events} étape(s) enregistrée(s), aucun message final à cet instant.`
  const reserve =
    recap.unreadable > 0 ? `\n\n(${recap.unreadable} ligne(s) de journal illisibles, ignorées.)` : ''
  return `${entete}\n\n${corps}${reserve}`
}
