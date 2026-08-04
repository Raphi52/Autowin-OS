import { describe, expect, it } from 'vitest'
import { AutowinOS } from './os'
import { ExecutionSupervisor } from './execution-supervisor'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'

class ChatProvider implements ProviderAdapter {
  readonly id = 'chat-provider'
  calls = 0

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    _options?: SendOptions
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    yield { delta: '' }
    return {
      text: 'ok',
      provider: this.id,
      systemInjected: true,
      usage: { inputTokens: 4, outputTokens: 1 }
    }
  }
}

describe('AutowinOS.chat — enveloppe commune', () => {
  it('comptabilise le provider direct dans un ExecutionSupervisor', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new ChatProvider()
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperties(os, {
      executionSupervisor: { value: supervisor },
      registry: { value: new ProviderRegistry(undefined, supervisor).register(provider) },
      roles: {
        value: new RoleModelConfig({
          orchestrator: { provider: provider.id, model: 'chat-model' }
        })
      },
      cost: { value: new CostAggregator() }
    })

    await os.chat(undefined, 'orchestrator', [{ role: 'user', content: 'bonjour' }], () => {})

    expect(provider.calls).toBe(1)
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      completedCalls: 1,
      totalTokens: 5
    })
  })

  it('refuse le second appel du meme tour de chat avant le provider', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider = new ChatProvider()
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperties(os, {
      executionSupervisor: { value: supervisor },
      registry: { value: new ProviderRegistry(undefined, supervisor).register(provider) },
      roles: {
        value: new RoleModelConfig({
          orchestrator: { provider: provider.id, model: 'chat-model' }
        })
      },
      cost: { value: new CostAggregator() }
    })
    const previousCap = process.env.AUTOWIN_CHAT_CALL_CAP
    process.env.AUTOWIN_CHAT_CALL_CAP = '1'
    try {
      await os.runChatTurn('bonjour', undefined, async () => {
        await os.registry.send(provider.id, [{ role: 'user', content: 'premier' }])
        await expect(
          os.registry.send(provider.id, [{ role: 'user', content: 'second' }])
        ).rejects.toThrow(/budget.*appels/i)
      })
    } finally {
      if (previousCap === undefined) delete process.env.AUTOWIN_CHAT_CALL_CAP
      else process.env.AUTOWIN_CHAT_CALL_CAP = previousCap
    }

    expect(provider.calls).toBe(1)
    expect(supervisor.lastSnapshot()).toMatchObject({ startedCalls: 1, completedCalls: 1 })
  })

  it("republie l'usage d'un provider de chat qui se regle apres le retour du tour", async () => {
    const supervisor = new ExecutionSupervisor()
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperty(os, 'executionSupervisor', { value: supervisor })
    const settlements: Array<NonNullable<ReturnType<typeof supervisor.lastSnapshot>>> = []
    let settleProvider: (() => void) | undefined

    await expect(
      os.runChatTurn(
        'bonjour',
        undefined,
        async () => {
          const reservation = supervisor.reserveProviderCall()
          expect(reservation).toBeDefined()
          settleProvider = () =>
            reservation?.fail({ inputTokens: 120, outputTokens: 8, cacheReadTokens: 20 })
          throw new Error('watchdog')
        },
        (usage) => settlements.push(usage)
      )
    ).rejects.toThrow('watchdog')

    expect(settlements.at(-1)).toMatchObject({ activeCalls: 1, totalTokens: 0 })
    settleProvider?.()
    expect(settlements.at(-1)).toMatchObject({
      activeCalls: 0,
      failedCalls: 1,
      totalTokens: 128,
      knownCostUsd: null
    })
  })
})
