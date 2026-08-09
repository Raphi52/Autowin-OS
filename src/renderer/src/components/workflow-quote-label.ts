import type { RunWorkflowObservation } from '../../../shared/run-execution'

/** Rend visible qui a choisi le workflow, pas seulement son nom. */
export function workflowQuoteLabel(workflow: RunWorkflowObservation | undefined): string {
  if (!workflow) return 'aucun workflow'
  const provenance =
    workflow.source === 'manuel'
      ? 'choisi à la main'
      : workflow.source === 'modele'
        ? 'choisi par le modèle'
        : 'composé à la volée'
  return `${workflow.name} — ${provenance}`
}
