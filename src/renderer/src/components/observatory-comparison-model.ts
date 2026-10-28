import type { HarnessTimelineEvent } from './harness-timeline-model'
import type { Langue } from '../../../shared/langue'
import { langueCourante } from '../langue'
import { traduireObservatory, type CleObservatory } from '../textes-ecrans/observatory'

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
  afterEvent: HarnessTimelineEvent,
  langue: Langue = langueCourante()
): ObservatoryComparison {
  // « Type », « Provider », « Phase », « Effort » et « Transport » se disent pareil en anglais.
  const libelle = (cle: CleObservatory): string => traduireObservatory(cle, langue)
  const fields: Array<
    [key: string, label: string, read: (event: HarnessTimelineEvent) => ObservatoryComparisonValue]
  > = [
    ['kind', 'Type', (event) => value(event.kind)],
    ['actor', libelle('comparaison.acteur'), (event) => value(event.actor)],
    ['provider', 'Provider', (event) => value(event.provider)],
    ['model', libelle('comparaison.modele'), (event) => value(event.model)],
    ['phase', 'Phase', (event) => value(event.execution?.phase)],
    ['reasoningEffort', 'Effort', (event) => value(event.reasoningEffort)],
    ['transport', 'Transport', (event) => value(event.transport)],
    ['status', libelle('comparaison.statut'), (event) => value(event.status)],
    ['channel', libelle('comparaison.canal'), (event) => value(event.channel)],
    ['content', libelle('comparaison.contenuContexte'), (event) => value(event.content)],
    ['inputTokens', libelle('comparaison.tokensEntree'), (event) => value(event.inputTokens)],
    [
      'cacheReadTokens',
      libelle('comparaison.tokensCache'),
      (event) => value(event.cacheReadTokens)
    ],
    ['outputTokens', libelle('comparaison.tokensSortie'), (event) => value(event.outputTokens)],
    ['costUsd', libelle('comparaison.coutUsd'), (event) => value(event.costUsd)],
    ['durationMs', libelle('comparaison.dureeMs'), (event) => value(event.durationMs)]
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
