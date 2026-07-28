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
    options.execution?.onProcess?.(4242, true)
    options.execution?.onProcess?.(4242, false)
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
  it('ne réutilise pas un identifiant de run après recréation de l’orchestrateur', async () => {
    const ids: string[] = []
    for (let instance = 0; instance < 2; instance++) {
      const { orch } = makeOrchestrator({
        begin: (id) => {
          ids.push(id)
          return 'C:\\wt\\current'
        },
        end: () => undefined
      })
      await orch.run('modifie le projet')
    }

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('propage le cycle de vie du CLI au lease du worktree', async () => {
    const process = vi.fn()
    const { orch } = makeOrchestrator({
      begin: () => 'C:\\wt\\leased',
      end: () => undefined,
      process
    })

    await orch.run('modifie le projet')

    expect(process).toHaveBeenCalled()
    expect(process.mock.calls.every(([, pid]) => pid === 4242)).toBe(true)
    expect(process.mock.calls.some(([, , active]) => active === true)).toBe(true)
    expect(process.mock.calls.some(([, , active]) => active === false)).toBe(true)
    expect(new Set(process.mock.calls.map(([runId]) => runId)).size).toBe(1)
  })

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
