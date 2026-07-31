import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

describe('AgentPilot artifact transport', () => {
  it('emits normalized provider artifacts before closing the turn', async () => {
    const artifact = {
      id: 'artifact-image',
      name: 'image.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      size: 3,
      createdAt: 1,
      encoding: 'base64' as const,
      content: 'YWJj',
      source: { provider: 'codex' }
    }
    const registry = {
      send: vi.fn(
        async (_provider: string, _messages: Message[], _options: SendOptions): Promise<SendResult> =>
          ({
            text: 'Image générée.',
            provider: 'codex',
            systemInjected: true,
            artifacts: [artifact]
          }) as SendResult
      ),
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-test' })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn()
    }
    const events: Array<{ kind: string; artifact?: unknown }> = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'Crée une image' }],
      (event) => events.push(event),
      undefined,
      2,
      'conv-artifact'
    )

    expect(events.find((event) => event.kind === 'artifact')?.artifact).toEqual(artifact)
    expect(events.at(-1)?.kind).toBe('done')
  })
})
