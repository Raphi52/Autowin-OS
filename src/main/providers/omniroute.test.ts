import { describe, expect, it, vi } from 'vitest'
import { OmniRouteAdapter } from './omniroute'
import type { Message } from './types'

function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder()
  let index = 0
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunks[index++]))
      }
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream', ...headers }
    }
  )
}

const messages: Message[] = [{ role: 'user', content: 'Bonjour' }]

async function consume(
  adapter: OmniRouteAdapter,
  input: Message[] = messages,
  options: { requestId?: string } = {}
) {
  const deltas: string[] = []
  const generator = adapter.send(input, {
    system: 'SOUL',
    model: 'auto/coding',
    requestId: options.requestId
  })
  let step = await generator.next()
  while (!step.done) {
    deltas.push(step.value.delta)
    step = await generator.next()
  }
  return { deltas, result: step.value }
}

describe('OmniRouteAdapter', () => {
  it('streams OpenAI chunks and returns measured usage with correlation', async () => {
    let captured: { url?: string; init?: RequestInit } = {}
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init }
      return sseResponse(
        [
          'data: {"id":"r1","model":"claude-final","choices":[{"delta":{"content":"Bon"}}]}\n\n',
          'data: {"id":"r1","choices":[{"delta":{"content":"jour"}}],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
          'data: [DONE]\n\n'
        ],
        { 'x-omniroute-session-id': 'session-1', 'x-request-id': 'request-1' }
      )
    })
    const adapter = new OmniRouteAdapter({
      fetchFn: fetchFn as typeof fetch,
      credentialStore: { get: () => 'gateway-secret' },
      requestId: () => 'request-1'
    })
    const { deltas, result } = await consume(adapter)
    expect(deltas).toEqual(['Bon', 'jour'])
    expect(result).toEqual(
      expect.objectContaining({
        text: 'Bonjour',
        provider: 'omniroute',
        sessionId: 'session-1',
        systemInjected: true,
        usage: { inputTokens: 7, outputTokens: 2 }
      })
    )
    expect(captured.url).toBe('http://127.0.0.1:20128/v1/chat/completions')
    expect((captured.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer gateway-secret'
    )
    expect((captured.init?.headers as Record<string, string>)['x-request-id']).toBe('request-1')
    const body = JSON.parse(String(captured.init?.body))
    expect(body).toEqual(
      expect.objectContaining({ model: 'auto/coding', stream: true, stream_options: { include_usage: true } })
    )
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SOUL' })
  })

  it('reports missing auth without calling the endpoint or leaking remote details', async () => {
    const fetchFn = vi.fn()
    const adapter = new OmniRouteAdapter({
      fetchFn: fetchFn as typeof fetch,
      credentialStore: { get: () => null }
    })
    await expect(consume(adapter)).rejects.toThrow(/non authentifié/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('fails a truncated stream instead of returning a false completed answer', async () => {
    const adapter = new OmniRouteAdapter({
      fetchFn: vi.fn(async () =>
        sseResponse(['data: {"choices":[{"delta":{"content":"partiel"}}]}\n\n'])
      ) as typeof fetch,
      credentialStore: { get: () => 'secret' }
    })
    await expect(consume(adapter)).rejects.toThrow(/flux.*incomplet/i)
  })

  it('rejects binary file attachments before any network call', async () => {
    const fetchFn = vi.fn()
    const adapter = new OmniRouteAdapter({
      fetchFn: fetchFn as typeof fetch,
      credentialStore: { get: () => 'secret' }
    })
    const withFile: Message[] = [{
      role: 'user',
      content: 'Lis ceci',
      attachments: [{
        name: 'document.pdf', mimeType: 'application/pdf', size: 3, kind: 'file', content: 'YWJj'
      }]
    }]
    await expect(consume(adapter, withFile)).rejects.toThrow(/pièce jointe/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('never includes a hostile upstream body or credential in its error', async () => {
    const adapter = new OmniRouteAdapter({
      fetchFn: vi.fn(async () =>
        new Response('{"error":"SECRET_REMOTE gateway-secret"}', {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      ) as typeof fetch,
      credentialStore: { get: () => 'gateway-secret' }
    })
    let message = ''
    try {
      await consume(adapter)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/HTTP 401/)
    expect(message).not.toMatch(/SECRET_REMOTE|gateway-secret/)
  })

  it('reuses the turn request id and never duplicates incoming system messages', async () => {
    const calls: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = []
    const adapter = new OmniRouteAdapter({
      fetchFn: vi.fn(async (_url, init) => {
        calls.push({
          headers: init?.headers as Record<string, string>,
          body: JSON.parse(String(init?.body))
        })
        return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'])
      }) as typeof fetch,
      credentialStore: { get: () => 'secret' }
    })
    const input: Message[] = [
      { role: 'system', content: 'SYSTEME EN DOUBLE' },
      { role: 'user', content: 'Question' }
    ]
    await consume(adapter, input, { requestId: 'stable-turn-id' })
    await consume(adapter, input, { requestId: 'stable-turn-id' })
    expect(calls.map((call) => call.headers['idempotency-key'])).toEqual([
      'stable-turn-id',
      'stable-turn-id'
    ])
    expect((calls[0].body.messages as Array<{ role: string }>).filter((m) => m.role === 'system'))
      .toHaveLength(1)
  })

  it('fails closed when a tool call is returned but unsupported', async () => {
    const adapter = new OmniRouteAdapter({
      fetchFn: vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1"}]}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      ) as typeof fetch,
      credentialStore: { get: () => 'secret' }
    })
    await expect(consume(adapter)).rejects.toThrow(/tool call/i)
  })
})
