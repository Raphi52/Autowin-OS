import { describe, expect, it, vi } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type RunWorktrees } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'

class CapturingProvider implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(_m: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: this.calls.length === 1 ? 'travail' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence:
        this.calls.length === 1
          ? [
              { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
              { type: 'command_execution', kind: 'verification', status: 'completed', ok: true, summary: 'v' }
            ]
          : undefined
    }
  }
}

function makeOrchestrator(worktrees?: RunWorktrees): { orch: Orchestrator; provider: CapturingProvider } {
  const provider = new CapturingProvider()
  const registry = new ProviderRegistry().register(provider)
  const roles = new RoleModelConfig({
    subagent: { provider: provider.id, model: 'worker' },
    judge: { provider: provider.id, model: 'judge' }
  })
  const orch = new Orchestrator({
    registry,
    roles,
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\base',
    worktrees
  })
  return { orch, provider }
}

describe('Orchestrator — flip live worktree', () => {
  it('run de MUTATION : begin() route le cwd worktree dans les exécutions, end() est appelé', async () => {
    const begin = vi.fn((_id: string, _n: string, isMut: boolean) => (isMut ? 'C:\\wt\\run-1' : undefined))
    const end = vi.fn()
    const { orch, provider } = makeOrchestrator({ begin, end })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
    expect(begin.mock.calls[0][2]).toBe(true) // isMutation
    // Le sous-agent exécute dans la COPIE, pas dans la base.
    expect(provider.calls[0].execution?.cwd).toBe('C:\\wt\\run-1')
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('run NON-mutation : begin() renvoie undefined → cwd retombe sur la base', async () => {
    const begin = vi.fn(() => undefined)
    const end = vi.fn()
    const { orch, provider } = makeOrchestrator({ begin, end })

    await orch.run('analyse le projet sans rien changer')

    expect(provider.calls[0].execution?.cwd).toBe('C:\\base')
    expect(end).toHaveBeenCalledTimes(1) // end appelé même sans copie (no-op côté coordinateur)
  })

  it('end() est appelé même si le run échoue (finally)', async () => {
    const end = vi.fn()
    const failing = new ProviderRegistry() // aucun provider 'capture' → send jette
    const orch = new Orchestrator({
      registry: failing,
      roles: new RoleModelConfig({ subagent: { provider: 'capture', model: 'w' }, judge: { provider: 'capture', model: 'j' } }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\base',
      worktrees: { begin: () => 'C:\\wt\\run-1', end }
    })

    await expect(orch.run('modifie le projet')).rejects.toBeTruthy()
    expect(end).toHaveBeenCalledTimes(1)
  })
})
