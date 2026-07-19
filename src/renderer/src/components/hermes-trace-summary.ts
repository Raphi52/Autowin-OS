export interface HermesTraceSummaryInput {
  timestamp: string
  provider: string
  model: string
  boundary: 'hermes.pre_api_request' | 'hermes.request_dump'
  source: 'plugin-hook' | 'request-dump'
  conversationId?: string
}

export function summarizeHermesTraces(traces: HermesTraceSummaryInput[]): {
  count: number
  linkedCount: number
  unlinkedCount: number
  lastTimestamp?: string
  lastProvider?: string
  lastModel?: string
  boundary?: HermesTraceSummaryInput['boundary']
  source?: HermesTraceSummaryInput['source']
  coverage: 'aucune' | 'partielle' | 'rattachée' | 'non-rattachée'
} {
  const ordered = [...traces].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  const linkedCount = ordered.filter((trace) => Boolean(trace.conversationId)).length
  const last = ordered.at(-1)
  return {
    count: ordered.length,
    linkedCount,
    unlinkedCount: ordered.length - linkedCount,
    ...(last ? {
      lastTimestamp: last.timestamp,
      lastProvider: last.provider,
      lastModel: last.model,
      boundary: last.boundary,
      source: last.source
    } : {}),
    coverage: ordered.length === 0 ? 'aucune' : linkedCount === 0 ? 'non-rattachée' : linkedCount === ordered.length ? 'rattachée' : 'partielle'
  }
}
