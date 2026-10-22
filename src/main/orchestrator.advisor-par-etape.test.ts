import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig, type RoleBinding } from './roles'
import { decodeRoleBinding } from './role-store'
import { TrustLedger } from './trust/ledger'

/**
 * L'ADVISOR DE L'ÉTAPE ARRIVE AU FOURNISSEUR, ET SEULEMENT À SON ÉTAPE (conv-1083, 2026-10-22).
 *
 * Réglage : `phaseModel.build.advisorModel`. Entrée qui ferait échouer ce banc si le branchement
 * était faux : un advisor posé sur `build` qui partirait aussi sur `clean` ou `frame` (il hériterait
 * du rôle), ou qui ne partirait pas du tout.
 */
class AdvisorProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly demandes: { bloc: string; advisor?: string }[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    const noms = (options.systemBlocks ?? []).map((bloc) => bloc.name)
    this.demandes.push({
      bloc: noms.find((nom) => nom.startsWith('consigne:')) ?? '—',
      advisor: options.advisorModel
    })
    const estJuge = options.model === 'juge'
    return {
      text: estJuge ? 'VALIDE' : 'travail fait',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: estJuge
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

  async auth(): Promise<boolean> {
    return true
  }

  advisorDe(phase: string): string | undefined {
    return this.demandes.find((d) => d.bloc === `consigne:${phase}`)?.advisor
  }
}

function lancer(subagent: RoleBinding) {
  const provider = new AdvisorProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent,
      judge: { provider: 'rec', model: 'juge' },
      orchestrator: { provider: 'rec', model: 'chef' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    classifyPhases: () => ['frame', 'build', 'clean']
  })
  return { provider, fini: orch.run('ajoute un export CSV des factures') }
}

describe("l'advisor par étape", () => {
  it('build avec un advisor : il part sur build, ni sur frame ni sur clean', async () => {
    const { provider, fini } = lancer({
      provider: 'rec',
      model: 'ouvrier',
      phaseModel: { build: { advisorModel: 'claude-opus-5-5' } }
    })
    await fini
    expect(provider.advisorDe('build')).toBe('claude-opus-5-5')
    expect(provider.advisorDe('frame')).toBeUndefined()
    expect(provider.advisorDe('clean')).toBeUndefined()
  })

  it('sans réglage, aucun advisor ne part (comportement d’avant)', async () => {
    const { provider, fini } = lancer({ provider: 'rec', model: 'ouvrier' })
    await fini
    expect(provider.demandes.every((d) => d.advisor === undefined)).toBe(true)
  })

  it('le réglage survit à la relecture des réglages enregistrés', () => {
    const relu = decodeRoleBinding({
      provider: 'claude',
      phaseModel: { build: { model: 'claude-sonnet-5-5', advisorModel: ' claude-opus-5-5 ' } }
    })
    expect(relu?.phaseModel?.build).toEqual({
      model: 'claude-sonnet-5-5',
      advisorModel: 'claude-opus-5-5'
    })
    // Un advisor vide n'est pas un réglage : la relecture le refuse au lieu de l'avaler.
    expect(
      decodeRoleBinding({ provider: 'claude', phaseModel: { build: { advisorModel: '  ' } } })
    ).toBeUndefined()
  })
})
