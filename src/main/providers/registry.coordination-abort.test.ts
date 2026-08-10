import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileExecutionQuote } from '../execution-quote'
import { ExecutionSupervisor, type ExecutionUsageSnapshot } from '../execution-supervisor'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'

describe('ProviderRegistry — expiration de coordination', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("annule le signal du provider et ne déclare pas l'appel arrêté avant sa vraie fin", async () => {
    vi.stubEnv('AUTOWIN_SUBAGENT_CEILING_MS', '20')
    vi.resetModules()
    const { ProviderRegistry } = await import('./registry')
    const supervisor = new ExecutionSupervisor()
    let providerSignal: AbortSignal | undefined
    let releaseProvider!: () => void
    let markProviderSettled!: () => void
    const providerCanFinish = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const providerSettled = new Promise<void>((resolve) => {
      markProviderSettled = resolve
    })
    const provider: ProviderAdapter = {
      id: 'hanging',
      supportsExecution: true,
      auth: async () => true,
      async *send(
        _messages: Message[],
        options?: SendOptions
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        providerSignal = options?.signal
        try {
          yield { delta: 'avant timeout' }
          await providerCanFinish
          yield { delta: 'apres timeout' }
          return {
            text: 'termine tardivement',
            provider: 'hanging',
            systemInjected: true,
            usage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 20 }
          }
        } finally {
          markProviderSettled()
        }
      }
    }
    const fastProvider: ProviderAdapter = {
      id: 'fast',
      supportsExecution: true,
      auth: async () => true,
      async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
        yield* [] as StreamChunk[]
        return {
          text: 'nouveau run termine',
          provider: 'fast',
          systemInjected: true,
          usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 10 }
        }
      }
    }
    const registry = new ProviderRegistry(undefined, supervisor)
      .register(provider)
      .register(fastProvider)
    const quote = compileExecutionQuote('corrige la typo')
    const onChunk = vi.fn()
    const lateSnapshots: ExecutionUsageSnapshot[] = []

    await expect(
      supervisor.run(
        quote,
        undefined,
        () =>
          registry.send(
            'hanging',
            [{ role: 'user', content: 'reste bloqué' }],
            {
              execution: { cwd: process.cwd(), sandbox: 'read-only' }
            },
            onChunk
          ),
        undefined,
        (snapshot) => lateSnapshots.push(snapshot)
      )
    ).rejects.toThrow(/watchdog coordination/i)

    expect(providerSignal?.aborted).toBe(true)
    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      failedCalls: 0,
      activeCalls: 1
    })

    await supervisor.run(quote, undefined, () =>
      registry.send('fast', [{ role: 'user', content: 'nouvelle reprise' }], {
        execution: { cwd: process.cwd(), sandbox: 'read-only' }
      })
    )
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      completedCalls: 1,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 30,
      outputTokens: 5
    })

    releaseProvider()
    await providerSettled
    await vi.waitFor(() => {
      expect(lateSnapshots.at(-1)).toMatchObject({
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 1,
        activeCalls: 0,
        inputTokens: 120,
        outputTokens: 8,
        cacheReadTokens: 20,
        totalTokens: 128,
        freshTokens: 108,
        tokenCoverage: 'complete'
      })
    })
    expect(supervisor.lastSnapshot()).toMatchObject({
      completedCalls: 1,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 30,
      outputTokens: 5
    })
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('borne le drainage après watchdog et force la terminaison du provider récalcitrant', async () => {
    vi.stubEnv('AUTOWIN_SUBAGENT_CEILING_MS', '20')
    vi.stubEnv('AUTOWIN_SUBAGENT_DRAIN_GRACE_MS', '20')
    vi.resetModules()
    const { ProviderRegistry } = await import('./registry')
    const supervisor = new ExecutionSupervisor()
    let releaseProvider!: () => void
    let releaseFinalizer!: () => void
    let markProviderSettled!: () => void
    const providerCanFinish = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const finalizerCanFinish = new Promise<void>((resolve) => {
      releaseFinalizer = resolve
    })
    const providerSettled = new Promise<void>((resolve) => {
      markProviderSettled = resolve
    })
    const finalizerEntered = vi.fn()
    const terminate = vi.fn()
    const provider: ProviderAdapter = {
      id: 'abort-ignorant',
      supportsExecution: true,
      auth: async () => true,
      async *send(
        _messages: Message[],
        options?: SendOptions
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        options?.execution?.registerTermination?.(terminate)
        try {
          yield { delta: 'avant watchdog' }
          await providerCanFinish
          yield { delta: 'après terminaison forcée' }
          return {
            text: 'ne doit jamais être accepté',
            provider: 'abort-ignorant',
            systemInjected: true
          }
        } finally {
          // Un async-generator peut légalement rendre `done:false` depuis son finally après
          // `return()`. Ce yield ne prouve donc surtout pas la fin réelle du provider.
          finalizerEntered()
          yield { delta: 'nettoyage intermédiaire non terminal' }
          await finalizerCanFinish
          markProviderSettled()
        }
      }
    }
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')
    const onChunk = vi.fn()

    await expect(
      supervisor.run(quote, undefined, () =>
        registry.send(
          'abort-ignorant',
          [{ role: 'user', content: 'ignore volontairement abort' }],
          { execution: { cwd: process.cwd(), sandbox: 'read-only' } },
          onChunk
        )
      )
    ).rejects.toThrow(/watchdog coordination/i)

    expect(supervisor.lastSnapshot()).toMatchObject({ activeCalls: 1, failedCalls: 0 })
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1), { timeout: 1_000 })
    // Le terminateur est best-effort : tant que ce provider récalcitrant vit vraiment, son appel
    // reste actif et continue de verrouiller toute reprise au lieu de fabriquer une terminaison.
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 0,
      activeCalls: 1
    })
    releaseProvider()
    try {
      await vi.waitFor(() => expect(finalizerEntered).toHaveBeenCalledTimes(1), { timeout: 1_000 })
      expect(supervisor.lastSnapshot()).toMatchObject({
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1
      })
    } finally {
      releaseFinalizer()
    }
    await providerSettled
    await vi.waitFor(() => {
      expect(supervisor.lastSnapshot()).toMatchObject({
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 1,
        activeCalls: 0,
        unmeteredCalls: 1
      })
    })
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it("refuse un succès rendu après l'annulation déclarée du spawn", async () => {
    const { ProviderRegistry } = await import('./registry')
    const supervisor = new ExecutionSupervisor()
    const provider: ProviderAdapter = {
      id: 'cancelled-success',
      supportsExecution: true,
      auth: async () => true,
      async *send(
        _messages: Message[],
        options?: SendOptions
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        options?.execution?.onSpawnIntent?.('cancelled-token', true)
        options?.execution?.onSpawnIntent?.('cancelled-token', false)
        yield { delta: 'chunk incohérent' }
        return {
          text: 'succès incohérent',
          provider: 'cancelled-success',
          systemInjected: true
        }
      }
    }
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')
    const onChunk = vi.fn()

    await expect(
      supervisor.run(quote, undefined, () =>
        registry.send(
          'cancelled-success',
          [{ role: 'user', content: 'annule le spawn' }],
          { execution: { cwd: process.cwd(), sandbox: 'read-only' } },
          onChunk
        )
      )
    ).rejects.toThrow(/annul.*processus/i)

    expect(onChunk).not.toHaveBeenCalled()
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 1,
      activeCalls: 0,
      unmeteredCalls: 1
    })
  })
})
