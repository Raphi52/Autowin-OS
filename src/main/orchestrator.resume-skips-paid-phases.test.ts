import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
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
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * REPRENDRE NE DOIT PAS REPAYER.
 *
 * Le mecanisme de saut existe (`if (resumedPhases.has(phase)) continue`) mais rien ne le prouvait :
 * aucun test ne passait `resumeOutputs`. Or c'est LA propriete qui justifie tout le reste — si la phase
 * acquise etait quand meme envoyee au provider, la reprise ne ferait qu'ajouter du contexte payant.
 *
 * On COMPTE donc les appels reellement faits au provider, phase par phase.
 */
class CountingProvider implements ProviderAdapter {
  readonly id = 'counting'
  readonly supportsExecution = true
  /** Instruction de chaque appel, pour identifier la phase demandee. */
  readonly prompts: string[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.prompts.push(messages.map((m) => m.content).join('\n'))
    const isJudge = options.model === 'judge'
    return {
      text: isJudge ? 'VALIDE' : 'travail fait',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: isJudge
        ? undefined
        : [
            { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'completed',
              ok: true,
              summary: 'v'
            }
          ]
    }
  }
}

function orchestrator(): { orch: Orchestrator; provider: CountingProvider } {
  const provider = new CountingProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['scout', 'build']
  })
  return { orch, provider }
}

/** Appels d'EXÉCUTION uniquement (le juge n'est pas une phase reprise). */
const execPrompts = (provider: CountingProvider): string[] =>
  provider.prompts.filter((p) => !p.includes('VALIDE') && p.includes('TÂCHE'))

describe('un acquis réinjecté ne repaie pas sa phase', () => {
  it('sans reprise : les DEUX phases sont envoyées au provider', async () => {
    const { orch, provider } = orchestrator()
    await orch.run('modifie le projet')
    // Reference : c'est ce nombre que la reprise doit faire baisser.
    expect(execPrompts(provider).length).toBe(2)
  })

  it('AVEC l’acquis de `scout` : une seule phase est envoyée — scout n’est PAS refait', async () => {
    const { orch, provider } = orchestrator()
    await orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [
      { phase: 'scout', text: 'exploration déjà payée' }
    ])
    expect(execPrompts(provider).length).toBe(1)
  })

  it('l’acquis est RÉINJECTÉ dans le contexte de la phase suivante (sinon il est perdu)', async () => {
    const { orch, provider } = orchestrator()
    await orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [
      { phase: 'scout', text: 'exploration déjà payée' }
    ])
    expect(execPrompts(provider)[0]).toContain('exploration déjà payée')
  })

  it('le rapport contient la phase reprise, pas seulement celle rejouée', async () => {
    const { orch } = orchestrator()
    const result = await orch.run(
      'modifie le projet',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [{ phase: 'scout', text: 'exploration déjà payée' }]
    )
    expect(result.phaseOutputs.map((output) => output.phase)).toContain('scout')
  })

  it('un acquis VIDE ne fait sauter AUCUNE phase (sinon on perd le travail sans l’avoir)', async () => {
    const { orch, provider } = orchestrator()
    await orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [
      { phase: 'scout', text: '   ' }
    ])
    expect(execPrompts(provider).length).toBe(2)
  })
})
