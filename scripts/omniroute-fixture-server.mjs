import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 20128)
const mode = process.argv[3] ?? 'healthy'
const payloads = {
  '/api/monitoring/health': {
    status: 'healthy',
    system: { version: 'fixture-3.8.48', uptime: 842 }
  },
  '/api/providers/client': {
    connections: [
      {
        id: 'claude-work',
        provider: 'claude',
        name: 'Claude Travail',
        email: 'travail@example.test',
        authType: 'oauth',
        isActive: true
      },
      {
        id: 'codex-personal',
        provider: 'codex',
        name: 'ChatGPT Personnel',
        email: 'raph@example.test',
        authType: 'oauth',
        status: 'limited',
        rateLimitedUntil: '2026-07-20T06:00:00Z'
      }
    ]
  },
  '/api/usage/provider-limits': {
    caches: {
      'claude-work': {
        quotas: { session: { remainingPercentage: 84, resetAt: '2026-07-20T09:00:00Z' } }
      },
      'codex-personal': {
        quotas: { weekly: { remainingPercentage: 23, resetAt: '2026-07-27T00:00:00Z' } }
      }
    }
  }
}

createServer((request, response) => {
  if (mode === 'partial' && request.url === '/api/providers/client') {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'fixture unavailable' }))
    return
  }
  const body = payloads[request.url]
  if (!body) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}).listen(port, '127.0.0.1', () => console.log(`omniroute-fixture:${port}`))
