import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { ProviderCallError } from './providers/types'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('AgentPilot retry observable', () => {
  it('journalise l echec, la tentative puis la reponse reussie', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('transport indisponible'))
      .mockResolvedValueOnce({ text: 'Réponse finale', provider: 'codex' })
    const registry = {
      send,
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fetch',
        messages: [],
        options: {},
        limitation: 'opaque'
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
    expect(send).toHaveBeenCalledTimes(2)
    expect(events.map((event) => event.kind)).toEqual([
      'prompt-call',
      'retry',
      'prompt-call',
      'think',
      'done'
    ])
    expect(events[0]).toMatchObject({ status: 'failed', error: 'transport indisponible' })
    expect(events[1]).toMatchObject({ kind: 'retry', data: { attempt: 1, maxAttempts: 2 } })
  })
  it('ne repaie pas un echec provider terminal et journalise sa consommation reelle', async () => {
    const usage = { inputTokens: 38, outputTokens: 1043, costUsd: 0.065648 }
    const send = vi.fn().mockRejectedValue(
      new ProviderCallError('Budget provider atteint', {
        code: 'error_max_budget_usd',
        retryable: false,
        usage,
        resolvedModel: 'claude-haiku-real'
      })
    )
    const registry = {
      send,
      honoursSessionResume: () => false,
      describePrompt: () => ({
        provider: 'claude',
        transport: 'spawn',
        messages: [],
        options: {},
        limitation: 'opaque'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'claude', model: 'haiku', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await expect(
      new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'test' }],
        (event) => events.push(event),
        undefined,
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { systemProfile: 'watchdog-read-only' }
      )
    ).rejects.toThrow('Budget provider atteint')

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][2]).toMatchObject({ toolProfile: 'watchdog-read-only' })
    expect(send.mock.calls[0][2].system).toContain('triage automatique')
    expect(send.mock.calls[0][2].system).not.toContain("Pour agir sur l'app")
    expect(send.mock.calls[0][2].system.length).toBeLessThan(2_000)
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'prompt-call',
        status: 'failed',
        callUsage: usage,
        resolvedModel: 'claude-haiku-real'
      })
    ])
  })
  it('emet une annulation sans retry lorsque le signal utilisateur est coupe', async () => {
    const controller = new AbortController()
    const registry = {
      send: (_provider: string, _messages: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (options.signal?.aborted) reject(new Error('aborted'))
          else options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fetch',
        messages: [],
        options: {},
        limitation: 'opaque'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []
    const pending = new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-1',
      controller.signal
    )
    controller.abort('user')
    await expect(pending).rejects.toThrow('aborted')
    expect(events.map((event) => event.kind)).toEqual(['cancellation'])
  })

  it('conserve le texte partiel lorsque l annulation arrive apres un chunk', async () => {
    const controller = new AbortController()
    let chunkReady!: () => void
    const chunkWasSent = new Promise<void>((resolve) => {
      chunkReady = resolve
    })
    const registry = {
      send: (
        _provider: string,
        _messages: unknown,
        options: { signal?: AbortSignal },
        onChunk?: (chunk: { delta: string }) => void
      ) =>
        new Promise((_resolve, reject) => {
          onChunk?.({ delta: 'Réponse partielle' })
          chunkReady()
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fetch',
        messages: [],
        options: {},
        limitation: 'opaque'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []
    const pending = new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-1',
      controller.signal
    )

    await chunkWasSent
    controller.abort('user')
    await expect(pending).rejects.toThrow('aborted')
    expect(events.map((event) => event.kind)).toEqual(['delta', 'cancellation'])
  })
})
