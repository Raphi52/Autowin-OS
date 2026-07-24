export interface NativeTraceSummaryInput {
  timestamp: string
  provider: string
  model: string
  boundary: 'native.pre_api_request'
  source: 'plugin-hook' | 'request-dump'
  conversationId?: string
  turnId?: string
}

export function summarizeNativeTraces(traces: NativeTraceSummaryInput[]): {
  count: number
  linkedCount: number
  unlinkedCount: number
  lastTimestamp?: string
  lastProvider?: string
  lastModel?: string
  boundary?: NativeTraceSummaryInput['boundary']
  source?: NativeTraceSummaryInput['source']
  coverage: 'aucune' | 'partielle' | 'rattachée' | 'non-rattachée'
} {
  const ordered = [...traces].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
  )
  const linkedCount = ordered.filter((trace) => Boolean(trace.conversationId)).length
  const last = ordered.at(-1)
  return {
    count: ordered.length,
    linkedCount,
    unlinkedCount: ordered.length - linkedCount,
    ...(last
      ? {
          lastTimestamp: last.timestamp,
          lastProvider: last.provider,
          lastModel: last.model,
          boundary: last.boundary,
          source: last.source
        }
      : {}),
    coverage:
      ordered.length === 0
        ? 'aucune'
        : linkedCount === 0
          ? 'non-rattachée'
          : linkedCount === ordered.length
            ? 'rattachée'
            : 'partielle'
  }
}
