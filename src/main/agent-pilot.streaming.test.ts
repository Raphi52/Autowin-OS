import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'

describe('AgentPilot chat streaming', () => {
  it('emits progressive visible deltas while suppressing fragmented command markup', async () => {
    const responses = [
      {
        chunks: [
          'Je ',
          'réponds. ',
          '<cm',
          'd>{"name":"get_state","args":{"target":"chat"}}</cmd>',
          ' Après action.'
        ],
        text: 'Je réponds. <cmd>{"name":"get_state","args":{"target":"chat"}}</cmd> Après action.'
      },
      { chunks: ['Tout ', 'est bon.'], text: 'Tout est bon.' }
    ]
    const send = vi.fn(
      async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const response = responses.shift()!
        for (const delta of response.chunks) onChunk?.({ delta })
        return { text: response.text, provider: 'codex' }
      }
    )
    const registry = {
      send,
      describePrompt: () => ({
        provider: 'codex', transport: 'fixture', messages: [], options: {}, limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: true, data: { source: 'fixture' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-1'
    )

    const deltas = events.filter((event) => event.kind === 'delta')
    expect(deltas.length).toBeGreaterThanOrEqual(4)
    expect(deltas.map((event) => event.text).join('')).toBe(
      'Je réponds.  Après action.Tout est bon.'
    )
    expect(JSON.stringify(deltas)).not.toContain('<cmd>')
    expect(JSON.stringify(deltas)).not.toContain('get_state')
    const command = events.find((event) => event.kind === 'command')
    const result = events.find((event) => event.kind === 'result')
    expect(command?.actionId).toBeTruthy()
    expect(result?.actionId).toBe(command?.actionId)
  })

  it('resets partial text from a failed provider attempt before retrying', async () => {
    let attempt = 0
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        attempt += 1
        onChunk?.({ delta: attempt === 1 ? 'Texte perdu' : 'Texte valide' })
        if (attempt === 1) throw new Error('transport')
        return { text: 'Texte valide', provider: 'codex' }
      },
      describePrompt: () => ({
        provider: 'codex', transport: 'fixture', messages: [], options: {}, limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshot: async () => ({}) }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    expect(events.map((event) => event.kind)).toContain('stream-reset')
    const failedStream = events.find((event) => event.kind === 'stream-reset')?.streamId
    expect(events.some((event) => event.kind === 'delta' && event.streamId === failedStream)).toBe(true)
    expect(events.filter((event) => event.kind === 'delta').at(-1)?.text).toBe('Texte valide')
  })
})
