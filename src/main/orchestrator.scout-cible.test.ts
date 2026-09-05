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
 * LE SITE D'APPEL de la garde « un scout engage une cible » (`scout-cible.ts`).
 *
 * Le module pur peut rester vert alors que PERSONNE ne l'appelle : ce test-ci echoue si la ligne de
 * cablage disparait de `recordPhase`, parce qu'il lit ce que la phase SUIVANTE recoit reellement.
 */
class Faux implements ProviderAdapter {
  readonly id = 'faux'
  constructor(private readonly avecCible: boolean) {}
  readonly supportsExecution = true
  readonly prompts: string[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const prompt = messages.map((m) => m.content).join('\n')
    this.prompts.push(prompt)
    const estJuge = prompt.includes('Tu es un juge')
    // Une shortlist SANS cible engagee : exactement le defaut que la garde doit rendre visible.
    const shortlist =
      (this.avecCible ? '## Cible\nligne 1 — corriger X, score le plus haut\n\n' : '') +
      '## Constats\n| # | Score | Type | What |\n| 1 | 82 | fix | corriger X |'
    return {
      text: estJuge ? 'VALIDE' : shortlist,
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

const promptsDuRun = async (tache: string, avecCible = false): Promise<string[]> => {
  const provider = new Faux(avecCible)
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\base',
    classifyPhases: () => ['scout', 'frame'],
    worktrees: makeTestWorktrees('C:\base'),
    execPhases: []
  })
  await orch.run(tache, undefined, undefined, undefined, undefined, undefined, [])
  return provider.prompts
}

describe('cablage : un scout sans cible ne passe pas en silence', () => {
  it('la phase suivante recoit l’avertissement en tete', async () => {
    const prompts = await promptsDuRun('améliore la vue Knowledge')
    const suite = prompts.filter((p) => p.includes("Le scout n'a engagé aucune piste"))
    expect(suite.length).toBeGreaterThan(0)
  })

  it('LE TEST SYMETRIQUE — un scout QUI engage sa cible n’est pas averti', async () => {
    const prompts = await promptsDuRun('améliore la vue Knowledge', true)
    expect(prompts.some((p) => p.includes("Le scout n'a engagé aucune piste"))).toBe(false)
    // et la cible choisie, elle, arrive bien a la phase suivante
    expect(prompts.some((p) => p.includes('ligne 1 — corriger X, score le plus haut'))).toBe(true)
  })
})
