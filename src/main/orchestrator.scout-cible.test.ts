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

/**
 * LE SITE D'APPEL du plafond de preuve (`scout-plafond.ts`) : meme accroche que la cible. Une piste
 * notee 72 dont le Pourquoi avoue « je n'ai pas verifie » doit arriver a la phase suivante a 50.
 */
class ScoutQuiAvoue implements ProviderAdapter {
  readonly id = 'aveu'
  readonly supportsExecution = true
  readonly prompts: string[] = []
  readonly systemes: string[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const prompt = messages.map((m) => m.content).join('\n')
    this.prompts.push(prompt)
    this.systemes.push(options.system ?? '')
    const shortlist =
      '## Cible\nligne 1 — cache périmé\n\n| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n' +
      "| 1 | 72 | 🔧 fix | cache périmé | je n'ai pas vérifié l'appelant | cache.ts:10 |"
    return {
      text: prompt.includes('Tu es un juge') ? 'VALIDE' : shortlist,
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

describe('cablage : le plafond de preuve mord sur la sortie reelle du scout', () => {
  it('la note non verifiee arrive a 50 dans le texte enregistre et a la phase suivante', async () => {
    const provider = new ScoutQuiAvoue()
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
    const result = await orch.run(
      'améliore la vue Knowledge',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      []
    )
    const scout = result.phaseOutputs.find((output) => output.phase === 'scout')?.text ?? ''
    expect(scout).toMatch(/\| 1 \| 50 \|/u)
    expect(scout).not.toMatch(/\| 72 \|/u)
    expect(provider.prompts.some((p) => p.includes('Note ramenée à 50 par Autowin'))).toBe(true)
  })
})

/**
 * LE SITE D'APPEL de la memoire des pistes (`scout-memoire.ts`) : la consigne REELLEMENT envoyee au
 * scout porte les titres deja proposes, et les pistes de ce scout sont notees sous l'identifiant du
 * run — celui-la meme que la lecture exclut.
 */
describe('cablage : le scout recoit les pistes deja proposees et note les siennes', () => {
  it('consigne enrichie, pistes notees, run en cours exclu', async () => {
    const provider = new ScoutQuiAvoue()
    const lectures: Array<{ depot: string; sauf: string }> = []
    const notes: Array<{ depot: string; texte: string; run: string }> = []
    const orch = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'ouvrier' },
        judge: { provider: provider.id, model: 'juge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\base',
      classifyPhases: () => ['scout'],
      worktrees: makeTestWorktrees('C:\base'),
      execPhases: [],
      memoireScout: {
        connues: (depot, sauf) => {
          lectures.push({ depot, sauf })
          return ['Écriture du cache', 'Tri des conversations']
        },
        noter: (depot, texte, run) => notes.push({ depot, texte, run })
      }
    })
    await orch.run(
      'améliore la vue Knowledge',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      []
    )
    const consigneScout =
      [...provider.systemes, ...provider.prompts].find((p) => p.includes('phase SCOUT')) ?? ''
    expect(consigneScout).toMatch(/DÉJÀ PROPOSÉ/u)
    expect(consigneScout).toContain('- Écriture du cache')
    expect(lectures).toHaveLength(1)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.texte).toMatch(/cache périmé/u)
    expect(notes[0]!.run).toBe(lectures[0]!.sauf)
    expect(notes[0]!.run).not.toBe('')
  })

  // Piste 7 de conv-890 : la demande du run (le message de sélection) est lue AVANT la mémoire, pour
  // que le bilan des choix réels arrive dans la consigne du scout de CE run.
  it('la demande du run part au noteur de choix, et le bilan arrive dans la consigne du scout', async () => {
    const provider = new ScoutQuiAvoue()
    const ordre: string[] = []
    const demandes: string[] = []
    const orch = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'ouvrier' },
        judge: { provider: provider.id, model: 'juge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\base',
      classifyPhases: () => ['scout'],
      worktrees: makeTestWorktrees('C:\base'),
      execPhases: [],
      memoireScout: {
        connues: () => {
          ordre.push('connues')
          return ['Écriture du cache']
        },
        noter: () => undefined,
        choisir: (_depot, demande) => {
          ordre.push('choisir')
          demandes.push(demande)
        },
        bilan: () => 'TES CHOIX RÉELS sur ce dépôt (6 pistes jugées) : 5 prises sur 6'
      }
    })
    await orch.run(
      'améliore la vue Knowledge',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      []
    )
    const consigneScout =
      [...provider.systemes, ...provider.prompts].find((p) => p.includes('phase SCOUT')) ?? ''
    expect(demandes[0]).toContain('améliore la vue Knowledge')
    expect(ordre.slice(0, 2)).toEqual(['choisir', 'connues'])
    expect(consigneScout).toContain('TES CHOIX RÉELS sur ce dépôt (6 pistes jugées)')
  })
})
