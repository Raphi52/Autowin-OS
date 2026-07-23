export const NATIVE_PREFLIGHT_SCHEMA = 'autowin.native-preflight/v1' as const
export const NATIVE_TRACE_SOURCE = 'native' as const
export const NATIVE_TRACE_BOUNDARY = 'native.pre_api_request' as const
export const NATIVE_TRACE_FIDELITY = 'exact-redacted' as const

export interface NativePreflightWireV1 {
  schema: typeof NATIVE_PREFLIGHT_SCHEMA
  source: typeof NATIVE_TRACE_SOURCE
  timestamp: string
  session_id: string
  turn_id: string
  api_request_id: string
  provider: string
  model: string
  api_mode?: string
  conversation_id?: string
  request: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function requiredString(source: Record<string, unknown>, key: string): void {
  if (typeof source[key] !== 'string' || source[key].trim() === '') {
    throw new Error(`Native trace: ${key} absent`)
  }
}

export function assertNativePreflightWire(value: unknown): NativePreflightWireV1 {
  const source = record(value)
  if (!source) throw new Error('Native trace: objet absent')
  if (source.schema !== NATIVE_PREFLIGHT_SCHEMA) throw new Error('Native trace: schéma invalide')
  if (source.source !== NATIVE_TRACE_SOURCE) throw new Error('Native trace: source invalide')
  for (const key of ['timestamp', 'session_id', 'turn_id', 'api_request_id', 'provider', 'model']) {
    requiredString(source, key)
  }
  if (!Number.isFinite(Date.parse(source.timestamp as string))) {
    throw new Error('Native trace: timestamp invalide')
  }
  if (!record(source.request) || !record(record(source.request)?.body)) {
    throw new Error('Native trace: request.body absent')
  }
  return value as NativePreflightWireV1
}
