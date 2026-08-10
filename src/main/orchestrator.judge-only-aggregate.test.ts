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
 * UNE DEMANDE `judge` EXPLICITE NE DOIT PAS ÊTRE CONDAMNÉE AU ROUGE PAR CONSTRUCTION.
 *
 * Mesuré sur le run réel conv-1078 (trace : 2 étapes, `judge` puis `gate`, aucune étape `exec`) :
 * `regimePhases()` rend `[]` pour une phase `judge` nommée, donc AUCUNE phase d'exécution ne tourne.
 * Le juge recevait alors « RÉPONSE (livrable agrégé de TOUTES les phases) : » vide et
 * « PREUVES OUTILS OBSERVÉES: [] », tout en étant sommé de « confronter au moins une preuve d'outil
 * ci-dessous ». Verdict inévitable : « DEFAUT: livrable agrégé vide et aucune preuve d'outil ».
 * Le gate ne faisait que recopier ce faux rouge.
 */
class CapturingProvider implements ProviderAdapter {
  readonly id = 'capturing'
  readonly supportsExecution = true
  readonly prompts: string[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void options
    this.prompts.push(messages.map((m) => m.content).join('\n'))
    return { text: 'VALIDE', provider: this.id, systemInjected: Boolean(options.system) }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

function harnais() {
  const provider = new CapturingProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    // Le cas réel : phase `judge` nommée → aucune phase d'exécution.
    execPhases: []
  })
  return {
    provider,
    lancer: () =>
      orch.run('/judge la clôture du chantier chat', undefined, undefined, undefined, undefined, undefined, [])
  }
}

describe('juge sans phase d’exécution : le prompt ne réclame pas un agrégat qui ne peut pas exister', () => {
  it('n’exige PAS « au moins une preuve d’outil ci-dessous » quand aucune phase n’a tourné', async () => {
    const { provider, lancer } = harnais()
    await lancer()
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).not.toBe('')
    expect(promptDuJuge).not.toContain('confronte au moins une preuve d')
  })

  it('dit au juge qu’il est le SEUL agent et doit inspecter lui-même le workspace', async () => {
    const { provider, lancer } = harnais()
    await lancer()
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).toContain('AUCUNE phase d’exécution')
    // Et il ne présente pas un vide comme le livrable à juger.
    expect(promptDuJuge).not.toContain('livrable agrégé de TOUTES les phases) : \n')
  })

  it('un run AVEC phases garde le contrat de preuve d’origine', async () => {
    const provider = new CapturingProvider()
    const orch = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'ouvrier' },
        judge: { provider: provider.id, model: 'juge-dedie' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\base',
      worktrees: makeTestWorktrees('C:\\base'),
      execPhases: ['build']
    })
    await orch.run('analyse le projet', undefined, undefined, undefined, undefined, undefined, [])
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).toContain('confronte au moins une preuve d')
  })
})
