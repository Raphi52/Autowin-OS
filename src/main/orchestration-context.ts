/**
 * Contexte collecté AVANT toute orchestration substantielle. Cette collecte est locale,
 * bornée et tolérante : une source absente n'empêche jamais le fallback d'exécution.
 */
export interface OrchestrationContextInput {
  task: string
  conversation?: { id: string; title?: string; category?: string; runPaths?: string[] }
  app?: { tab: string; pendingDecisions: Array<{ id: string; question: string }> }
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
  }
  if (input.app) {
    lines.push(`État application: onglet ${input.app.tab}; décisions en attente ${input.app.pendingDecisions.length}`)
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
