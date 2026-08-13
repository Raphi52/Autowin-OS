import { describe, expect, it } from 'vitest'
import { Orchestrator, type WorkflowRunOverride } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { compileExecutionQuote, type ExecutionQuote } from './execution-quote'

/** Enregistre ce que chaque phase a RÉELLEMENT reçu — le seul endroit où l'écart se constate. */
class Recorder implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly prompts: string[] = []
  execCount = 0
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    // La consigne de phase voyage dans le `system`, pas dans le dernier message : c'est là qu'il
    // faut la constater, sinon le test passerait à côté de ce qu'il prétend vérifier.
    this.prompts.push(
      `${options.system ?? ''}\n${String(messages[messages.length - 1]?.content ?? '')}`
    )
    const isExec = options.execution?.sandbox === 'danger-full-access'
    if (isExec) this.execCount += 1
    return {
      text: options.execution?.sandbox === 'read-only' ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: isExec
        ? [
            { type: 'file_change', kind: 'mutation', status: 'done', ok: true, summary: 'edit' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'done',
              ok: true,
              summary: 'test exit=0'
            }
          ]
        : undefined
    }
  }
}

/** Rend le premier gate rouge puis le suivant vert, et conserve l'ordre réellement payé. */
class RedPuisVert extends Recorder {
  readonly phases: string[] = []
  private verdicts = 0

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const phase = /SKILL\s+(scout|frame|terrain|build|clean|judge)/.exec(options.system ?? '')?.[1]
    if (phase) this.phases.push(phase)
    const result = yield* super.send(messages, options)
    if (phase !== 'judge' || options.execution?.sandbox !== 'read-only') return result
    this.verdicts += 1
    return { ...result, text: this.verdicts === 1 ? 'DEFAUT: reprise requise' : 'VALIDE' }
  }
}

/** Même verdict rouge→vert, avec la preuve du binding réellement payé à chaque appel. */
class RedPuisVertParModele extends RedPuisVert {
  readonly modeles: string[] = []

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.modeles.push(options.model ?? '(défaut)')
    return yield* super.send(messages, options)
  }
}

function makeOrchestrator(
  provider: ProviderAdapter,
  workflow?: WorkflowRunOverride,
  quote?: ExecutionQuote
): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' },
      // Un fan-out fait synthétiser par l'orchestrateur : sans ce binding le test échouerait sur
      // l'absence de provider, pas sur ce qu'il prétend vérifier.
      orchestrator: { provider: provider.id, model: 'chef' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => ['frame', 'build'],
    skillInstruction: (phase) => `SKILL ${phase}`,
    currentWorkflow: () => workflow,
    ...(quote ? { currentExecutionQuote: () => quote } : {})
  })
}

/**
 * Sans ces trois branchements, un workflow qui règle les phases, l'allocation ou les consignes
 * produisait un run STRICTEMENT identique aux autres — et le verdict aurait porté sur une
 * différence qui n'a pas eu lieu.
 */
describe('un workflow impose ses phases', () => {
  it('le pipeline joué est celui du workflow, pas celui de la classification', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, { phases: ['build'] }).run('corrige le bug')
    expect(provider.execCount).toBe(1) // 'frame' sauté
  })

  it('sans écart de phases, la classification reprend la main', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {}).run('corrige le bug')
    expect(provider.prompts.some((prompt) => prompt.includes('SKILL frame'))).toBe(true)
    expect(provider.prompts.some((prompt) => prompt.includes('SKILL build'))).toBe(true)
    expect(provider.execCount).toBe(1) // seule build a le droit de muter
  })

  it('une phase explicite court-circuite le workflow choisi', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      explicit: true,
      phases: ['scout', 'frame', 'terrain', 'build']
    }).run('/build corrige le bug')

    expect(provider.prompts.some((prompt) => prompt.includes('SKILL scout'))).toBe(false)
    expect(provider.prompts.some((prompt) => prompt.includes('SKILL frame'))).toBe(false)
    expect(provider.prompts.some((prompt) => prompt.includes('SKILL terrain'))).toBe(false)
    expect(provider.prompts.filter((prompt) => prompt.includes('SKILL build'))).toHaveLength(1)
    expect(provider.execCount).toBe(1)
  })

  it('une phase explicite ne réserve pas non plus le pire cas du graphe écarté', async () => {
    const provider = new Recorder()
    const quote = compileExecutionQuote('/build corrige le bug', { maxProviderCalls: 4 })
    await expect(
      makeOrchestrator(
        provider,
        {
          explicit: true,
          graph: {
            entry: 'scout',
            nodes: [
              { id: 'scout', phase: 'scout' },
              { id: 'frame', phase: 'frame' },
              { id: 'terrain', phase: 'terrain' },
              { id: 'build', phase: 'build' },
              { id: 'clean', phase: 'clean' }
            ],
            edges: [
              { from: 'scout', to: 'frame', when: 'always' },
              { from: 'frame', to: 'terrain', when: 'always' },
              { from: 'terrain', to: 'build', when: 'always' },
              { from: 'build', to: 'clean', when: 'always' }
            ]
          }
        },
        quote
      ).run('/build corrige le bug')
    ).resolves.toBeDefined()
    expect(quote.phases).toEqual(['build'])
    expect(provider.execCount).toBe(1)
  })
})

