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
import { AuthoritySas } from './authority/sas'
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

function makeOrchestrator(
  provider: ProviderAdapter,
  workflow?: WorkflowRunOverride,
  quote?: ExecutionQuote
): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
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
    expect(provider.execCount).toBe(2) // frame + build
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
  const quoteFor = (): ExecutionQuote => compileExecutionQuote('corrige le bug')

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

  it('le devis provisionne le PIRE CAS du graphe, pas sa chaîne', async () => {
    // Régime standard : la chaîne seule (2 phases) passe. C'est bien le pire cas du graphe à boucles
    // — 7 exécutions de nœuds — qui fait refuser, AVANT de dépenser plutôt qu'en pleine course.
    await expect(
      makeOrchestrator(new Recorder(), undefined, compileExecutionQuote('corrige le bug')).run(
        'corrige le bug'
      )
    ).resolves.toBeDefined()
    await expect(
      makeOrchestrator(new Recorder(), { graph: boucle }, compileExecutionQuote('corrige le bug')).run(
        'corrige le bug'
      )
    ).rejects.toThrow('Devis impossible')
  })
})
