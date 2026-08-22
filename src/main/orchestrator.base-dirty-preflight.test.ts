import { describe, expect, it, vi } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type RunWorktrees } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'

/**
 * PRÉ-VOL BASE-DIRTY — le refus doit tomber AVANT que le run coûte quoi que ce soit, et il doit être
 * strictement en LECTURE : aucun `stash`, aucun `checkout`, aucune écriture de ref. Jusqu'ici la
 * saleté de la base n'était constatée qu'à la FINALISATION (`worktree-manager`, `reason:
 * 'base-dirty'`) : l'utilisateur payait un run entier pour apprendre que rien ne serait publié.
 */
class SpyProvider implements ProviderAdapter {
  readonly id = 'preflight'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return { text: 'VALIDE', provider: this.id, systemInjected: Boolean(options.system) }
  }
}

function makeOrchestrator(worktrees: RunWorktrees): {
  orch: Orchestrator
  provider: SpyProvider
} {
  const provider = new SpyProvider()
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
    executionWorkspace: 'C:\\base',
    worktrees
  })
  return { orch, provider }
}

describe('Orchestrator — pré-vol base-dirty (lecture seule)', () => {
  it('refuse AVANT begin() et NOMME les fichiers en cause', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    const baseDirtyFiles = vi.fn(() => ['src/main/orchestrator.ts', 'docs/note.md'])
    const { orch, provider } = makeOrchestrator({ begin, end, baseDirtyFiles })

    await expect(orch.run('modifie le projet')).rejects.toThrow(
      /src\/main\/orchestrator\.ts.*docs\/note\.md/s
    )

    expect(baseDirtyFiles).toHaveBeenCalledTimes(1)
    // Refus TÔT : aucune copie n'est créée, aucune finalisation n'est demandée, aucun agent n'est payé.
    expect(begin).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    expect(provider.calls).toHaveLength(0)
  })

  it('base propre : le run part normalement (le pré-vol ne bloque pas tout)', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    const { orch, provider } = makeOrchestrator({ begin, end, baseDirtyFiles: () => [] })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
    expect(provider.calls.length).toBeGreaterThan(0)
  })

  it('run NON-mutation : la base sale ne refuse RIEN (aucune isolation demandée)', async () => {
    const begin = vi.fn(() => undefined)
    const end = vi.fn()
    const baseDirtyFiles = vi.fn(() => ['sale.ts'])
    const { orch } = makeOrchestrator({ begin, end, baseDirtyFiles })

    await orch.run('analyse le projet sans rien changer')

    expect(begin).toHaveBeenCalledTimes(1)
  })

  it('coordinateur sans pré-vol (ancien contrat) : aucun refus inventé', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    const { orch } = makeOrchestrator({ begin, end })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
  })
})