describe('un workflow impose ses consignes', () => {
  it('la consigne AJOUTÉE arrive réellement dans le prompt de la phase', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      phases: ['build'],
      instructionFor: () => ({ mode: 'append', text: 'PARLE EN VERS' })
    }).run('corrige le bug')
    const build = provider.prompts.find((p) => p.includes('SKILL build'))
    expect(build).toContain('PARLE EN VERS')
  })

  it('la consigne REMPLACÉE évince le skill', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      phases: ['build'],
      instructionFor: () => ({ mode: 'replace', text: 'MA MÉTHODE' })
    }).run('corrige le bug')
    expect(provider.prompts.some((p) => p.includes('MA MÉTHODE'))).toBe(true)
    expect(provider.prompts.some((p) => p.includes('SKILL build'))).toBe(false)
  })

  it('une consigne ciblée ne déborde pas sur les autres phases', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      instructionFor: (phase) =>
        phase === 'build' ? { mode: 'append', text: 'SEULEMENT ICI' } : undefined
    }).run('corrige le bug')
    const frame = provider.prompts.find((p) => p.includes('SKILL frame'))
    expect(frame).not.toContain('SEULEMENT ICI')
  })
})

describe('un workflow impose son allocation', () => {
  const quoteFor = (): ExecutionQuote => {
    const quote = compileExecutionQuote('corrige le bug')
    // Ce bloc teste la priorité de l'allocation, pas son admission : on lui donne volontairement
    // assez de capacité pour quatre juges. Les tests de refus hors caps vivent avec les graphes.
    quote.limits.maxAgents = 12
    quote.limits.maxConcurrency = 4
    return quote
  }

  it('le nombre de juges du workflow prime sur le calcul du devis', async () => {
    const quote = quoteFor()
    await makeOrchestrator(new Recorder(), { allocation: { judgeMembers: 4 } }, quote).run(
      'corrige le bug'
    )
    // 4, pas 1 : le devis calcule 1 juge par défaut ici, imposer 1 n'aurait rien discriminé.
    expect(quote.allocation?.judgeMembers).toBe(4)
  })

  it('ce que le workflow ne règle PAS reste ce que le devis a décidé', async () => {
    const temoin = quoteFor()
    await makeOrchestrator(new Recorder(), undefined, temoin).run('corrige le bug')
    const attendu = temoin.allocation?.maxGreedyNodes

    const quote = quoteFor()
    await makeOrchestrator(new Recorder(), { allocation: { judgeMembers: 4 } }, quote).run(
      'corrige le bug'
    )
    // Sinon un workflow qui ne règle que le jury effacerait silencieusement le reste.
    expect(quote.allocation?.maxGreedyNodes).toBe(attendu)
  })
})

