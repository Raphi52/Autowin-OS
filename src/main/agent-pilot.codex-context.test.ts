import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { CodexAdapter } from './providers/codex'
import { ProviderRegistry } from './providers/registry'
import type { Message } from './providers/types'

function sseResponse(id: string): Response {
  const encoder = new TextEncoder()
  const events = [
    'data: {"type":"response.output_text.delta","delta":"ok"}\n',
    `data: {"type":"response.completed","response":{"id":"${id}"}}\n`
  ]
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () =>
            index < events.length
              ? { done: false, value: encoder.encode(events[index++]) }
              : { done: true, value: undefined }
        }
      }
    }
  } as unknown as Response
}

const history = (...turns: string[]): Message[] =>
  turns.map((content, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content
  })) as Message[]

describe('AgentPilot + CodexAdapter — contexte après changement de modèle', () => {
  it('réinjecte le fil complet aux tours suivants tant que Codex ne câble pas la continuation', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return sseResponse(`resp-${bodies.length}`)
    })
    const registry = new ProviderRegistry().register(
      new CodexAdapter({
        fetchFn: fetchFn as unknown as typeof fetch,
        loadTokensFn: () => ({
          accessToken: 'AT',
          refreshToken: 'RT',
          obtainedAt: Date.now(),
          expiresInSec: 3_600
        })
      })
    )
    let model = 'gpt-ancien'
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn()
    }
    const pilot = new AgentPilot(registry, roles as never, bus as never)

    await pilot.chat(history('demande initiale'), () => {}, undefined, 1, 'conv-A')
    model = 'gpt-nouveau'
    await pilot.chat(
      history('demande initiale', 'réponse initiale', 'continue avec le nouveau modèle'),
      () => {},
      undefined,
      1,
      'conv-A'
    )
    await pilot.chat(
      history(
        'demande initiale',
        'réponse initiale',
        'continue avec le nouveau modèle',
        'réponse du nouveau modèle',
        'comment ça se fait ?'
      ),
      () => {},
      undefined,
      1,
      'conv-A'
    )

    const thirdPayload = JSON.stringify(bodies[2])
    expect(thirdPayload).toContain('demande initiale')
    expect(thirdPayload).toContain('réponse du nouveau modèle')
    expect(thirdPayload).toContain('comment ça se fait ?')
  })
})
