import { describe, expect, it, vi } from 'vitest'
import { AuthoritySas } from './authority/sas'
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

class CapturingProvider implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
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
              {
                type: 'file_change',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: 'm'
              },
              {
                type: 'command_execution',
                kind: 'verification',
                status: 'completed',
                ok: true,
                summary: 'v'
              }
            ]
          : undefined
    }
  }
}

function makeOrchestrator(worktrees?: RunWorktrees): {
  orch: Orchestrator
  provider: CapturingProvider
} {
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
    const begin = vi.fn((_id: string, _n: string, isMut: boolean) =>
      isMut ? 'C:\\wt\\run-1' : undefined
    )
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
      roles: new RoleModelConfig({
        subagent: { provider: 'capture', model: 'w' },
        judge: { provider: 'capture', model: 'j' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\base',
      worktrees: { begin: () => 'C:\\wt\\run-1', end }
    })

    await expect(orch.run('modifie le projet')).rejects.toBeTruthy()
    expect(end).toHaveBeenCalledTimes(1)
    // Un run PLANTÉ ne ramène pas son travail dans la base.
    expect(end.mock.calls[0][1]).toMatchObject({ merge: false })
  })

  describe('le travail ne remonte dans la base QUE si le run est vert', () => {
    it('run VERT → end({ merge: true })', async () => {
      const end = vi.fn()
      const { orch } = makeOrchestrator({ begin: () => 'C:\\wt\\run-1', end })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(false)
      expect(end.mock.calls[0][1]).toMatchObject({ merge: true })
    })

    it('run ROUGE (juge en défaut) → end({ merge: false }) : la copie reste isolée', async () => {
      // Le juge répond DEFAUT → gate bloqué → le travail ne doit PAS être fusionné.
      class RedJudgeProvider extends CapturingProvider {
        async *send(
          m: Message[],
          options: SendOptions = {}
        ): AsyncGenerator<StreamChunk, SendResult, void> {
          const first = this.calls.length === 0
          const base = super.send(m, options)
          let step = await base.next()
          while (!step.done) step = await base.next()
          return first ? step.value : { ...step.value, text: 'DEFAUT: preuve insuffisante' }
        }
      }
      const provider = new RedJudgeProvider()
      const end = vi.fn()
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        authority: new AuthoritySas(),
        executionWorkspace: 'C:\\base',
        worktrees: { begin: () => 'C:\\wt\\run-1', end }
      })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(true)
      expect(end.mock.calls[0][1]).toMatchObject({ merge: false })
    })
  })
})

/**
 * LES CHEMINS DU RAPPORT — constaté le 2026-07-29, dit par l'agent en fin de run réel : « Le rapport
 * pointe vers un worktree qui n'existe plus. » Le run écrit dans la copie isolée, rédige son rapport
 * avec ces chemins, puis `end()` fusionne et SUPPRIME la copie. Preuve COMPORTEMENTALE : on fait dire
 * au provider un chemin de worktree et on lit le rapport rendu.
 */
class PathReportingProvider implements ProviderAdapter {
  readonly id = 'paths'
  readonly supportsExecution = true
  private calls = 0
  constructor(private readonly worktreeCwd: string) {}
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    const first = this.calls === 1
    return {
      text: first ? `Module créé : ${this.worktreeCwd}\\src\\shared\\duree.ts` : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: first
        ? [
            { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'completed',
              ok: true,
              summary: 'v'
            }
          ]
        : undefined
    }
  }
}

function orchestratorReportingPaths(worktreeCwd: string, worktrees: RunWorktrees): Orchestrator {
  const provider = new PathReportingProvider(worktreeCwd)
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\base',
    worktrees
  })
}

describe('le rapport ne pointe pas vers une copie supprimée', () => {
  const WT = 'C:\\wt\\run-1'

  it('FUSIONNÉ : le chemin cité devient celui du workspace de base', async () => {
    const orch = orchestratorReportingPaths(WT, {
      begin: () => WT,
      // `end` rend le verdict REEL de la fusion — c'est lui qui decide, pas `green`.
      end: () => ({ outcome: 'merged' as const, agentId: 'a1', committed: true })
    })

    const result = await orch.run('modifie le projet')

    expect(result.result).toContain('C:\\base\\src\\shared\\duree.ts')
    // Le chemin mort ne doit plus apparaitre : c'est tout le defaut.
    expect(result.result).not.toContain(WT)
  })

  it('CONFLIT malgré un run vert : le chemin de la copie est GARDÉ et signalé', async () => {
    const orch = orchestratorReportingPaths(WT, {
      begin: () => WT,
      end: () => ({ outcome: 'conflict' as const, agentId: 'a1', files: ['src/a.ts'] })
    })

    const result = await orch.run('modifie le projet')

    // Reecrire ici serait un MENSONGE : les fichiers sont restes dans la copie.
    expect(result.result).toContain(WT)
    expect(result.result).toContain('NON fusionné')
  })

  it('run SANS copie isolée : le rapport est rendu tel quel', async () => {
    const orch = orchestratorReportingPaths('C:\\base', {
      begin: () => undefined,
      end: () => undefined
    })

    const result = await orch.run('modifie le projet')

    expect(result.result).toContain('C:\\base\\src\\shared\\duree.ts')
    expect(result.result).not.toContain('NON fusionné')
  })
})