describe('un graphe pilote le run', () => {
  const boucle = {
    entry: 'f',
    nodes: [
      { id: 'f', phase: 'frame' as const },
      { id: 'b', phase: 'build' as const },
      { id: 'j', phase: 'judge' as const }
    ],
    edges: [
      { from: 'f', to: 'b', when: 'always' as const },
      { from: 'b', to: 'j', when: 'always' as const },
      { from: 'j', to: 'b', when: 'red' as const, maxTraversals: 2 }
    ]
  }

  it('la CHAÎNE du graphe remplace les phases classifiées', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      graph: { entry: 'b', nodes: [{ id: 'b', phase: 'build' }], edges: [] }
    }).run('corrige le bug')
    expect(provider.execCount).toBe(1) // 'frame' sauté, alors que la classification en donne deux
  })

  it('le graphe PRIME sur une liste de phases concurrente', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      phases: ['frame', 'build', 'clean'],
      graph: { entry: 'b', nodes: [{ id: 'b', phase: 'build' }], edges: [] }
    }).run('corrige le bug')
    expect(provider.execCount).toBe(1)
  })

  it('le devis provisionne le PIRE CAS du graphe, pas sa chaîne — refus en mode bloquant', async () => {
    // Régime standard : la chaîne seule (2 phases) passe. C'est bien le pire cas du graphe à boucles
    // — 7 exécutions de nœuds — qui fait refuser, AVANT de dépenser plutôt qu'en pleine course.
    // Depuis conv-1148 (13/08), ce refus est réservé au mode `blocking` : en mesure seule (défaut),
    // le devis s'agrandit au pire cas au lieu de tuer le run.
    const bloquant = compileExecutionQuote('corrige le bug', { spendEnforcement: 'blocking' })
    await expect(
      makeOrchestrator(new Recorder(), undefined, bloquant).run('corrige le bug')
    ).resolves.toBeDefined()
    await expect(
      makeOrchestrator(
        new Recorder(),
        { graph: boucle },
        compileExecutionQuote('corrige le bug', { spendEnforcement: 'blocking' })
      ).run('corrige le bug')
    ).rejects.toThrow('Devis impossible')
    const mesure = compileExecutionQuote('corrige le bug')
    await expect(
      makeOrchestrator(new Recorder(), { graph: boucle }, mesure).run('corrige le bug')
    ).resolves.toBeDefined()
    expect(mesure.limits.maxProviderCalls).toBeGreaterThanOrEqual(7)
  })

  it('un graphe explicitement choisi réserve son chemin complet et ses deux reprises', async () => {
    const graph = {
      entry: 'scout-1',
      nodes: [
        { id: 'scout-1', phase: 'scout' as const },
        { id: 'frame-1', phase: 'frame' as const },
        { id: 'terrain-1', phase: 'terrain' as const },
        { id: 'build-1', phase: 'build' as const },
        { id: 'clean-1', phase: 'clean' as const },
        { id: 'judge-1', phase: 'judge' as const }
      ],
      edges: [
        { from: 'scout-1', to: 'frame-1', when: 'always' as const },
        { from: 'frame-1', to: 'terrain-1', when: 'always' as const },
        { from: 'terrain-1', to: 'build-1', when: 'always' as const },
        { from: 'build-1', to: 'clean-1', when: 'always' as const },
        { from: 'clean-1', to: 'judge-1', when: 'always' as const },
        { from: 'judge-1', to: 'build-1', when: 'red' as const, maxTraversals: 2 }
      ]
    }
    const quote = compileExecutionQuote('corrige le sommaire du README')

    await expect(
      makeOrchestrator(new Recorder(), { explicit: true, graph }, quote).run(
        'corrige le sommaire du README'
      )
    ).resolves.toBeDefined()
    expect(quote.phases).toEqual(['scout', 'frame', 'terrain', 'build', 'clean', 'judge'])
    expect(quote.limits.maxRecoveries).toBe(2)
    expect(quote.limits.maxAgents).toBeGreaterThanOrEqual(11)
    expect(quote.limits.maxAgents).toBeLessThanOrEqual(quote.limits.maxProviderCalls)
  })

  it('un juge terminal du workflow est le gate final, pas un appel de juge en double', async () => {
    const provider = new Recorder()
    await makeOrchestrator(provider, {
      graph: {
        entry: 'b',
        nodes: [
          { id: 'b', phase: 'build' },
          { id: 'j', phase: 'judge' }
        ],
        edges: [{ from: 'b', to: 'j', when: 'always' }]
      }
    }).run('corrige le bug')

    expect(provider.prompts.filter((prompt) => prompt.includes('SKILL judge'))).toHaveLength(1)
    expect(provider.prompts).toHaveLength(2) // build + gate judge
  })

  it('un juge rouge rejoue tout le sous-chemin build → clean avant le nouveau gate', async () => {
    const provider = new RedPuisVert()
    const quote = compileExecutionQuote('corrige le bug')
    await makeOrchestrator(
      provider,
      {
        explicit: true,
        graph: {
          entry: 'scout',
          nodes: [
            { id: 'scout', phase: 'scout' },
            { id: 'frame', phase: 'frame' },
            { id: 'terrain', phase: 'terrain' },
            { id: 'build', phase: 'build' },
            { id: 'clean', phase: 'clean' },
            { id: 'judge', phase: 'judge' }
          ],
          edges: [
            { from: 'scout', to: 'frame', when: 'always' },
            { from: 'frame', to: 'terrain', when: 'always' },
            { from: 'terrain', to: 'build', when: 'always' },
            { from: 'build', to: 'clean', when: 'always' },
            { from: 'clean', to: 'judge', when: 'always' },
            { from: 'judge', to: 'build', when: 'red', maxTraversals: 1 }
          ]
        }
      },
      quote
    ).run('corrige le bug')

    expect(provider.phases).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'clean',
      'judge',
      'build',
      'clean',
      'judge'
    ])
  })

  it('un graphe avec une reprise tient dans un cap égal à son vrai pire cas', async () => {
    const provider = new RedPuisVert()
    const quote = compileExecutionQuote('corrige le bug', { maxProviderCalls: 5 })
    await expect(
      makeOrchestrator(
        provider,
        {
          explicit: true,
          graph: {
            entry: 'frame',
            nodes: [
              { id: 'frame', phase: 'frame' },
              { id: 'build', phase: 'build' },
              { id: 'judge', phase: 'judge' }
            ],
            edges: [
              { from: 'frame', to: 'build', when: 'always' },
              { from: 'build', to: 'judge', when: 'always' },
              { from: 'judge', to: 'build', when: 'red', maxTraversals: 1 }
            ]
          }
        },
        quote
      ).run('corrige le bug')
    ).resolves.toBeDefined()
    expect(provider.prompts).toHaveLength(5)
  })

  it('refuse un panel composé hors caps avant le premier appel provider', async () => {
    const provider = new Recorder()
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    const agents = Array.from({ length: 25 }, (_, index) => ({
      provider: 'rec',
      model: `juge-${index + 1}`
    }))
    await expect(
      makeOrchestrator(
        provider,
        {
          explicit: true,
          graph: {
            entry: 'build',
            nodes: [
              { id: 'build', phase: 'build' },
              { id: 'judge', phase: 'judge', agents, quorum: 13 }
            ],
            edges: [{ from: 'build', to: 'judge', when: 'always' }]
          }
        },
        quote
      ).run('refonte architecture sécurité migration')
    ).rejects.toThrow('Devis impossible')
    expect(provider.prompts).toHaveLength(0)
  })

  it('un graphe sans arête rouge ne déclenche aucune réparation cachée', async () => {
    const provider = new RedPuisVert()
    const quote = compileExecutionQuote('corrige le bug', { maxProviderCalls: 2 })
    const result = await makeOrchestrator(
      provider,
      {
        explicit: true,
        graph: {
          entry: 'build',
          nodes: [
            { id: 'build', phase: 'build' },
            { id: 'judge', phase: 'judge' }
          ],
          edges: [{ from: 'build', to: 'judge', when: 'always' }]
        }
      },
      quote
    ).run('corrige le bug')

    expect(result.valid).toBe(false)
    expect(provider.phases).toEqual(['build', 'judge'])
    expect(provider.prompts).toHaveLength(2)
  })

  it('une reprise rejoue le panel composé du nœud build et sa synthèse', async () => {
    const provider = new RedPuisVertParModele()
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    await makeOrchestrator(
      provider,
      {
        explicit: true,
        graph: {
          entry: 'build',
          nodes: [
            {
              id: 'build',
              phase: 'build',
              agents: [
                { provider: 'rec', model: 'a' },
                { provider: 'rec', model: 'b' },
                { provider: 'rec', model: 'c' }
              ]
            },
            { id: 'judge', phase: 'judge' }
          ],
          edges: [
            { from: 'build', to: 'judge', when: 'always' },
            { from: 'judge', to: 'build', when: 'red', maxTraversals: 1 }
          ]
        }
      },
      quote
    ).run('refonte architecture sécurité migration')

    expect(provider.modeles).toEqual(['a', 'b', 'c', 'chef', 'juge', 'a', 'b', 'c', 'chef', 'juge'])
    expect(quote.allocation?.estimatedMaxCalls).toBe(10)
  })
})

