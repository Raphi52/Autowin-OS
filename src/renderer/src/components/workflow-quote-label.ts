import type { RunWorkflowObservation } from '../../../shared/run-execution'
import { langueCourante } from '../langue'
import { traduireChatDecisions } from '../textes-ecrans/chat-decisions'

/** Rend visible qui a choisi le workflow, pas seulement son nom. */
export function workflowQuoteLabel(workflow: RunWorkflowObservation | undefined): string {
  const langue = langueCourante()
  if (!workflow) return traduireChatDecisions('workflows.quote.aucun', langue)
  const provenance = traduireChatDecisions(
    workflow.source === 'manuel'
      ? 'workflows.quote.manuel'
      : workflow.source === 'modele'
        ? 'workflows.quote.modele'
        : 'workflows.quote.volee',
    langue
  )
  return `${workflow.name} — ${provenance}`
}
