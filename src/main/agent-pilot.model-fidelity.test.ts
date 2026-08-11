import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('AgentPilot — identite du modele execute', () => {
  it('transporte le modele resolu par le provider sans remplacer le modele demande', async () => {
    const events: PilotEvent[] = []
    const registry = {
      send: vi.fn(async () => ({
        text: 'Diagnostic termine.',
        provider: 'claude',
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, costUsd: 0.001 }
      })),
      describePrompt: () => ({
        provider: 'claude',
        model: 'haiku',
        transport: 'fixture',
        messages: [],
        options: { reasoningEffort: 'low' },
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'claude', model: 'haiku', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [],
      snapshotForPrompt,
      exec: vi.fn()
    }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'trie cet incident' }],
      (event) => events.push(event),
      undefined,
      1
    )

    const promptCall = events.find((event) => event.kind === 'prompt-call') as
      (PilotEvent & { resolvedModel?: string }) | undefined
    expect(promptCall?.prompt?.model).toBe('haiku')
    expect(promptCall?.resolvedModel).toBe('claude-haiku-4-5-20251001')
  })
})