describe('les agents composés sur un nœud atteignent le run', () => {
  /** Compte les appels par modèle : le seul endroit où un fan-out se constate vraiment. */
  class ParModele extends Recorder {
    readonly modeles: string[] = []
    async *send(
      messages: Message[],
      options: SendOptions = {}
    ): AsyncGenerator<StreamChunk, SendResult, void> {
      this.modeles.push(options.model ?? '(défaut)')
      return yield* super.send(messages, options)
    }
  }

  const troisJuges = {
    entry: 'b',
    nodes: [
      { id: 'b', phase: 'build' as const },
      {
        id: 'j',
        phase: 'judge' as const,
        agents: [
          { provider: 'rec', model: 'juge-a' },
          { provider: 'rec', model: 'juge-b' },
          { provider: 'rec', model: 'juge-c' }
        ],
        quorum: 3
      }
    ],
    edges: [{ from: 'b', to: 'j', when: 'always' as const }]
  }

  it('trois juges composés font TROIS appels de juge, pas un', async () => {
    // Sans le branchement, ouvrir le nœud et y régler trois agents ne changeait rien : le canevas
    // laissait régler quelque chose d'inerte.
    const provider = new ParModele()
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    await makeOrchestrator(provider, { graph: troisJuges }, quote).run('corrige le bug')
    // Les TROIS juges composés participent. Le nombre total d'appels peut dépasser trois (une passe
    // de re-jugement les rejoue) : ce qu'on vérifie, c'est qu'aucun n'est resté sur le banc.
    const juges = new Set(provider.modeles.filter((m) => m.startsWith('juge-')))
    expect([...juges].sort()).toEqual(['juge-a', 'juge-b', 'juge-c'])
  })

  it('l’allocation du devis SUIT les agents composés — sinon le panel serait tronqué', async () => {
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    await makeOrchestrator(new ParModele(), { graph: troisJuges }, quote).run('corrige le bug')
    expect(quote.allocation?.judgeMembers).toBe(3)
  })

  it('une allocation écrite explicitement reste prioritaire sur la déduction', async () => {
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    await makeOrchestrator(
      new ParModele(),
      { graph: troisJuges, allocation: { judgeMembers: 2 } },
      quote
    ).run('corrige le bug')
    expect(quote.allocation?.judgeMembers).toBe(2)
  })

  it('les agents composés sur une phase d’exécution priment aussi', async () => {
    const provider = new ParModele()
    const graphe = {
      entry: 'f',
      nodes: [
        {
          id: 'f',
          phase: 'frame' as const,
          agents: [
            { provider: 'rec', model: 'cadreur-a' },
            { provider: 'rec', model: 'cadreur-b' }
          ]
        },
        { id: 'b', phase: 'build' as const }
      ],
      edges: [{ from: 'f', to: 'b', when: 'always' as const }]
    }
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    await makeOrchestrator(provider, { graph: graphe }, quote).run('corrige le bug')
    expect(provider.modeles).toContain('cadreur-a')
    expect(provider.modeles).toContain('cadreur-b')
  })

  it('sans agent composé, la topologie globale reprend la main', async () => {
    const provider = new ParModele()
    await makeOrchestrator(provider, {
      graph: { entry: 'b', nodes: [{ id: 'b', phase: 'build' }], edges: [] }
    }).run('corrige le bug')
    expect(provider.modeles).toContain('gros') // le binding de rôle par défaut
  })
})

