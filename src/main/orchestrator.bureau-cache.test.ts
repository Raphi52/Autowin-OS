import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
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
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { identifiantBureauCache } from './consigne-bureau-cache'

class RecordingProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    this.calls.push(options)
    return {
      text: options.execution?.sandbox === 'read-only' ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }
}

const orchestrateur = (provider: ProviderAdapter): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\ws',
    worktrees: makeTestWorktrees('C:\ws'),
    classifyPhases: () => ['build']
  })

describe('la voie du bureau caché atteint vraiment l agent du run', () => {
  it('injecte un bloc bureauCache portant hdesk-lancer.ps1 et un bureau dérivé du runId', async () => {
    const provider = new RecordingProvider()
    await orchestrateur(provider).run('corrige un défaut visible')

    const appel = provider.calls[0]
    expect((appel.systemBlocks ?? []).map((b) => b.name)).toContain('bureauCache')
    expect(appel.system).toContain('scripts/hdesk-lancer.ps1')
    expect(appel.system).toContain('scripts/hdesk-observe.ps1')
    const bureau = String(appel.system ?? '').match(/-Id (run-[a-z0-9-]+)/)?.[1]
    expect(bureau).toBeDefined()
    expect(appel.system).toContain(`-InstanceId ${bureau}`)
  })

  it('deux runs parallèles ne reçoivent JAMAIS le même identifiant de bureau', async () => {
    const provider = new RecordingProvider()
    const orch = orchestrateur(provider)
    await Promise.all([orch.run('tâche A'), orch.run('tâche B')])

    const bureaux = provider.calls.map(
      (c) => String(c.system ?? '').match(/-Id (run-[a-z0-9-]+)/)?.[1]
    )
    const distincts = new Set(bureaux.filter(Boolean))
    expect(distincts.size).toBe(2)
    for (const d of distincts) expect(d).toBe(identifiantBureauCache(String(d).slice(4)))
  })
})
