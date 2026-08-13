import { describe, expect, it, vi } from 'vitest'
import { resolveLatestUserMessage } from './agent-pilot'
import { AgentPilot } from './agent-pilot'
import { CONTINUATION_INSTRUCTION } from './chat-continuation'
import { classifyMutationConfidence } from './task-mutation-classifier'

describe('AgentPilot continuation routing context', () => {
  it('classifies a continuation from the last real human request', () => {
    const history = [
      { role: 'user' as const, content: 'Analyse ce dépôt en lecture seule' },
      { role: 'assistant' as const, content: 'Je commence l inspection.' },
      { role: 'user' as const, content: CONTINUATION_INSTRUCTION }
    ]

    const routingMessage = resolveLatestUserMessage(history, 'Analyse ce dépôt en lecture seule')

    expect(routingMessage).toBe('Analyse ce dépôt en lecture seule')
    expect(classifyMutationConfidence(routingMessage ?? '')).toBe('read-only')
    expect(resolveLatestUserMessage(history)).toBe(CONTINUATION_INSTRUCTION)
  })

  it('ne relance pas une commande explicite pendant la continuation', async () => {
    const registry = {
      send: vi
        .fn()
        .mockResolvedValue({ text: 'Je poursuis le tour interrompu.', provider: 'codex' }),
      describePrompt: vi.fn().mockReturnValue({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [],
      snapshotForPrompt: async () => ({ tab: 'chat' }),
      exec: vi.fn().mockResolvedValue({ ok: true, data: { valid: true } })
    }
    const originalPrompt = '/build corrige le bug'

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat(
      [
        { role: 'user', content: originalPrompt },
        { role: 'assistant', content: 'Je commence.' },
        { role: 'user', content: CONTINUATION_INSTRUCTION }
      ],
      () => undefined,
      undefined,
      1,
      'conv-continuation',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      originalPrompt
    )

    expect(bus.exec).not.toHaveBeenCalled()
    expect(registry.send).toHaveBeenCalledOnce()
  })
})
