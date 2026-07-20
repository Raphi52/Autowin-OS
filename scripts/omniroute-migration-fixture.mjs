import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

const option = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const port = Number(option('--port', '20128'))
const mode = option('--mode', 'happy')
const stateFile = option('--state-file', '')
const expectedToken = option('--token', 'fixture-gateway-token')
const MAX_REQUEST_BYTES = 1024 * 1024
let sequence = 0

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port invalide')
if (stateFile) mkdirSync(dirname(stateFile), { recursive: true })

function record(event) {
  if (!stateFile) return
  appendFileSync(
    stateFile,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    'utf8'
  )
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

function authorize(request, response) {
  const valid = request.headers.authorization === `Bearer ${expectedToken}`
  if (valid) return true
  record({
    kind: 'auth-rejected',
    method: request.method,
    path: request.url,
    authorization: '[REDACTED]'
  })
  sendJson(response, 401, { error: { message: 'invalid gateway credential' } })
  return false
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw new Error('request-too-large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname
  if (path === '/__fixture/state') {
    sendJson(response, 200, { mode, sequence })
    return
  }
  if (!authorize(request, response)) return

  if (request.method === 'GET' && path === '/v1/models') {
    record({ kind: 'models', method: 'GET', path, authorization: '[REDACTED]' })
    if (mode === 'models-malformed') {
      sendJson(response, 200, { data: 'not-an-array' })
      return
    }
    sendJson(response, 200, {
      object: 'list',
      data: ['auto', 'auto/coding', 'auto/fast', 'auto/cheap', 'auto/offline'].map((id) => ({
        id,
        object: 'model',
        owned_by: 'omniroute-fixture'
      }))
    })
    return
  }

  if (request.method === 'POST' && path === '/v1/chat/completions') {
    let payload
    try {
      payload = await readJson(request)
    } catch {
      sendJson(response, 400, { error: { message: 'invalid request' } })
      return
    }
    const requestId = String(request.headers['x-request-id'] ?? `fixture-request-${++sequence}`)
    const sessionId = String(request.headers['x-session-id'] ?? `fixture-session-${sequence}`)
    record({
      kind: 'chat',
      method: 'POST',
      path,
      authorization: '[REDACTED]',
      requestId: requestId.slice(0, 120),
      sessionId: sessionId.slice(0, 120),
      model: typeof payload?.model === 'string' ? payload.model.slice(0, 120) : null,
      stream: payload?.stream === true
    })
    if (mode === 'no-route') {
      sendJson(response, 400, { error: { message: 'no compatible route' } })
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-request-id': requestId,
      'x-omniroute-session-id': sessionId
    })
    const events = [
      { id: requestId, choices: [{ delta: { content: 'Route ' } }] },
      { id: requestId, choices: [{ delta: { content: 'OmniRoute ' } }] },
      {
        id: requestId,
        choices: [{ delta: { content: 'confirmée.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 }
      }
    ]
    for (const [index, event] of events.entries()) {
      response.write(`data: ${JSON.stringify(event)}\n\n`)
      if (mode === 'disconnect-after-delta' && index === 0) {
        response.destroy()
        return
      }
    }
    response.end('data: [DONE]\n\n')
    return
  }

  sendJson(response, 404, { error: { message: 'fixture route not found' } })
})

server.on('error', (error) => {
  record({ kind: 'server-error', code: error.code ?? 'unknown' })
  process.exitCode = 1
})

server.listen(port, '127.0.0.1', () => {
  record({ kind: 'ready', port, mode })
  process.stdout.write(`${JSON.stringify({ status: 'ready', port, mode })}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
