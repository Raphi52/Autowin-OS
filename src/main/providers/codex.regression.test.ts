import { describe, it, expect } from 'vitest'
import { CodexAdapter } from './codex'
import type { Message } from './types'

/** Response SSE mockée où le DERNIER event n'a PAS de '\n' terminal. */
function sseNoTrailingNewline(events: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            if (i >= events.length) return { done: true, value: undefined }
            return { done: false, value: encoder.encode(events[i++]) }
          }
        }
      }
    }
  } as unknown as Response
}

const tokens = { accessToken: 'AT', refreshToken: 'RT', obtainedAt: Date.now(), expiresInSec: 3600 }
const conv: Message[] = [{ role: 'user', content: 'x' }]

// Non-régression (judge corrector cycle 1) : le reliquat de buffer (dernier
// `data:` sans '\n' final) doit être flushé, sinon le dernier delta et le
// response.completed (session_id) sont perdus silencieusement.
describe('CodexAdapter — flush du reliquat SSE (régression judge)', () => {
  it('parse le dernier event même sans newline terminal', async () => {
    const fetchFn = async (): Promise<Response> =>
      sseNoTrailingNewline([
        'data: {"type":"response.output_text.delta","delta":"FIN"}\n',
        // dernier event SANS '\n' final :
        'data: {"type":"response.completed","response":{"id":"resp_last"}}'
      ])
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, { system: 'SOUL' })
    let s = await gen.next()
    while (!s.done) s = await gen.next()
    // AVANT le fix : sessionId restait undefined (dernier event jamais parsé).
    expect(s.value.sessionId).toBe('resp_last')
    expect(s.value.text).toBe('FIN')
  })

  it('un delta final sans newline n’est pas perdu', async () => {
    const fetchFn = async (): Promise<Response> =>
      sseNoTrailingNewline(['data: {"type":"response.output_text.delta","delta":"BOUT"}'])
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, {})
    let s = await gen.next()
    let text = ''
    while (!s.done) {
      text += s.value.delta
      s = await gen.next()
    }
    expect(s.value.text).toBe('BOUT')
    expect(text).toBe('BOUT')
  })
})