describe('le quorum composé décide du verdict', () => {
  /** Un juge sur trois trouve un défaut : la majorité simple passe, l'unanimité non. */
  class UnDissident extends Recorder {
    async *send(
      messages: Message[],
      options: SendOptions = {}
    ): AsyncGenerator<StreamChunk, SendResult, void> {
      const resultat = yield* super.send(messages, options)
      if (options.model === 'juge-c' && options.execution?.sandbox === 'read-only') {
        return { ...resultat, text: 'DEFAUT: il manque une preuve.' }
      }
      return resultat
    }
  }

  const jury = (quorum?: number) => ({
    entry: 'b',
    nodes: [
      { id: 'b', phase: 'build' as const },
      {
        id: 'j',
        phase: 'judge' as const,
        agents: [
          { provider: 'rec', model: 'juge-a' },
          { provider: 'rec', model: 'juge-b' },
          { provider: 'rec', model: 'juge-c' }
        ],
        ...(quorum ? { quorum } : {})
      }
    ],
    edges: [{ from: 'b', to: 'j', when: 'always' as const }]
  })

  const lancer = async (quorum?: number) =>
    makeOrchestrator(
      new UnDissident(),
      { graph: jury(quorum) },
      compileExecutionQuote('refonte architecture sécurité migration')
    ).run('corrige le bug')

  it('sans quorum composé, la majorité simple suffit : 2 voix sur 3 valident', async () => {
    expect((await lancer()).valid).toBe(true)
  })

  it('un quorum de 3 exige l’unanimité — le dissident fait échouer', async () => {
    // C'est là que le réglage composé se VOIT : même jury, même dissident, verdict inverse.
    expect((await lancer(3)).valid).toBe(false)
  })
})
