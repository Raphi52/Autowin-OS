import { summarizeRagTrace, type RagTraceSummary } from './rag-trace-model'

export interface ObservatoryExportFilters {
  query: string
  type: string
  provider: string
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
  exportedAt: string
  conversationId: string
  filters: ObservatoryExportFilters
  limitations: string[]
  timeline: unknown
  promptCalls: unknown[]
  nativeTraces: ObservatoryExportNativeTrace[]
}

export interface ObservatoryExportNativeRag extends Omit<ObservatoryExportNativeTrace, 'request'> {
  request: Record<string, unknown>
  rag: RagTraceSummary
}

export interface ObservatoryExportV1 {
  schema: 'autowin.observatory-export/v1'
  exportedAt: string
  conversationId: string
  filters: ObservatoryExportFilters
  limitations: string[]
  timeline: unknown
  promptCalls: unknown[]
  nativeRag: ObservatoryExportNativeRag[]
}

const SECRET_VALUE =
  /(Bearer\s+)[^\s"']+|((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,"']+|\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|\bAKIA[A-Z0-9]{16}\b/gi

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    normalized === 'authorization' ||
    normalized === 'proxyauthorization' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized === 'token' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('idtoken') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password') ||
    normalized.endsWith('credential') ||
    normalized.includes('privatekey')
  )
}

function redact(value: unknown, key = ''): unknown {
  if (isSecretKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    return value.replace(
      SECRET_VALUE,
      (_match, bearer: string, assignment: string) => `${bearer || assignment || ''}[REDACTED]`
    )
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([name, item]) => [
      name,
      redact(item, name)
    ])
  )
}

export function buildObservatoryExport(input: ObservatoryExportInput): ObservatoryExportV1 {
  const nativeRag = input.nativeTraces.map((trace) => {
    if (trace.fidelity !== 'exact-redacted') {
      throw new Error(`Observatory export: Hermes fidelity must be exact-redacted`)
    }
    const request = redact(trace.request) as Record<string, unknown>
    return { ...trace, request, rag: summarizeRagTrace(request) }
  })

  return {
    schema: 'autowin.observatory-export/v1',
    exportedAt: input.exportedAt,
    conversationId: input.conversationId,
    filters: { ...input.filters },
    limitations: [...input.limitations],
    timeline: redact(input.timeline),
    promptCalls: redact(input.promptCalls) as unknown[],
    nativeRag
  }
}
