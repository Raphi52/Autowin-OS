import type { HarnessAnomaly, HarnessTimelineEvent } from './harness-timeline-model'

/**
 * « Signaux prioritaires » se lit comme un TRIAGE : ce qui est CASSÉ passe devant ce qui est
 * seulement GROS. Trier par `impact` (taille de payload) plaçait un bloc d'instructions sain de
 * 40 000 caractères AVANT une erreur d'outil — l'utilisateur scrollait pour trouver la panne.
 * La taille reste affichée, elle ne décide plus de l'ordre.
 */
export type ObservatorySignalSeverity = 'error' | 'warning' | 'info'

export interface ObservatoryPrioritySignal {
  id: string
  eventId: string
  severity: ObservatorySignalSeverity
  severityLabel: string
  label: string
  detail: string
  turnIds: string[]
  /** Caractères concernés — affiché, jamais utilisé comme clé de tri primaire. */
  impact: number
}

const SEVERITY_RANK: Record<ObservatorySignalSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2
}
const SEVERITY_LABEL: Record<ObservatorySignalSeverity, string> = {
  error: 'échec',
  warning: 'à vérifier',
  info: 'volume'
}

function isFailedEvent(event: HarnessTimelineEvent): boolean {
  if (event.kind === 'error' || event.kind === 'cancellation') return true
  const status = (event.status ?? '').toLocaleLowerCase('fr')
  return status === 'error' || status === 'failed' || status === 'failure' || status === 'denied'
}

function anomalySeverity(anomaly: HarnessAnomaly): ObservatorySignalSeverity {
  // Une répétition est un défaut diagnostiquable ; un bloc volumineux n'est qu'une observation.
  return anomaly.kind === 'duplicate-injection' ? 'warning' : 'info'
}

/**
 * Ordre : gravité (échec > à vérifier > volume), puis impact décroissant À GRAVITÉ ÉGALE,
 * puis eventId pour un rendu déterministe.
 */
export function buildObservatoryPrioritySignals(
  anomalies: HarnessAnomaly[],
  events: HarnessTimelineEvent[]
): ObservatoryPrioritySignal[] {
  const signals: ObservatoryPrioritySignal[] = []
  for (const event of events) {
    if (!isFailedEvent(event)) continue
    signals.push({
      id: `event:${event.id}`,
      eventId: event.id,
      severity: 'error',
      severityLabel: SEVERITY_LABEL.error,
      label: event.label || event.kind,
      detail: event.detail || event.actor,
      turnIds: [],
      impact: event.content?.length ?? 0
    })
  }
  for (const anomaly of anomalies) {
    const severity = anomalySeverity(anomaly)
    signals.push({
      id: `${anomaly.kind}:${anomaly.eventId}`,
      eventId: anomaly.eventId,
      severity,
      severityLabel: SEVERITY_LABEL[severity],
      label: anomaly.label,
      detail: anomaly.fact,
      turnIds: anomaly.turnIds,
      impact: anomaly.impact
    })
  }
  return signals.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.impact - a.impact ||
      a.eventId.localeCompare(b.eventId)
  )
}
