import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const SCHEMA = 'autowin.hermes-preflight/v1'
const MAX_READ_BYTES = 4 * 1024 * 1024
const SECRET_VALUE =
  /(Bearer\s+)[^\s"']+|((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,"']+|\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi

function secretKey(key: string): boolean {
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

export function resolveHermesSessionsRoot(
  home: string,
  localAppData?: string,
  hermesHome?: string
): string {
  return join(
    hermesHome || (localAppData ? join(localAppData, 'hermes') : join(home, '.hermes')),
    'sessions'
  )
}

export function secureHermesSpool(root: string): boolean {
  mkdirSync(root, { recursive: true })
  if (process.platform !== 'win32') return true
  const user = `${process.env['USERDOMAIN'] ?? ''}\\${process.env['USERNAME'] ?? ''}`.replace(
    /^\\|\\$/g,
    ''
  )
  if (!user) return false
  const secure = (path: string, directory: boolean): boolean =>
    spawnSync(
      'icacls',
      [
        path,
        '/inheritance:r',
        '/grant:r',
        directory ? `${user}:(OI)(CI)F` : `${user}:F`,
        '*S-1-5-18:F',
        '*S-1-5-32-544:F'
      ],
      { windowsHide: true }
    ).status === 0
  if (!secure(root, true)) return false
  return ['events.jsonl', 'events.previous.jsonl']
    .filter((name) => existsSync(join(root, name)))
    .every((name) => secure(join(root, name), false))
}

export interface HermesPreflightTrace {
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
  boundary: 'hermes.pre_api_request' | 'hermes.request_dump'
  source: 'plugin-hook' | 'request-dump'
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function redact(value: unknown, key = ''): unknown {
  if (secretKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    return value.replace(
      SECRET_VALUE,
      (_match, bearer: string, assignment: string) => `${bearer || assignment || ''}[REDACTED]`
    )
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(
    Object.entries(object).map(([name, item]) => [name, redact(item, name)])
  )
}

export function normalizeHermesPreflight(raw: unknown): HermesPreflightTrace {
  const source = record(raw)
  const request = record(source?.request)
  const body = record(request?.body)
  if (source?.schema !== SCHEMA || !body) throw new Error('Hermes trace: request.body absent')
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
    boundary: 'hermes.pre_api_request',
    source: 'plugin-hook',
    messageCount: messages.length,
    toolCount: tools.length,
    request: redact(request) as Record<string, unknown>
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

function readRequestDumps(root: string): HermesPreflightTrace[] {
  if (!existsSync(root)) return []
  const events: HermesPreflightTrace[] = []
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^request_dump_.*\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .slice(-500)
  for (const name of files) {
    try {
      const source = record(JSON.parse(readFileSync(join(root, name), 'utf8')))
      const request = record(source?.request)
      const body = record(request?.body)
      if (!request || !body) continue
      const messages = Array.isArray(body.messages)
        ? body.messages
        : Array.isArray(body.input)
          ? body.input
          : []
      const tools = Array.isArray(body.tools) ? body.tools : []
      events.push({
        schema: SCHEMA,
        timestamp:
          typeof source?.timestamp === 'string' ? source.timestamp : new Date(0).toISOString(),
        sessionId: String(source?.session_id ?? 'unknown'),
        turnId: 'unknown',
        apiRequestId: `dump:${name}`,
        provider: 'unknown',
        model: String(body.model ?? 'unknown'),
        fidelity: 'exact-redacted',
        boundary: 'hermes.request_dump',
        source: 'request-dump',
        messageCount: messages.length,
        toolCount: tools.length,
        request: redact(request) as Record<string, unknown>
      })
    } catch {
      // Un dump partiellement écrit n'empêche pas la lecture des autres preuves.
    }
  }
  return events
}

export function readHermesPreflight(
  root: string,
  cap = 100,
  dumpRoot?: string
): HermesPreflightTrace[] {
  const events: HermesPreflightTrace[] = []
  for (const name of ['events.previous.jsonl', 'events.jsonl']) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    for (const line of readTail(path).split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        events.push(normalizeHermesPreflight(JSON.parse(line)))
      } catch {
        // Spool append-only : une ligne partielle/corrompue n'efface pas les preuves saines.
      }
    }
  }
  const observed = events.length > 0 ? events : dumpRoot ? readRequestDumps(dumpRoot) : []
  return observed
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-Math.max(0, Math.min(cap, 500)))
}

export function filterHermesPreflight(
  traces: HermesPreflightTrace[],
  conversationId?: string
): HermesPreflightTrace[] {
  return conversationId === undefined
    ? traces
    : traces.filter((trace) => trace.conversationId === conversationId)
}
