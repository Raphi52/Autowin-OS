import { redactTrace } from '../../../shared/trace-redact'
import { summarizeRagTrace, type RagTraceSummary } from './rag-trace-model'
import {
  computeObservatoryTotals,
  type ObservatoryTotals,
  type ObservatoryTotalsCall
} from './observatory-totals'

export interface ObservatoryExportFilters {
  query: string
  type: string
  provider: string
}

export interface ObservatoryExportView {
  mode: 'timeline' | 'causal'
  quickFilter: string
  causalScope: string
}

export interface ObservatoryExportNativeTrace {
  apiRequestId: string
  timestamp: string
  provider: string
  model: string
  boundary: 'native.pre_api_request'
  source: 'plugin-hook' | 'request-dump'
  fidelity: 'exact-redacted'
  request: Record<string, unknown>
}

export interface ObservatoryExportInput {
  scope: 'view' | 'full'
  exportedAt: string
  conversationId: string
  filters: ObservatoryExportFilters
  view: ObservatoryExportView
  limitations: string[]
  timeline: unknown
  causalNodes: unknown[]
  promptCalls: unknown[]
  nativeTraces: ObservatoryExportNativeTrace[]
}

export interface ObservatoryExportNativeRag extends Omit<ObservatoryExportNativeTrace, 'request'> {
  request: Record<string, unknown>
  rag: RagTraceSummary
}

export interface ObservatoryExportV1 {
  schema: 'autowin.observatory-export/v1'
  scope: 'view' | 'full'
  exportedAt: string
  conversationId: string
  filters: ObservatoryExportFilters
  view: ObservatoryExportView
  limitations: string[]
  timeline: unknown
  causalNodes: unknown[]
  promptCalls: unknown[]
  nativeRag: ObservatoryExportNativeRag[]
  /**
   * Agrégats de la MÊME liste d'appels que `promptCalls`, calculés par le réducteur du bandeau
   * (`observatory-totals`). Sans eux, relire un export hors de l'app obligeait à re-dériver à la
   * main ce que la vue affichait déjà.
   */
  totaux: ObservatoryTotals
}

// Le masquage est celui de tout Autowin (src/shared/trace-redact.ts) : une copie locale de ses motifs
// ne suivrait pas ses corrections, et l'export sort de l'app.
export function buildObservatoryExport(input: ObservatoryExportInput): ObservatoryExportV1 {
  const nativeRag = input.nativeTraces.map((trace) => {
    if (trace.fidelity !== 'exact-redacted') {
      throw new Error(`Observatory export: fidelity must be exact-redacted`)
    }
    const request = redactTrace(trace.request) as Record<string, unknown>
    return { ...trace, request, rag: summarizeRagTrace(request) }
  })

  return {
    schema: 'autowin.observatory-export/v1',
    scope: input.scope,
    exportedAt: input.exportedAt,
    conversationId: input.conversationId,
    filters: { ...input.filters },
    view: { ...input.view },
    limitations: [...input.limitations],
    timeline: redactTrace(input.timeline),
    causalNodes: redactTrace(input.causalNodes) as unknown[],
    promptCalls: redactTrace(input.promptCalls) as unknown[],
    nativeRag,
    totaux: computeObservatoryTotals(input.promptCalls as ObservatoryTotalsCall[])
  }
}
