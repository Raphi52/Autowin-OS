const OMNIROUTE_ORIGIN = 'http://127.0.0.1:20128'
const MAX_RESPONSE_BYTES = 512 * 1024

export type OmniRouteStatus = 'healthy' | 'degraded' | 'unavailable'

export interface OmniRouteQuota {
  label: string
  remainingPercent?: number
  resetAt?: string
}

export interface OmniRouteConnection {
  id: string
  provider: string
  label?: string
  email?: string
  authType?: string
  status: 'active' | 'limited' | 'error' | 'inactive'
  incident?: { label: string; at?: string }
  quotas: OmniRouteQuota[]
}

export interface OmniRouteSnapshot {
  status: OmniRouteStatus
  version?: string
  uptimeSeconds?: number
  observedAt: string
  endpoint: string
  connections: OmniRouteConnection[]
  connectionCount?: number
  availableConnectionCount?: number
  sources: Array<{ id: 'health' | 'connections' | 'quotas'; status: 'ok' | 'error' }>
  protections?: { circuitBreakers?: number; lockouts?: number; quotaAlerts?: number }
  transportConnected: false
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function text(value: unknown, max = 160): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeDate(value: unknown): string | undefined {
  const candidate = text(value, 80)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('response-too-large')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel('response-too-large')
        throw new Error('response-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

async function fetchJson(
  fetchFn: typeof fetch,
  path: string,
  validate: (payload: JsonObject) => boolean,
  managementToken?: string | null
): Promise<JsonObject> {
  const response = await fetchFn(`${OMNIROUTE_ORIGIN}${path}`, {
    method: 'GET',
    // Comptes/quotas = endpoints ADMIN → exigent un « management token » (≠ clé API /v1).
    // Sans lui : 401. Avec la clé API : 403 « Invalid management token ». Santé passe sans.
    headers: {
      accept: 'application/json',
      ...(managementToken ? { authorization: `Bearer ${managementToken}` } : {})
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(2200)
  })
  if (!response.ok) throw new Error('http')
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    throw new Error('content-type')
  }
  const body = await readBoundedBody(response)
  const parsed = object(JSON.parse(body))
  if (!parsed || !validate(parsed)) throw new Error('invalid-schema')
  return parsed
}

function quotaMap(payload: JsonObject | undefined): Map<string, OmniRouteQuota[]> {
  const result = new Map<string, OmniRouteQuota[]>()
  const caches = object(payload?.caches)
  if (!caches) return result
  for (const [connectionId, rawCache] of Object.entries(caches)) {
    const windows = object(object(rawCache)?.quotas)
    if (!windows) continue
    const quotas = Object.entries(windows).flatMap<OmniRouteQuota>(([label, rawQuota]) => {
      const quota = object(rawQuota)
      if (!quota) return []
      const remaining = finite(quota.remainingPercentage)
      return [
        {
          label: label.slice(0, 80),
          remainingPercent:
            remaining === undefined ? undefined : Math.max(0, Math.min(100, remaining)),
          resetAt: safeDate(quota.resetAt)
        }
      ]
    })
    result.set(connectionId, quotas)
  }
  return result
}

function connectionStatus(raw: JsonObject): OmniRouteConnection['status'] {
  const status = text(raw.status)?.toLowerCase()
  if (status === 'error' || raw.lastError) return 'error'
  if (status === 'limited' || status === 'rate_limited' || raw.rateLimitedUntil) return 'limited'
  if (raw.isActive === false || status === 'inactive' || status === 'disabled') return 'inactive'
  return 'active'
}

function connectionIncident(
  raw: JsonObject,
  status: OmniRouteConnection['status']
): OmniRouteConnection['incident'] {
  if (status !== 'error' && status !== 'limited') return undefined
  return {
    label: status === 'error' ? 'Connexion signalée en erreur' : 'Limitation signalée',
    at: safeDate(raw.lastErrorAt) ?? safeDate(raw.rateLimitedUntil)
  }
}

function projectConnections(
  payload: JsonObject | undefined,
  quotas: Map<string, OmniRouteQuota[]>
): OmniRouteConnection[] {
  if (!Array.isArray(payload?.connections)) return []
  return payload.connections.flatMap<OmniRouteConnection>((entry, index) => {
    const raw = object(entry)
    if (!raw) return []
    const provider = text(raw.provider, 80)
    if (!provider) return []
    const id = text(raw.id, 120) ?? `${provider}-${index + 1}`
    const status = connectionStatus(raw)
    return [
      {
        id,
        provider,
        label: text(raw.name, 120),
        email: text(raw.email, 180),
        authType: text(raw.authType, 40),
        status,
        incident: connectionIncident(raw, status),
        quotas: quotas.get(id) ?? []
      }
    ]
  })
}

export async function loadOmniRouteSnapshot(
  fetchFn: typeof fetch = fetch,
  managementToken?: string | null
): Promise<OmniRouteSnapshot> {
  const paths = [
    [
      '/api/monitoring/health',
      'health',
      (value: JsonObject) =>
        ['healthy', 'degraded', 'unhealthy'].includes(text(value.status)?.toLowerCase() ?? '')
    ],
    [
      '/api/providers/client',
      'connections',
      (value: JsonObject) => Array.isArray(value.connections)
    ],
    ['/api/usage/provider-limits', 'quotas', (value: JsonObject) => Boolean(object(value.caches))]
  ] as const
  const settled = await Promise.allSettled(
    paths.map(([path, , validate]) => fetchJson(fetchFn, path, validate, managementToken))
  )
  if (settled.every((result) => result.status === 'rejected')) {
    return {
      status: 'unavailable',
      observedAt: new Date().toISOString(),
      endpoint: OMNIROUTE_ORIGIN,
      connections: [],
      sources: [],
      transportConnected: false
    }
  }
  const payload = (index: number): JsonObject | undefined => {
    const result = settled[index]
    return result.status === 'fulfilled' ? result.value : undefined
  }
  const health = payload(0)
  const statusText = text(health?.status)?.toLowerCase()
  const status: OmniRouteStatus =
    statusText === 'healthy' && settled.every((result) => result.status === 'fulfilled')
      ? 'healthy'
      : 'degraded'
  const system = object(health?.system)
  const quotaMonitor = object(health?.quotaMonitor)
  const quotas = quotaMap(payload(2))
  const connections = projectConnections(payload(1), quotas)
  const connectionsAvailable = settled[1].status === 'fulfilled'
  return {
    status,
    version: text(system?.version, 60),
    uptimeSeconds: finite(system?.uptime),
    observedAt: new Date().toISOString(),
    endpoint: OMNIROUTE_ORIGIN,
    connections,
    connectionCount: connectionsAvailable ? connections.length : undefined,
    availableConnectionCount: connectionsAvailable
      ? connections.filter((connection) => connection.status === 'active').length
      : undefined,
    sources: paths.map(([, id], index) => ({
      id,
      status: settled[index].status === 'fulfilled' ? 'ok' : 'error'
    })),
    protections:
      settled[0].status === 'fulfilled'
        ? {
            circuitBreakers: Array.isArray(health?.providerBreakers)
              ? health.providerBreakers.length
              : undefined,
            lockouts: Array.isArray(health?.lockouts) ? health.lockouts.length : undefined,
            quotaAlerts: finite(quotaMonitor?.alerting)
          }
        : undefined,
    transportConnected: false
  }
}

export const omniRouteDashboardUrl = `${OMNIROUTE_ORIGIN}/dashboard`
