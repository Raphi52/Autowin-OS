import { describe, expect, it } from 'vitest'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { sandboxForPhase } from './orchestrator'
import { nativeSkills } from './native-registry'
import { isPipelinePhase } from './skill-pipeline'
import { phaseBrief } from './phase-briefs'

/**
 * Un nœud de graphe peut porter une SKILL du disque et pas seulement l'une des huit phases.
 *
 * Ce que ces tests gardent, et qui manquait : une brique qui FIGURE au dessin sans rien exécuter.
 * `phaseBrief` d'un identifiant hors pipeline rend une chaîne vide et la dépendance
 * `skillInstruction` n'est branchée nulle part en production — sans le chargement du kit, un nœud
 * skill partirait donc avec AUCUNE instruction, et personne ne s'en apercevrait.
 */
class ProviderCapturant implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  // Ce faux provider ne diffuse rien : il capture l'appel et rend le resultat final.
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: this.calls.length === 1 ? 'analyse rendue' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }
}

const orchestrateur = (provider: ProviderCapturant, phases: string[]): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id },
      judge: { provider: provider.id }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\workspace',
    worktrees: makeTestWorktrees('C:\\workspace'),
    execPhases: phases as never
  })

describe('nœud portant une skill du disque', () => {
  it("la skill de test existe vraiment sur disque (sinon l'assertion suivante ne prouve rien)", () => {
    const ids = nativeSkills().map((skill) => skill.id)
    expect(ids).toContain('think')
    expect(isPipelinePhase('think')).toBe(false)
  })

  it("n'a AUCUNE consigne native : le kit est sa seule source", () => {
    expect(phaseBrief('think')).toBe('')
  })

  it('injecte le corps du SKILL.md dans le prompt système, sans dépendance branchée', async () => {
    const provider = new ProviderCapturant()
    await orchestrateur(provider, ['think']).run('remets-toi dans ce dépôt')
    const systeme = provider.calls[0]?.system ?? ''
    expect(systeme).toContain('SKILL THINK')
    // Discriminant : le corps, pas seulement l'en-tête. Un chargement vide passerait le test ci-dessus.
    expect(systeme.length).toBeGreaterThan(500)
    expect(provider.calls[0].systemBlocks?.some((b) => b.name === 'skill:think')).toBe(true)
  })

  it('reste en LECTURE SEULE : seules build et clean écrivent', () => {
    expect(sandboxForPhase('modifie le bouton', 'think')).toBe('read-only')
    expect(sandboxForPhase('modifie le bouton', 'build')).toBe('danger-full-access')
  })
})
