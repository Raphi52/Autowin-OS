import { describe, expect, it } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'

/**
 * Provider enregistré sous `requested` mais qui, dans sa réponse, se déclare `actual-executor`
 * (simule le reroute du registre : rôle non-exécuteur → exécuteur local). La trace et le coût
 * doivent refléter le provider RÉEL (`actual-executor`), pas le demandé.
 */
class ReroutingProvider implements ProviderAdapter {
  readonly id = 'requested'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: 'VALIDE',
      provider: 'actual-executor',
      systemInjected: true,
      usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.002 }
    }
  }
}

describe('Orchestrator — identité provider réelle dans trace + coût', () => {
  it('trace et coût attribuent le provider AYANT RÉPONDU, pas le demandé', async () => {
    const provider = new ReroutingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: 'requested', model: 'worker' },
      judge: { provider: 'requested', model: 'judge' }
    })
    const cost = new CostAggregator()
    const result = await new Orchestrator({
      registry,
      roles,
      cost,
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      execPhases: ['build']
    }).run('cadre les pistes du projet')

    // La trace montre le provider réel sur les steps exec/judge.
    const providers = result.trace
      .filter((s) => s.step === 'exec' || s.step === 'judge')
      .map((s) => s.provider)
    expect(providers).toContain('actual-executor')
    expect(providers).not.toContain('requested')

    // Le coût est agrégé sous le provider réel, jamais sous le demandé.
    expect(cost.byProvider()['actual-executor']).toBeDefined()
    expect(cost.byProvider()['requested']).toBeUndefined()
  })
})
