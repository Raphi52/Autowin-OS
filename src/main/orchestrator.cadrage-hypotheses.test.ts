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
 * Le juge doit VOIR ce sur quoi le livrable repose sans que ce soit verifie.
 *
 * Un livrable peut etre impeccable et bati sur une affirmation que le cadrage avait lui-meme
 * etiquetee NON VERIFIEE : rien dans le prompt du juge ne la nommait, donc il validait en silence.
 * Ces tests verifient que la note ARRIVE reellement dans le prompt — un module atteignable
 * qu'aucun appelant ne nourrit est du theatre.
 */
class ProviderDeCadrage implements ProviderAdapter {
  readonly id = 'cadrage'
  readonly supportsExecution = true
  readonly prompts: string[] = []

  constructor(private readonly livrableFrame: string) {}

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const prompt = messages.map((m) => m.content).join('\n')
    this.prompts.push(prompt)
    const estLeJuge = prompt.includes('Tu es un juge')
    return {
      text: estLeJuge ? 'VALIDE' : this.livrableFrame,
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

function harnais(livrableFrame: string) {
  const provider = new ProviderDeCadrage(livrableFrame)
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
    execPhases: ['frame']
  })
  return {
    provider,
    promptDuJuge: async (): Promise<string> => {
      await orch.run('cadre le bloc ask', undefined, undefined, undefined, undefined, undefined, [])
      return provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    }
  }
}

const CADRAGE_AVEC_SUPPOSITIONS = [
  '## Besoin',
  'Rendre le bloc lisible.',
  '## Confiance',
  '- le module existe — VÉRIFIÉ (lu, ligne 20)',
  '- le sanitizeur refuse les contrôles — NON VÉRIFIÉ'
].join('\n')

describe('le juge reçoit les suppositions du cadrage', () => {
  it('la note ARRIVE dans le prompt, avec la supposition nommée', async () => {
    const prompt = await harnais(CADRAGE_AVEC_SUPPOSITIONS).promptDuJuge()
    expect(prompt).toContain('SUPPOSITIONS DU CADRAGE')
    expect(prompt).toContain('- le sanitizeur refuse les contrôles')
    /*
     * L'assertion porte sur la NOTE, pas sur le prompt entier : le prompt contient aussi le cadrage
     * complet comme livrable agrege, donc la ligne VÉRIFIÉ y figure legitimement. Une premiere
     * version de ce test cherchait « le module existe » dans tout le prompt et tombait pour cette
     * raison — le code etait juste, l'assertion visait trop large.
     */
    const debutNote = prompt.indexOf('SUPPOSITIONS DU CADRAGE')
    const note = prompt.slice(debutNote, prompt.indexOf('TÂCHE:', debutNote))
    expect(note).toContain('- le sanitizeur refuse les contrôles')
    expect(note).not.toContain('le module existe')
  })

  it('la note fait VÉRIFIER, elle ne conclut pas à la place du juge', async () => {
    const prompt = await harnais(CADRAGE_AVEC_SUPPOSITIONS).promptDuJuge()
    expect(prompt).toMatch(/verifie-la avec tes outils/u)
    expect(prompt).toMatch(/ne conclus\s+pas qu'une supposition est fausse/u)
  })

  it('un cadrage SANS supposition n’ajoute rien au prompt', async () => {
    const propre = ['## Confiance', '- tout est lu — VÉRIFIÉ (grep)'].join('\n')
    const prompt = await harnais(propre).promptDuJuge()
    expect(prompt).not.toContain('SUPPOSITIONS DU CADRAGE')
    // Le prompt du juge existe bien : c'est la note, et elle seule, qui manque.
    expect(prompt).toContain('Tu es un juge')
  })
})
