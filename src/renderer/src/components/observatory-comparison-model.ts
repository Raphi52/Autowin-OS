import type { HarnessTimelineEvent } from './harness-timeline-model'

export type ObservatoryComparisonChange = 'same' | 'added' | 'removed' | 'changed'
export type ObservatoryComparisonValue = string | number | null

export interface ObservatoryComparisonRow {
  key: string
  label: string
  before: ObservatoryComparisonValue
  after: ObservatoryComparisonValue
  change: ObservatoryComparisonChange
  delta?: number
}

export interface ObservatoryComparison {
  rows: ObservatoryComparisonRow[]
  changed: number
}

function changeOf(
  before: ObservatoryComparisonValue,
  after: ObservatoryComparisonValue
): ObservatoryComparisonChange {
  if (before === after) return 'same'
  if (before == null || before === '') return 'added'
  if (after == null || after === '') return 'removed'
  return 'changed'
}

function value(value: string | number | undefined): ObservatoryComparisonValue {
  return value ?? null
}

export function compareObservatoryEvents(
  beforeEvent: HarnessTimelineEvent,
  afterEvent: HarnessTimelineEvent
): ObservatoryComparison {
  const fields: Array<
    [key: string, label: string, read: (event: HarnessTimelineEvent) => ObservatoryComparisonValue]
  > = [
    ['kind', 'Type', (event) => value(event.kind)],
    ['actor', 'Acteur', (event) => value(event.actor)],
    ['provider', 'Provider', (event) => value(event.provider)],
    ['model', 'Modèle', (event) => value(event.model)],
    ['phase', 'Phase', (event) => value(event.execution?.phase)],
    ['reasoningEffort', 'Effort', (event) => value(event.reasoningEffort)],
    ['transport', 'Transport', (event) => value(event.transport)],
    ['status', 'Statut', (event) => value(event.status)],
    ['channel', 'Canal', (event) => value(event.channel)],
    ['content', 'Contenu / contexte', (event) => value(event.content)],
    ['inputTokens', 'Tokens entrée', (event) => value(event.inputTokens)],
    ['cacheReadTokens', 'Tokens cache', (event) => value(event.cacheReadTokens)],
    ['outputTokens', 'Tokens sortie', (event) => value(event.outputTokens)],
    ['costUsd', 'Coût USD', (event) => value(event.costUsd)],
    ['durationMs', 'Durée ms', (event) => value(event.durationMs)]
  ]

  const rows = fields.map(([key, label, read]) => {
    const before = read(beforeEvent)
    const after = read(afterEvent)
    const delta =
      typeof before === 'number' && typeof after === 'number'
        ? Number((after - before).toFixed(6))
        : undefined
    return {
      key,
      label,
      before,
      after,
      change: changeOf(before, after),
      ...(delta != null ? { delta } : {})
    }
  })
  return { rows, changed: rows.filter((row) => row.change !== 'same').length }
}
