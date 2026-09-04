import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * Incident Auto-Kaizen ak-9d3fa074346ba9da : la phase kaizen (rôle subagent, claude) rendait
 * `claude result error: API Error: 529 Overloaded` et l'orchestrate ENTIER échouait. Une surcharge
 * serveur explicitement temporaire ne doit pas coûter le run.
 */
class OverloadedThenOk implements ProviderAdapter {
  readonly supportsExecution = true
  calls = 0
  constructor(
    readonly id: string,
    private readonly failures: number
  ) {}
  async auth(): Promise<boolean> {
    return true
  }
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    if (this.calls <= this.failures) {
      throw new Error(
        'claude result error: API Error: 529 Overloaded. This is a server-side issue, usually temporary'
      )
    }
    return {
      text: 'VALIDE',
      provider: this.id,
      model: 'claude-opus',
      systemInjected: true,
      usage: { inputTokens: 1, outputTokens: 1 }
    }
  }
}

class AlwaysUnauthenticated implements ProviderAdapter {
  readonly id = 'sub'
  readonly supportsExecution = true
  calls = 0
  async auth(): Promise<boolean> {
    return true
  }
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    throw new Error('claude non authentifié — reconnecte le CLI')
  }
}

function orchestratorOn(provider: ProviderAdapter): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'claude-opus' },
      subagent: { provider: provider.id, model: 'claude-opus' },
      judge: { provider: provider.id, model: 'claude-opus' },
      scout: { provider: provider.id, model: 'claude-opus' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build'],
    sleep: async () => undefined
  })
}

describe('Orchestrator — surcharge API 529 sur une phase', () => {
  it('rejoue la phase et termine le run au lieu de le perdre', async () => {
    const provider = new OverloadedThenOk('sub', 1)
    const result = await orchestratorOn(provider).run('corrige le défaut nommé')
    expect(
      result.trace.filter((s) => s.step === 'exec' && s.status === 'completed').length
    ).toBeGreaterThan(0)
    expect(provider.calls).toBeGreaterThanOrEqual(2)
  })

  it("n'insiste pas sur une erreur NON transitoire (un seul appel de phase)", async () => {
    const provider = new AlwaysUnauthenticated()
    await expect(orchestratorOn(provider).run('corrige le défaut nommé')).rejects.toThrow(
      /non authentifié/
    )
    expect(provider.calls).toBe(1)
  })
})
