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
 * PLUS DE PRÉ-VOL BASE-DIRTY — un run de mutation PART sur une base sale.
 *
 * Le pré-vol refusait sur l'état BRUT de `git status` : TOUS les fichiers non committés, sans
 * exception. La garde qu'il prétendait anticiper, elle, est CHIRURGICALE : `blockingDirtyFiles`
 * (`worktree-manager.ts:1455`) ne refuse que sur l'INTERSECTION entre les fichiers touchés par
 * l'agent et les fichiers sales de l'utilisateur. Le pré-vol était donc strictement plus dur que la
 * garde de fin de course, et refusait des runs qui n'auraient JAMAIS touché au travail en cours.
 *
 * Il sur-refusait par nécessité, pas par excès de prudence : au lancement, les fichiers que l'agent
 * va toucher ne sont pas encore connus (`worktree-manager.ts:3906`), donc l'intersection est
 * incalculable à cet instant. Le choix posé ici est d'assumer ce coût — un run gaspillé quand la
 * collision est RÉELLE — plutôt que de refuser en masse des runs inoffensifs.
 *
 * CE QUI NE BOUGE PAS, et ces tests l'exigent : la copie remise à l'agent exclut déjà les fichiers
 * sales du snapshot (`worktree-manager.ts:3703`), et la garde `base-dirty` de la PUBLICATION reste
 * souveraine (`worktree-manager.publication.test.ts`). Le travail non committé n'est jamais déplacé,
 * jamais stashé, jamais écrasé — c'est le filet de fin de course qui le garantit, pas le pré-vol.
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
    executionWorkspace: 'C:\base',
    worktrees
  })
  return { orch, provider }
}

describe('Orchestrator — base sale : le run PART (plus de pré-vol)', () => {
  it('mutation + base sale : la copie est créée et l’agent travaille', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    const baseDirtyFiles = vi.fn(() => ['src/main/orchestrator.ts', 'docs/note.md'])
    const { orch, provider } = makeOrchestrator({ begin, end, baseDirtyFiles })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
    expect(provider.calls.length).toBeGreaterThan(0)
  })

  it('la saleté de la base n’est même plus CONSULTÉE au lancement', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    // Un pré-vol résiduel se trahirait ici : la seule raison de lire cette liste au lancement était
    // d'en faire un refus. Personne d'autre ne la consulte sur ce chemin.
    const baseDirtyFiles = vi.fn(() => ['sale.ts'])
    const { orch } = makeOrchestrator({ begin, end, baseDirtyFiles })

    await orch.run('modifie le projet')

    expect(baseDirtyFiles).not.toHaveBeenCalled()
  })

  it('base propre : rien ne change, le run part comme avant', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    const { orch, provider } = makeOrchestrator({ begin, end, baseDirtyFiles: () => [] })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
    expect(provider.calls.length).toBeGreaterThan(0)
  })

  it('run NON-mutation sur base sale : inchangé, aucun refus', async () => {
    const begin = vi.fn(() => undefined)
    const end = vi.fn()
    const baseDirtyFiles = vi.fn(() => ['sale.ts'])
    const { orch } = makeOrchestrator({ begin, end, baseDirtyFiles })

    await orch.run('analyse le projet sans rien changer')

    expect(begin).toHaveBeenCalledTimes(1)
  })

  it('coordinateur sans pré-vol (ancien contrat) : toujours aucun refus inventé', async () => {
    const begin = vi.fn(() => 'C:\\wt\\run-1')
    const end = vi.fn()
    const { orch } = makeOrchestrator({ begin, end })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
  })
})
