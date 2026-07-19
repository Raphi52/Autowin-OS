import { describe, it, expect, vi } from 'vitest'
import { CodexAdapter } from './codex'
import { startDeviceLogin, pollForToken, refreshTokens, CODEX_CLIENT_ID } from './codex-auth'
import type { Message } from './types'

/** Fabrique une Response-like minimale pour mocker fetch. */
function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}

/** Response SSE mockée pour l'inférence Codex. */
function sseRes(events: string[]): Response {
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

const conv: Message[] = [{ role: 'user', content: 'salut' }]

describe('codex-auth — device-code flow (mocké, hors-ligne)', () => {
  it('startDeviceLogin poste le client_id et rend user_code + interval', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      void url
      void init
      return jsonRes(200, { user_code: 'WXYZ-1234', device_auth_id: 'dev1', interval: 5 })
    })
    const login = await startDeviceLogin(fetchFn as unknown as typeof fetch)
    expect(login.userCode).toBe('WXYZ-1234')
    expect(login.intervalMs).toBe(5000)
    const sent = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.client_id).toBe(CODEX_CLIENT_ID)
  })

  it('pollForToken attend (403) puis échange le code (200) contre des tokens', async () => {
    const calls: number[] = []
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('deviceauth/token')) {
        calls.push(1)
        if (calls.length < 3) return jsonRes(403, {})
        return jsonRes(200, { authorization_code: 'AC', code_verifier: 'VER' })
      }
      // oauth/token exchange
      return jsonRes(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
    })
    const tok = await pollForToken(
      { userCode: 'X', deviceAuthId: 'dev1', intervalMs: 1 },
      { fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {}, maxAttempts: 10 }
    )
    expect(tok.accessToken).toBe('AT')
    expect(tok.refreshToken).toBe('RT')
    expect(calls.length).toBe(3) // 2×403 puis 200
  })

  it('refreshTokens échange le refresh_token', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      void url
      void init
      return jsonRes(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })
    })
    const t = await refreshTokens(
      { accessToken: 'old', refreshToken: 'RT', obtainedAt: 0 },
      fetchFn as unknown as typeof fetch
    )
    expect(t.accessToken).toBe('AT2')
    // corps form-urlencoded (contrat live oauth/token), pas JSON
    const sent = new URLSearchParams((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('refresh_token')).toBe('RT')
  })
})

describe('CodexAdapter — inférence + injection (mocké, hors-ligne)', () => {
  const tokens = {
    accessToken: 'AT',
    refreshToken: 'RT',
    obtainedAt: Date.now(),
    expiresInSec: 3600
  }

  it('streame les deltas SSE et assemble le texte final', async () => {
    const fetchFn = vi.fn(async () =>
      sseRes([
        'data: {"type":"response.output_text.delta","delta":"SA"}\n',
        'data: {"type":"response.output_text.delta","delta":"LUT"}\n',
        'data: {"type":"response.completed","response":{"id":"resp_1"}}\n'
      ])
    )
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const chunks: string[] = []
    const gen = adapter.send(conv, { system: 'SOUL' })
    let step = await gen.next()
    while (!step.done) {
      chunks.push(step.value.delta)
      step = await gen.next()
    }
    expect(chunks.join('')).toBe('SALUT')
    expect(step.value.text).toBe('SALUT')
    expect(step.value.provider).toBe('codex')
    expect(step.value.sessionId).toBe('resp_1')
    expect(step.value.systemInjected).toBe(true)
  })

  it('INJECTE le système dans le champ natif `instructions` (preuve)', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, { system: 'REGLE SOUL INJECTEE' })
    let s = await gen.next()
    while (!s.done) s = await gen.next()
    expect(captured.instructions).toBe('REGLE SOUL INJECTEE') // champ natif, pas un message system
    expect((captured.input as unknown[]).length).toBe(1) // le user seul (role=system filtré)
  })

  it('transmet le modèle et l’effort choisis dans Agents', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, {
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high'
    })
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(captured.model).toBe('gpt-5.6-terra')
    expect(captured.reasoning).toEqual({ effort: 'high' })
  })

  it('sérialise réellement le texte, les images et les fichiers joints', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Analyse ces fichiers',
        attachments: [
          {
            name: 'notes.md',
            mimeType: 'text/markdown',
            size: 7,
            kind: 'text',
            content: '# Notes'
          },
          {
            name: 'capture.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: 'YWJj'
          },
          {
            name: 'document.pdf',
            mimeType: 'application/pdf',
            size: 3,
            kind: 'file',
            content: 'ZGVm'
          }
        ]
      }
    ]

    let observed: unknown
    const gen = adapter.send(messages, {
      observePrompt: (prompt) => {
        observed = prompt
      }
    })
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    const input = captured.input as Array<{ content: Array<Record<string, string>> }>
    expect(input[0].content).toEqual([
      { type: 'input_text', text: 'Analyse ces fichiers' },
      { type: 'input_text', text: '<fichier nom="notes.md">\n# Notes\n</fichier>' },
      { type: 'input_image', image_url: 'data:image/png;base64,YWJj' },
      {
        type: 'input_file',
        filename: 'document.pdf',
        file_data: 'data:application/pdf;base64,ZGVm'
      }
    ])
    expect((observed as { options: { body: unknown } }).options.body).toEqual(captured)
  })

  it('sans système → instructions absent (contrôle négatif)', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv)
    let s = await gen.next()
    while (!s.done) s = await gen.next()
    expect(captured.instructions).toBeUndefined()
  })

  it('non authentifié → auth() false et send jette', async () => {
    const adapter = new CodexAdapter({
      fetchFn: (async () => jsonRes(200, {})) as unknown as typeof fetch,
      loadTokensFn: () => null
    })
    expect(await adapter.auth()).toBe(false)
    const gen = adapter.send(conv, { system: 'x' })
    await expect(gen.next()).rejects.toThrow(/non authentifié/)
  })
})
