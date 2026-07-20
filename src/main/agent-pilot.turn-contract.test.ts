import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'

describe('AgentPilot turn contract', () => {
  it('binds the conversation authority mode to every command in the turn', async () => {
    const responses = [
      '<cmd>{"name":"remove_conversation","args":{"id":"conv-1"}}</cmd>',
      'Refus confirmé'
    ]
    const registry = {
      send: vi.fn().mockImplementation(async () => ({ text: responses.shift()!, provider: 'codex' })),
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'remove_conversation', args: { id: 'id' }, description: 'remove' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'Action interdite en mode Plan' })
    }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'supprime' }],
      () => undefined,
      undefined,
      2,
      'conv-1',
      undefined,
      'plan'
    )

    expect(bus.exec).toHaveBeenCalledWith(
      'remove_conversation',
      { id: 'conv-1' },
      'conv-1',
      'plan'
    )
  })

  it('keeps the provider and model binding immutable for the whole chat turn', async () => {
    const responses = [
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      'RÃ©ponse finale'
    ]
    const send = vi.fn().mockImplementation(async () => ({
      text: responses.shift()!,
      provider: 'fixture'
    }))
    const describePrompt = vi.fn().mockReturnValue({
      provider: 'codex',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
    const initialBinding = {
        provider: 'codex',
        model: 'gpt-initial',
        reasoningEffort: 'low',
        capabilityProfileId: 'full'
      }
    const mutatedBinding = {
        provider: 'hermes',
        model: 'model-mutated',
        reasoningEffort: 'high',
        capabilityProfileId: 'readonly'
      }
    let bindingReadCount = 0
    const roles = {
      getBinding: vi.fn(() => (bindingReadCount++ === 0 ? initialBinding : mutatedBinding))
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: true, data: {} })
    }

    await new AgentPilot({ send, describePrompt } as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      () => undefined
    )

    expect(roles.getBinding).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
    for (const call of send.mock.calls) {
      expect(call[0]).toBe('codex')
      expect(call[2]).toMatchObject({ model: 'gpt-initial', reasoningEffort: 'low' })
    }
    for (const call of describePrompt.mock.calls) {
      expect(call[3]).toBe('gpt-initial')
    }
  })

  it('reports the iteration cap as an error terminal event, never as done', async () => {
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<cmd>{"name":"get_state","args":{}}</cmd>',
        provider: 'codex'
      }),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: true, data: {} })
    }
    const events: PilotEvent[] = []

    await expect(
      new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'boucle' }],
        (event) => events.push(event),
        undefined,
        1
      )
    ).rejects.toThrow("Cap d'itérations (1) atteint sans réponse finale")

    expect(events.at(-1)?.kind).toBe('error')
    expect(events.at(-1)?.text).toMatch(/^Cap d'.*\(1\).*sans r.*ponse finale$/)
    expect(events.some((event) => event.kind === 'done')).toBe(false)
  })
  it('stops waiting for a model question when the turn is aborted', async () => {
    const controller = new AbortController()
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<question>{"text":"Continuer ?","options":["Oui"]}</question>',
        provider: 'codex'
      }),
      describePrompt: () => ({
        provider: 'codex', transport: 'fixture', messages: [], options: {}, limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshot: async () => ({}) }
    const pending = new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'question' }],
      () => undefined,
      () => new Promise<string>(() => undefined),
      6,
      'conv-1',
      controller.signal
    )

    controller.abort('conversation-deleted')
    const result = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30))
    ])
    expect(result).toBe('rejected')
  })
})
