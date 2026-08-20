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
 * ORIENTER SANS INTERROMPRE, sur un RUN.
 *
 * Le pilote de chat ne draine les directives qu'entre deux de ses iterations ; pendant une
 * orchestration il est bloque dans l'appel `orchestrate`, et l'orchestrateur n'avait AUCUNE prise.
 * L'utilisateur orientait et rien ne se passait (20/08). La granularite est la PHASE : on ne parle
 * pas a un sous-agent en vol, on corrige le cadre de la phase suivante.
 */
class ProviderQuiNote implements ProviderAdapter {
  readonly id = 'note'
  readonly supportsExecution = true
  readonly prompts: string[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.prompts.push(messages.map((m) => m.content).join('\n'))
    return { text: 'VALIDE', provider: this.id, systemInjected: Boolean(options.system) }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

function harnais(directivesParAppel: string[][]) {
  const provider = new ProviderQuiNote()
  let appel = 0
  const conversationsVues: string[] = []
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\base',
    worktrees: makeTestWorktrees('C:\base'),
    execPhases: ['frame', 'build'],
    drainDirectives: (conversationId) => {
      conversationsVues.push(conversationId)
      return directivesParAppel[appel++] ?? []
    }
  })
  return {
    provider,
    conversationsVues,
    lancer: () =>
      orch.run(
        'range les icônes du menu',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        'conv-1331'
      )
  }
}

const DIRECTIVE = 'décale les icônes de 4 px vers la droite, pas vers la gauche'

describe('une directive arrivée pendant le run entre dans la phase suivante', () => {
  it('la directive atteint le prompt d’une phase, marquée PRIORITAIRE', async () => {
    const h = harnais([[], [DIRECTIVE]])
    await h.lancer()
    const avecDirective = h.provider.prompts.filter((p) => p.includes(DIRECTIVE))
    expect(avecDirective.length).toBeGreaterThan(0)
    expect(avecDirective[0]).toContain('DIRECTIVE UTILISATEUR ARRIVEE PENDANT LE RUN')
    expect(avecDirective[0]).toContain('PRIORITAIRE')
  })

  it('la première phase, lancée avant l’orientation, ne la porte PAS', async () => {
    const h = harnais([[], [DIRECTIVE]])
    await h.lancer()
    // Elle n'existait pas encore quand la premiere phase a demarre : l'y voir signalerait une
    // reecriture retroactive du passe.
    expect(h.provider.prompts[0]).not.toContain(DIRECTIVE)
  })

  it('elle est drainée avec l’identifiant de la CONVERSATION du run', async () => {
    const h = harnais([[DIRECTIVE]])
    await h.lancer()
    expect(h.conversationsVues.every((id) => id === 'conv-1331')).toBe(true)
    expect(h.conversationsVues.length).toBeGreaterThan(0)
  })

  it('aucune directive ⇒ aucun ajout au contexte des phases', async () => {
    const h = harnais([[], []])
    await h.lancer()
    expect(h.provider.prompts.some((p) => p.includes('DIRECTIVE UTILISATEUR'))).toBe(false)
  })

  it('une directive RESTE dans le cadre pour les phases d’après', async () => {
    const h = harnais([[DIRECTIVE]])
    await h.lancer()
    // Une correction du cadre n'est pas une remarque jetable : la phase suivante doit la voir aussi.
    const portant = h.provider.prompts.filter((p) => p.includes(DIRECTIVE))
    expect(portant.length).toBeGreaterThan(1)
  })
})
