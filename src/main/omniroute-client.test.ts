import { describe, expect, it, vi } from 'vitest'
import { loadOmniRouteSnapshot } from './omniroute-client'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('OmniRoute supervision contract', () => {
  it('projects health, accounts and quota while stripping every secret', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/monitoring/health')) {
        return json({ status: 'healthy', system: { version: '3.8.48', uptime: 42 } })
      }
      if (url.endsWith('/api/providers/client')) {
        return json({
          connections: [
            {
              id: 'account-1',
              provider: 'claude',
              name: 'Claude travail',
              email: 'user@example.com',
              authType: 'oauth',
              isActive: true,
              accessToken: 'SECRET_ACCESS',
              refreshToken: 'SECRET_REFRESH',
              apiKey: 'SECRET_KEY',
              providerSpecificData: { cookie: 'SECRET_COOKIE' }
            }
          ]
        })
      }
      return json({
        caches: {
          'account-1': {
            quotas: { weekly: { remainingPercentage: 73, resetAt: '2026-07-27T00:00:00Z' } }
          }
        },
        lastAutoSyncAt: '2026-07-20T10:00:00Z'
      })
    })

    const snapshot = await loadOmniRouteSnapshot(fetchFn as typeof fetch)
    expect(snapshot.status).toBe('healthy')
    expect(snapshot.version).toBe('3.8.48')
    expect(snapshot.connections).toEqual([
      expect.objectContaining({
        id: 'account-1',
        provider: 'claude',
        label: 'Claude travail',
        email: 'user@example.com',
        status: 'active',
        quotas: [expect.objectContaining({ label: 'weekly', remainingPercent: 73 })]
      })
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET_|accessToken|refreshToken|apiKey|cookie/)
  })

  it('returns an actionable unavailable state when OmniRoute cannot be reached', async () => {
    const snapshot = await loadOmniRouteSnapshot(async () => {
      throw new Error('ECONNREFUSED with private details')
    })
    expect(snapshot).toEqual(
      expect.objectContaining({ status: 'unavailable', connections: [], sources: [] })
    )
    expect(JSON.stringify(snapshot)).not.toContain('private details')
  })

  it('keeps partial data when one source fails', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/monitoring/health')) return json({ status: 'healthy' })
      if (url.endsWith('/api/providers/client')) return json({ error: 'nope' }, 500)
      return json({ caches: {} })
    })
    const snapshot = await loadOmniRouteSnapshot(fetchFn as typeof fetch)
    expect(snapshot.status).toBe('degraded')
    expect(snapshot.sources).toContainEqual({ id: 'connections', status: 'error' })
    expect(snapshot.sources).toContainEqual({ id: 'health', status: 'ok' })
    expect(snapshot.connectionCount).toBeUndefined()
    expect(snapshot.availableConnectionCount).toBeUndefined()
    expect(snapshot.protections).toEqual({
      circuitBreakers: undefined,
      lockouts: undefined,
      quotaAlerts: undefined
    })
  })

  it('rejects successful responses whose endpoint schema is malformed', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/monitoring/health')) return json({ status: 'healthy' })
      if (url.endsWith('/api/providers/client')) return json({ error: 'schema changed' })
      return json({ caches: [] })
    })
    const snapshot = await loadOmniRouteSnapshot(fetchFn as typeof fetch)
    expect(snapshot.status).toBe('degraded')
    expect(snapshot.sources).toEqual([
      { id: 'health', status: 'ok' },
      { id: 'connections', status: 'error' },
      { id: 'quotas', status: 'error' }
    ])
  })

  it('refuses an oversized streamed response before accepting its payload', async () => {
    const oversized = JSON.stringify({ status: 'healthy', padding: 'x'.repeat(512 * 1024) })
    const fetchFn = vi.fn(async () => json(JSON.parse(oversized)))
    const snapshot = await loadOmniRouteSnapshot(fetchFn as typeof fetch)
    expect(snapshot.status).toBe('unavailable')
  })

  it('refuses a declared oversized response before reading its body', async () => {
    const cancel = vi.fn()
    const fetchFn = vi.fn(async () => ({
      ok: true,
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': String(512 * 1024 + 1)
      }),
      body: { getReader: () => ({ read: vi.fn(), cancel, releaseLock: vi.fn() }) }
    }))
    const snapshot = await loadOmniRouteSnapshot(fetchFn as unknown as typeof fetch)
    expect(snapshot.status).toBe('unavailable')
    expect(cancel).not.toHaveBeenCalled()
  })

  it('projects only a bounded incident category and date, never its raw message', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/monitoring/health')) return json({ status: 'healthy' })
      if (url.endsWith('/api/providers/client')) {
        return json({
          connections: [
            {
              id: 'account-1',
              provider: 'claude',
              status: 'error',
              lastError: 'SECRET_REFRESH raw upstream failure',
              lastErrorAt: '2026-07-20T12:00:00Z'
            }
          ]
        })
      }
      return json({ caches: {} })
    })
    const snapshot = await loadOmniRouteSnapshot(fetchFn as typeof fetch)
    expect(snapshot.connections[0].incident).toEqual({
      label: 'Connexion signalée en erreur',
      at: '2026-07-20T12:00:00Z'
    })
    expect(JSON.stringify(snapshot)).not.toContain('SECRET_REFRESH')
  })
})
