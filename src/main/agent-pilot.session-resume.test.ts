import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult, StreamChunk } from './providers/types'

/**
 * Session-resume du CHAT (levier coût — mesure 2026-07-28 : 1,85 M de cache_write en 1h, ~79 k de
 * contexte re-payé par tour). Le tour N+1 doit REPRENDRE la session ouverte au tour N et n'envoyer
 * que le dernier message, au lieu de ré-injecter tout le fil.
 */
type Captured = { options: SendOptions; content: string }

// `null` explicite, PAS `undefined` : un `undefined` passe déclenche la valeur par défaut.
function pilot(captured: Captured[], sessionId: string | null = 'sess-1') {
  const registry = {
    send: vi.fn(
      async (
        _provider: string,
        messages: Message[],
        options: SendOptions,
        _onChunk?: (c: StreamChunk) => void
      ): Promise<SendResult> => {
        captured.push({ options, content: messages.at(-1)?.content ?? '' })
        return { text: 'ok', ...(sessionId ? { sessionId } : {}) } as SendResult
      }
    ),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentPilot(registry as any, roles as any, bus as any)
}

const history = (...turns: string[]): Message[] =>
  turns.map((content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }) as Message)

describe('chat() — session-resume par conversation', () => {
  it('tour 1 : aucune session connue → fil COMPLET, sans resumeSessionId', async () => {
    const captured: Captured[] = []
    await pilot(captured).chat(history('bonjour'), () => {}, undefined, 1, 'conv-A')
    expect(captured).toHaveLength(1)
    expect(captured[0].options.resumeSessionId).toBeUndefined()
    expect(captured[0].content).toContain('bonjour')
  })

  it('tour 2 : REPREND la session et n’envoie QUE le dernier message', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-A')
    await p.chat(history('premier message', 'ma reponse', 'deuxieme message'), () => {}, undefined, 1, 'conv-A')

    expect(captured[1].options.resumeSessionId).toBe('sess-1')
    expect(captured[1].content).toContain('deuxieme message')
    // Le coeur du levier : l'historique n'est PLUS re-injecte (il vit dans la session CLI).
    expect(captured[1].content).not.toContain('premier message')
    expect(captured[1].content).not.toContain('ma reponse')
  })

  it('conversation DIFFÉRENTE → pas de fuite de session entre conversations', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    await p.chat(history('dans A'), () => {}, undefined, 1, 'conv-A')
    await p.chat(history('dans B'), () => {}, undefined, 1, 'conv-B')
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('dans B')
  })

  it('changement de MODÈLE → session invalidée (on ne reprend pas avec un autre modèle)', async () => {
    const captured: Captured[] = []
    const registry = {
      send: vi.fn(async (_p: string, m: Message[], o: SendOptions) => {
        captured.push({ options: o, content: m.at(-1)?.content ?? '' })
        return { text: 'ok', sessionId: 'sess-1' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    let model = 'opus-5'
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model })) }
    const bus = { catalog: vi.fn(() => []), snapshotForPrompt: vi.fn(async () => ({})), exec: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = new AgentPilot(registry as any, roles as any, bus as any)
    await p.chat(history('avec opus'), () => {}, undefined, 1, 'conv-A')
    model = 'haiku-4-5'
    await p.chat(history('avec opus', 'r', 'avec haiku'), () => {}, undefined, 1, 'conv-A')
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('avec opus') // fil complet re-injecte : degradation propre
  })

  it('provider qui ne rend AUCUN sessionId → comportement actuel préservé', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, null)
    await p.chat(history('un'), () => {}, undefined, 1, 'conv-A')
    await p.chat(history('un', 'deux', 'trois'), () => {}, undefined, 1, 'conv-A')
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('un') // fil complet
  })

  it('sans conversationId → jamais de resume (rien à quoi rattacher la session)', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    await p.chat(history('a'), () => {}, undefined, 1)
    await p.chat(history('a', 'b', 'c'), () => {}, undefined, 1)
    expect(captured[1].options.resumeSessionId).toBeUndefined()
  })
})
