import { describe, expect, it } from 'vitest'
import { ExecutionSupervisor } from './execution-supervisor'
import { ProviderCallError } from './providers/types'
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
  it('publie l’identité exacte de chaque réservation active puis la retire au règlement', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('suivre deux membres du fan-out')
    quote.limits.maxProviderCalls = 2
    quote.limits.maxConcurrency = 2

    await supervisor.run(quote, undefined, async () => {
      const first = supervisor.reserveProviderCall()!
      const second = supervisor.reserveProviderCall()!
      expect(supervisor.currentSnapshot()?.activeReservationIds).toEqual([first.id, second.id])

      first.fail()
      expect(supervisor.currentSnapshot()?.activeReservationIds).toEqual([second.id])

      second.complete()
      expect(supervisor.currentSnapshot()?.activeReservationIds).toEqual([])
    })

    expect(supervisor.lastSnapshot()).toMatchObject({
      activeCalls: 0,
      activeReservationIds: [],
      completedCalls: 1,
      failedCalls: 1
    })
  })

  it('lie la réservation du registre au token de spawn avant tout lancement', async () => {
    const supervisor = new ExecutionSupervisor()
    let observedReservationId: string | undefined
    let settledReservationId: string | undefined
    const provider: ProviderAdapter = {
      id: 'reservation-aware',
      supportsExecution: true,
      auth: async () => true,
      async *send(_messages, options) {
        options?.execution?.onSpawnIntent?.('agent-token', true)
        yield* [] as StreamChunk[]
        return { text: 'ok', provider: 'reservation-aware', systemInjected: true }
      }
    }
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('lier une occurrence à son coût')

    await supervisor.run(quote, undefined, async () => {
      await registry.send('reservation-aware', [{ role: 'user', content: 'go' }], {
        execution: {
          cwd: process.cwd(),
          sandbox: 'read-only',
          onSpawnIntent: (_token, active, reservationId) => {
            if (active) observedReservationId = reservationId
          },
          onReservationSettled: (reservationId) => {
            settledReservationId = reservationId
          }
        }
      })
    })

    expect(observedReservationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(settledReservationId).toBe(observedReservationId)
  })

  it('regle un appel echoue avec la consommation reelle portee par le provider', async () => {
    const supervisor = new ExecutionSupervisor()
    const usage = { inputTokens: 38, outputTokens: 1043, cacheReadTokens: 12, costUsd: 0.065648 }
    const provider: ProviderAdapter = {
      id: 'terminal-cost',
      auth: async () => true,
      // The provider contract requires a generator; this fixture fails before its first chunk.
      // eslint-disable-next-line require-yield
      async *send() {
        throw new ProviderCallError('Budget provider atteint', {
          code: 'error_max_budget_usd',
          retryable: false,
          usage,
          resolvedModel: 'provider-model-real'
        })
      }
    }
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('mesurer un appel provider coupe par sa borne')

    await supervisor.run(quote, undefined, async () => {
      await expect(
        registry.send('terminal-cost', [{ role: 'user', content: 'go' }])
      ).rejects.toThrow('Budget provider atteint')
    })

    expect(supervisor.lastSnapshot()).toMatchObject({
      failedCalls: 1,
      unmeteredCalls: 0,
      unpricedCalls: 0,
      inputTokens: 38,
      outputTokens: 1043,
      cacheReadTokens: 12,
      totalTokens: 1081,
      knownCostUsd: 0.065648
    })
  })

  it('reserve tout le fan-out autorise sans sur-reserver le budget tokens', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('analyse trois pistes')
    quote.limits.maxProviderCalls = 3
    quote.limits.maxConcurrency = 3
    quote.limits.maxTotalTokens = 300
    quote.limits.maxFreshTokens = 300

    await supervisor.run(quote, undefined, async () => {
      expect(supervisor.reserveProviderCall()).toBeDefined()
      expect(supervisor.reserveProviderCall()).toBeDefined()
      expect(supervisor.reserveProviderCall()).toBeDefined()
      expect(() => supervisor.reserveProviderCall()).toThrow(/budget.*appels/i)
    })

    expect(supervisor.lastSnapshot()).toMatchObject({ startedCalls: 3, activeCalls: 3 })
  })

  it('interrompt le fan-out restant quand un reglement consomme ses reservations', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('analyse trois pistes')
    quote.limits.maxProviderCalls = 3
    quote.limits.maxConcurrency = 3
    quote.limits.maxTotalTokens = 300
    quote.limits.maxFreshTokens = 300

    await supervisor.run(quote, undefined, async () => {
      const first = supervisor.reserveProviderCall()!
      const second = supervisor.reserveProviderCall()!
      const third = supervisor.reserveProviderCall()!

      first.complete({ inputTokens: 90, outputTokens: 90 })

      expect(second.signal.aborted).toBe(true)
      expect(third.signal.aborted).toBe(true)
    })
  })

  it("n'admet aucun appel dont la reservation tokens serait nulle", async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('analyse trois pistes')
    quote.limits.maxProviderCalls = 3
    quote.limits.maxConcurrency = 3
    quote.limits.maxTotalTokens = 1
    quote.limits.maxFreshTokens = 1

    await supervisor.run(quote, undefined, async () => {
      expect(supervisor.reserveProviderCall()).toBeDefined()
      expect(() => supervisor.reserveProviderCall()).toThrow(/budget.*tokens/i)
    })

    expect(supervisor.lastSnapshot()).toMatchObject({ startedCalls: 1, activeCalls: 1 })
  })

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

  /**
   * Défaut CONSTATÉ EN RÉEL le 2026-08-05, dans le log de démarrage : deux runs repris ont échoué
   * instantanément — « budget duree depasse (7200000 ms) » — sans jouer une seule phase. Le devis
   * étant persisté avec le run, l'échéance se calculait depuis sa création d'origine : un run mort
   * pendant 3 h était condamné avant de commencer, et tout le travail déjà payé était perdu.
   */
  it('un devis ANCIEN ne condamne plus une reprise — la durée borne l’exécution, pas l’attente', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 0 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')
    // Devis créé il y a 3 heures, budget de 2 heures : l'ancien calcul refusait tout net.
    quote.createdAt = new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString()
    quote.limits.maxDurationMs = 2 * 60 * 60 * 1_000

    await supervisor.run(quote, undefined, () =>
      registry.send('counted', [{ role: 'user', content: 'reprise' }])
    )
    expect(provider.calls).toBe(1)
  })

  it('refuse synchroniquement un run dont la deadline est deja expiree', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new CountedProvider({ inputTokens: 1, outputTokens: 0 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const quote = compileExecutionQuote('corrige la typo')
    // Budget NUL : l'échéance court désormais depuis le début de l'exécution, donc un devis
    // simplement ANCIEN ne suffit plus à la faire expirer — c'est précisément la correction (une
    // reprise après une longue interruption était condamnée avant de jouer une phase). Le garde du
    // refus synchrone, lui, reste indispensable et c'est ce que ce test continue de prouver.
    quote.limits.maxDurationMs = 0

    await expect(
      supervisor.run(quote, undefined, () =>
        registry.send('counted', [{ role: 'user', content: 'trop tard' }])
      )
    ).rejects.toThrow(/budget duree/i)

    expect(provider.calls).toBe(0)
  })

  it('isole un reveil de fond du devis encore actif dans le contexte parent', async () => {
    const supervisor = new ExecutionSupervisor()
    const parentQuote = compileExecutionQuote('orchestration parente')
    const childQuote = compileExecutionQuote('reveil auto-kaizen')
    let childSettlement: number | null | undefined

    await supervisor.run(parentQuote, undefined, async () => {
      const parent = supervisor.reserveProviderCall()!
      parent.complete({ inputTokens: 10, outputTokens: 1, costUsd: 0.2 })

      await supervisor.runOutsideCurrent(() =>
        supervisor.run(
          childQuote,
          undefined,
          async () => {
            expect(supervisor.currentQuote()?.id).toBe(childQuote.id)
            const child = supervisor.reserveProviderCall()!
            child.complete({ inputTokens: 2, outputTokens: 1, costUsd: 0.01 })
          },
          undefined,
          (usage) => {
            childSettlement = usage.knownCostUsd
          }
        )
      )

      expect(supervisor.currentQuote()?.id).toBe(parentQuote.id)
    })

    expect(childSettlement).toBe(0.01)
    expect(supervisor.lastSnapshot()?.knownCostUsd).toBe(0.2)
  })
})
