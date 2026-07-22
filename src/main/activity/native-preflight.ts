import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redactTrace, recordOf } from './trace-redact'

/**
 * Traces de PRÉ-REQUÊTE NATIVES d'Autowin (schéma neutre, indépendant de toute source externe).
 *
 * Autowin écrit lui-même ses traces (voir native-trace-spool) au format ci-dessous et les relit ici
 * pour peupler l'Observatory (preuve d'injection + traçabilité RAG « Amitel Brain »). Aucun couplage
 * à un spool externe : le lecteur ne lit que le spool natif dont on lui passe la racine.
 */
export const PREFLIGHT_SCHEMA = 'autowin.native-preflight/v1'
const SCHEMA = PREFLIGHT_SCHEMA
const MAX_READ_BYTES = 4 * 1024 * 1024

export interface NativePreflightTrace {
  schema: typeof SCHEMA
  timestamp: string
  sessionId: string
  turnId: string
  apiRequestId: string
  provider: string
  model: string
  apiMode?: string
  conversationId?: string
  fidelity: 'exact-redacted'
  boundary: 'native.pre_api_request'
  source: 'native'
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
}

export function normalizeNativePreflight(raw: unknown): NativePreflightTrace {
  const source = recordOf(raw)
  const request = recordOf(source?.request)
  const body = recordOf(request?.body)
  if (source?.schema !== SCHEMA || !body) throw new Error('Native trace: request.body absent')
  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : []
  const tools = Array.isArray(body.tools) ? body.tools : []
  return {
    schema: SCHEMA,
    timestamp:
      typeof source.timestamp === 'string' && Number.isFinite(Date.parse(source.timestamp))
        ? source.timestamp
        : new Date(0).toISOString(),
    sessionId: String(source.session_id ?? 'unknown'),
    turnId: String(source.turn_id ?? 'unknown'),
    apiRequestId: String(source.api_request_id ?? 'unknown'),
    provider: String(source.provider ?? 'unknown'),
    model: String(source.model ?? 'unknown'),
    ...(source.api_mode ? { apiMode: String(source.api_mode) } : {}),
    ...(source.conversation_id ? { conversationId: String(source.conversation_id) } : {}),
    fidelity: 'exact-redacted',
    boundary: 'native.pre_api_request',
    source: 'native',
    messageCount: messages.length,
    toolCount: tools.length,
    request: redactTrace(request) as Record<string, unknown>
  }
}

function readTail(path: string): string {
  const size = statSync(path).size
  if (size <= MAX_READ_BYTES) return readFileSync(path, 'utf8')
  const length = MAX_READ_BYTES
  const buffer = Buffer.allocUnsafe(length)
  const descriptor = openSync(path, 'r')
  try {
    readSync(descriptor, buffer, 0, length, size - length)
  } finally {
    closeSync(descriptor)
  }
  const text = buffer.toString('utf8')
  const firstNewline = text.indexOf('\n')
  return firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
}

/** Lit les traces natives (spool JSONL append-only, rotation events.previous → events). */
export function readNativePreflight(root: string, cap = 100): NativePreflightTrace[] {
  const events: NativePreflightTrace[] = []
  for (const name of ['events.previous.jsonl', 'events.jsonl']) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    for (const line of readTail(path).split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        events.push(normalizeNativePreflight(JSON.parse(line)))
      } catch {
        // Spool append-only : une ligne partielle/corrompue n'efface pas les traces saines.
      }
    }
  }
  return events
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-Math.max(0, Math.min(cap, 500)))
}

export function filterNativePreflight(
  traces: NativePreflightTrace[],
  conversationId?: string
): NativePreflightTrace[] {
  return conversationId === undefined
    ? traces
    : traces.filter((trace) => trace.conversationId === conversationId)
}

export function createNativePreflightReader(
  load: () => NativePreflightTrace[]
): (conversationId: string) => NativePreflightTrace[] {
  return (conversationId) => filterNativePreflight(load(), conversationId)
}
