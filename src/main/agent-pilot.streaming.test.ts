import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  pendingDecisions: [],
  runsBlocked: [],
  conversationsCount: 0
})

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
      snapshotForPrompt,
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
    const commandIndex = events.indexOf(command!)
    const resultIndex = events.indexOf(result!)
    const trailingTextIndex = events.findIndex(
      (event) => event.kind === 'delta' && event.text?.includes('Après action')
    )
    expect(command?.actionId).toBeTruthy()
    expect(result?.actionId).toBe(command?.actionId)
    expect(commandIndex).toBeLessThan(resultIndex)
    expect(resultIndex).toBeLessThan(trailingTextIndex)
  })

  it('produces durable text-action-text parts through the real pilot event path', async () => {
    const responses = [
      {
        chunks: ['Avant.', '<cmd>{"name":"get_state","args":{"token":"secret"}}</cmd>', ' Après.'],
        text: 'Avant.<cmd>{"name":"get_state","args":{"token":"secret"}}</cmd> Après.'
      },
      { chunks: [], text: '' }
    ]
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const response = responses.shift()!
        for (const delta of response.chunks) onChunk?.({ delta })
        return { text: response.text, provider: 'codex' }
      },
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
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { source: 'fixture' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    let turn = createChatTurn('turn-1')
    for (const event of events) {
      let durable: ChatTurnEvent | undefined
      if (event.kind === 'delta' && event.streamId)
        durable = { kind: 'delta', streamId: event.streamId, text: event.text ?? '' }
      else if (event.kind === 'stream-reset' && event.streamId)
        durable = { kind: 'stream-reset', streamId: event.streamId }
      else if (event.kind === 'command' && event.actionId && event.name)
        durable = {
          kind: 'command',
          actionId: event.actionId,
          name: event.name,
          args: event.args
        }
      else if (event.kind === 'result' && event.actionId && event.name)
        durable = {
          kind: 'result',
          actionId: event.actionId,
          name: event.name,
          ok: event.ok,
          data: event.data
        }
      else if (event.kind === 'done') durable = { kind: 'done' }
      if (durable) turn = reduceChatTurn(turn, durable)
    }

    expect(turn.status).toBe('completed')
    expect(turn.parts.map((part) => part.kind)).toEqual(['text', 'action', 'text'])
    expect(turn.parts[0]).toMatchObject({ kind: 'text', text: 'Avant.' })
    expect(turn.parts[1]).toMatchObject({
      kind: 'action',
      name: 'get_state',
      args: { token: '[masqué]' },
      ok: true,
      data: { source: 'fixture' }
    })
    expect(turn.parts[2]).toMatchObject({ kind: 'text', text: ' Après.' })
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
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    expect(events.map((event) => event.kind)).toContain('stream-reset')
    const failedStream = events.find((event) => event.kind === 'stream-reset')?.streamId
    expect(events.some((event) => event.kind === 'delta' && event.streamId === failedStream)).toBe(
      true
    )
    expect(events.filter((event) => event.kind === 'delta').at(-1)?.text).toBe('Texte valide')
  })

  it('keeps the last partial stream when the final provider attempt fails', async () => {
    let attempt = 0
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        attempt += 1
        onChunk?.({ delta: attempt === 1 ? 'Premier partiel' : 'Dernier partiel' })
        throw new Error(`échec ${attempt}`)
      },
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
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await expect(
      new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'test' }],
        (event) => events.push(event)
      )
    ).rejects.toThrow('échec 2')

    expect(events.filter((event) => event.kind === 'stream-reset')).toHaveLength(1)
    const finalDelta = events.filter((event) => event.kind === 'delta').at(-1)
    expect(finalDelta?.text).toBe('Dernier partiel')
    expect(
      events.some(
        (event) => event.kind === 'stream-reset' && event.streamId === finalDelta?.streamId
      )
    ).toBe(false)
  })

  it.each(['<cm', '<cmd>{"name":"get_state"', '<question>{"question":"privé"'])(
    'never falls back to raw incomplete control markup: %s',
    async (response) => {
      const registry = {
        send: async (
          _provider: string,
          _messages: unknown,
          _options: unknown,
          onChunk?: (chunk: { delta: string }) => void
        ) => {
          onChunk?.({ delta: response })
          return { text: response, provider: 'codex' }
        },
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
      const bus = { catalog: () => [], snapshotForPrompt }
      const events: PilotEvent[] = []

      await new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'test' }],
        (event) => events.push(event)
      )

      expect(events.filter((event) => ['delta', 'think'].includes(event.kind))).toEqual([])
    }
  )
})
