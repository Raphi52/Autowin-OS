import { describe, expect, it } from 'vitest'
import { ExecutionSupervisor } from './execution-supervisor'
import { compileExecutionQuote } from './execution-quote'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'

class CountedProvider implements ProviderAdapter {
  readonly id = 'counted'
  readonly supportsExecution = true
  calls = 0

  constructor(private readonly usage: SendResult['usage'] = undefined) {}

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    _options?: SendOptions
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    yield* [] as StreamChunk[]
    return { text: 'ok', provider: this.id, systemInjected: true, usage: this.usage }
  }
}

describe('ExecutionSupervisor', () => {
  it('refuse le prochain appel AVANT de demarrer le provider', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 10, outputTokens: 2 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo', { maxProviderCalls: 1 })

    await supervisor.run(quote, undefined, async () => {
      await registry.send('counted', [{ role: 'user', content: 'premier' }])
      await expect(registry.send('counted', [{ role: 'user', content: 'second' }])).rejects.toThrow(
        /budget.*appels/i
      )
    })

    expect(provider.calls).toBe(1)
    expect(supervisor.lastSnapshot()).toMatchObject({ startedCalls: 1, completedCalls: 1 })
  })

  it('refuse avant provider une reprise deja exactement au plafond USD connu', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 1, costUsd: 0.1 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo', { maxUsd: 1 })
    const prior = {
      quoteId: quote.id,
      startedAgents: 1,
      startedCalls: 1,
      completedCalls: 1,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      totalTokens: 11,
      freshTokens: 11,
      knownCostUsd: 1,
      unpricedCalls: 0,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    await expect(
      supervisor.run(
        quote,
        undefined,
        () => registry.send('counted', [{ role: 'user', content: 'appel interdit' }]),
        prior
      )
    ).rejects.toThrow(/budget.*USD/i)

    expect(provider.calls).toBe(0)
  })

  it('refuse le onzieme agent avant le provider et conserve ce compteur a la reprise', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 1 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('refonte critique complete de toute application')
    quote.limits.maxAgents = 10
    const execution = { cwd: process.cwd(), sandbox: 'read-only' as const }

    await supervisor.run(quote, undefined, async () => {
      for (let index = 0; index < 10; index += 1) {
        await registry.send('counted', [{ role: 'user', content: `agent ${index + 1}` }], {
          execution
        })
      }
      await expect(
        registry.send('counted', [{ role: 'user', content: 'agent 11' }], { execution })
      ).rejects.toThrow(/budget.*agents/i)
    })

    expect(provider.calls).toBe(10)
    expect(supervisor.lastSnapshot()).toMatchObject({ startedAgents: 10, startedCalls: 10 })

    const prior = supervisor.lastSnapshot()
    expect(prior).toBeDefined()
    await expect(
      supervisor.run(
        quote,
        undefined,
        () =>
          registry.send('counted', [{ role: 'user', content: 'reprise interdite' }], { execution }),
        prior
      )
    ).rejects.toThrow(/budget.*agents/i)
    expect(provider.calls).toBe(10)
  })

  it('ne remet pas a zero les agents d un checkpoint legacy sans startedAgents', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 1 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('refonte critique complete de toute application')
    quote.limits.maxAgents = 3
    const prior = {
      quoteId: quote.id,
      startedCalls: 3,
      completedCalls: 3,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 3,
      outputTokens: 3,
      cacheReadTokens: 0,
      totalTokens: 6,
      freshTokens: 6,
      knownCostUsd: null,
      unpricedCalls: 3,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    await expect(
      supervisor.run(
        quote,
        undefined,
        () =>
          registry.send('counted', [{ role: 'user', content: 'agent legacy en trop' }], {
            execution: { cwd: process.cwd(), sandbox: 'read-only' }
          }),
        prior
      )
    ).rejects.toThrow(/budget.*agents/i)

    expect(provider.calls).toBe(0)
  })

  it("ne transforme pas l'usage inconnu en zero", async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider()
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')

    await supervisor.run(quote, undefined, () =>
      registry.send('counted', [{ role: 'user', content: 'sans usage' }])
    )

    expect(supervisor.lastSnapshot()).toMatchObject({
      completedCalls: 1,
      unmeteredCalls: 1,
      tokenCoverage: 'partial',
      knownCostUsd: null,
      unpricedCalls: 1
    })
  })

  it('isole les budgets de deux runs concurrents', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 1 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo', { maxProviderCalls: 1 })

    await Promise.all([
      supervisor.run(quote, undefined, () =>
        registry.send('counted', [{ role: 'user', content: 'A' }])
      ),
      supervisor.run(quote, undefined, () =>
        registry.send('counted', [{ role: 'user', content: 'B' }])
      )
    ])

    expect(provider.calls).toBe(2)
  })

  it('reprend les compteurs du run interrompu au lieu de recreer un budget neuf', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 5, outputTokens: 1 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo', { maxProviderCalls: 2 })
    const prior = {
      quoteId: quote.id,
      startedCalls: 1,
      completedCalls: 1,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: 0,
      totalTokens: 6,
      freshTokens: 6,
      knownCostUsd: null,
      unpricedCalls: 1,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    await supervisor.run(
      quote,
      undefined,
      async () => {
        await registry.send('counted', [{ role: 'user', content: 'dernier appel permis' }])
        await expect(
          registry.send('counted', [{ role: 'user', content: 'appel en trop' }])
        ).rejects.toThrow(/budget.*appels/i)
      },
      prior
    )

    expect(provider.calls).toBe(1)
    expect(supervisor.lastSnapshot()?.startedCalls).toBe(2)
  })

  it("refuse une reprise tant qu'un appel du checkpoint est encore actif", async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 5, outputTokens: 1 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo', { maxProviderCalls: 2 })
    quote.limits.maxConcurrency = 1
    const prior = {
      quoteId: quote.id,
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 0,
      activeCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      freshTokens: 0,
      knownCostUsd: null,
      unpricedCalls: 0,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    await expect(
      supervisor.run(
        quote,
        undefined,
        () => registry.send('counted', [{ role: 'user', content: 'reprise concurrente' }]),
        prior
      )
    ).rejects.toThrow(/appel.*actif|reprise.*active/i)

    expect(provider.calls).toBe(0)
    expect(supervisor.lastSnapshot()).toMatchObject({ activeCalls: 1, startedCalls: 1 })
  })

  it('publie aussi le snapshot final quand le provider se regle avant le finally', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('corrige la typo')
    const settlements: Array<NonNullable<ReturnType<typeof supervisor.currentSnapshot>>> = []
    let closureSnapshot: NonNullable<ReturnType<typeof supervisor.currentSnapshot>> | undefined

    await supervisor.run(
      quote,
      undefined,
      async () => {
        const reservation = supervisor.reserveProviderCall()
        expect(reservation).toBeDefined()
        closureSnapshot = supervisor.currentSnapshot()
        await Promise.resolve()
        reservation?.complete({ inputTokens: 120, outputTokens: 8, cacheReadTokens: 20 })
      },
      undefined,
      (usage) => settlements.push(usage)
    )

    expect(closureSnapshot).toMatchObject({ activeCalls: 1, totalTokens: 0 })
    expect(settlements).toHaveLength(1)
    expect(settlements[0]).toMatchObject({
      activeCalls: 0,
      completedCalls: 1,
      inputTokens: 120,
      outputTokens: 8,
      cacheReadTokens: 20,
      totalTokens: 128
    })
  })

  it('refuse avant provider une reprise deja exactement au plafond de tokens', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 0 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo', { maxTotalTokens: 1 })
    quote.limits.maxFreshTokens = 1
    const prior = {
      quoteId: quote.id,
      startedCalls: 0,
      completedCalls: 0,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 1,
      freshTokens: 1,
      knownCostUsd: null,
      unpricedCalls: 1,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    await expect(
      supervisor.run(
        quote,
        undefined,
        () => registry.send('counted', [{ role: 'user', content: 'appel interdit' }]),
        prior
      )
    ).rejects.toThrow(/budget tokens/i)

    expect(provider.calls).toBe(0)
  })

  it('refuse aussi la frontiere des tokens frais quand le total reste disponible', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 0 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')
    quote.limits.maxFreshTokens = 1
    const prior = {
      quoteId: quote.id,
      startedCalls: 0,
      completedCalls: 0,
      failedCalls: 0,
      activeCalls: 0,
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 9,
      totalTokens: 10,
      freshTokens: 1,
      knownCostUsd: null,
      unpricedCalls: 1,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    await expect(
      supervisor.run(
        quote,
        undefined,
        () => registry.send('counted', [{ role: 'user', content: 'appel frais interdit' }]),
        prior
      )
    ).rejects.toThrow(/tokens frais/i)

    expect(provider.calls).toBe(0)
  })

  it('refuse synchroniquement un run dont la deadline est deja expiree', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 0 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')
    quote.createdAt = new Date(Date.now() - 1_000).toISOString()
    quote.limits.maxDurationMs = 1

    await expect(
      supervisor.run(quote, undefined, () =>
        registry.send('counted', [{ role: 'user', content: 'trop tard' }])
      )
    ).rejects.toThrow(/budget duree/i)

    expect(provider.calls).toBe(0)
  })
})
