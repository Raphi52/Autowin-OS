import { CONTEXT_MESSAGE_CHARS, CONTEXT_MESSAGE_LIMIT, clip } from './conversation-window'

/**
 * Contexte collecté AVANT toute orchestration substantielle. Cette collecte est locale,
 * bornée et tolérante : une source absente n'empêche jamais le fallback d'exécution.
 *
 * Le fil récent en fait partie depuis le 2026-08-23. Défaut mesuré sur conv-1376 : ce type n'avait
 * même pas de champ `messages`, donc le sous-agent recevait la phrase-tâche NUE, hors du fil qui
 * l'avait produite. Il ne pouvait pas LIRE l'intention de l'utilisateur — seulement la deviner à
 * partir d'une phrase isolée. C'est ce qui fait exécuter la lettre d'une demande plutôt que son
 * besoin. La fenêtre reprise est celle du routeur (`conversation-window.ts`), jamais une seconde.
 */
export interface OrchestrationContextInput {
  task: string
  conversation?: {
    id: string
    title?: string
    category?: string
    runPaths?: string[]
    /** Fin du fil, dans l'ordre chronologique. Bornée à la lecture, jamais par l'appelant. */
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  app?: { tab: string }
  runs?: Array<{ subject: string; status: string; blocked: boolean }>
  unavailable?: string[]
}

export function collectOrchestrationContext(input: OrchestrationContextInput): string {
  const lines = [
    '[COLLECTE DE CONTEXTE — effectuée avant RUN.md et délégation]',
    `Tâche: ${input.task}`
  ]
  if (input.conversation) {
    lines.push(
      `Conversation: ${input.conversation.id}${input.conversation.title ? ` — ${input.conversation.title}` : ''}`,
      `Workflows attachés: ${input.conversation.runPaths?.length ?? 0}`
    )
    const recents = (input.conversation.messages ?? []).slice(-CONTEXT_MESSAGE_LIMIT)
    if (recents.length) {
      lines.push(
        'Échanges récents (le fil qui a produit la demande — sa lettre ne dit pas tout) :',
        ...recents.map(
          (message) =>
            `  ${message.role === 'user' ? 'UTILISATEUR' : 'ASSISTANT'}: ${clip(message.content, CONTEXT_MESSAGE_CHARS)}`
        )
      )
    }
  }
  if (input.app) {
    lines.push(`État application: onglet ${input.app.tab}`)
  }
  const relevantRuns = (input.runs ?? []).filter((run) => run.blocked || run.status === 'open').slice(0, 8)
  lines.push(
    relevantRuns.length
      ? `Runs en cours/bloqués: ${relevantRuns.map((run) => `${run.subject} (${run.status}${run.blocked ? ', bloqué' : ''})`).join('; ')}`
      : 'Runs en cours/bloqués: aucun observé'
  )
  if (input.unavailable?.length) lines.push(`Sources indisponibles (fallback sûr): ${input.unavailable.join(', ')}`)
  return lines.join('\n')
}
