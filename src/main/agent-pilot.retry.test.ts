import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'

describe('AgentPilot retry observable', () => {
  it('journalise l echec, la tentative puis la reponse reussie', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('transport indisponible'))
      .mockResolvedValueOnce({ text: 'Réponse finale', provider: 'codex' })
    const registry = {
      send,
      describePrompt: () => ({ provider: 'codex', transport: 'fetch', messages: [], options: {}, limitation: 'opaque' })
    }
    const roles = { getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' }) }
    const bus = { catalog: () => [], snapshot: async () => ({}) }
    const events: PilotEvent[] = []
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )
    expect(send).toHaveBeenCalledTimes(2)
    expect(events.map((event) => event.kind)).toEqual(['prompt-call', 'retry', 'prompt-call', 'think', 'done'])
    expect(events[0]).toMatchObject({ status: 'failed', error: 'transport indisponible' })
    expect(events[1]).toMatchObject({ kind: 'retry', data: { attempt: 1, maxAttempts: 2 } })
  })
  it('emet une annulation sans retry lorsque le signal utilisateur est coupe', async () => {
    const controller = new AbortController()
    const registry = {
      send: (_provider: string, _messages: unknown, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        if (options.signal?.aborted) reject(new Error('aborted'))
        else options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
      describePrompt: () => ({ provider: 'codex', transport: 'fetch', messages: [], options: {}, limitation: 'opaque' })
    }
    const roles = { getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' }) }
    const bus = { catalog: () => [], snapshot: async () => ({}) }
    const events: PilotEvent[] = []
    const pending = new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }], (event) => events.push(event), undefined, 6, 'conv-1', controller.signal
    )
    controller.abort('user')
    await expect(pending).rejects.toThrow('aborted')
    expect(events.map((event) => event.kind)).toEqual(['cancellation'])
  })
})
