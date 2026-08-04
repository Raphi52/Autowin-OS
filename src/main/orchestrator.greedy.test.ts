import { describe, expect, it, vi } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { HookBus } from './hooks/hook-bus'
import { Orchestrator, type GreedyTaskNode, type OrchestrationStep } from './orchestrator'
import type { DecompositionOutcome } from './greedy-decompose'
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

/** Provider fake : renvoie OUT_<id> par sous-tâche, VALIDE pour le juge, throw si le prompt contient CRASH. */
class GreedyProvider implements ProviderAdapter {
  readonly supportsExecution = true
  readonly contents: string[] = []
  constructor(readonly id = 'fake') {}
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    yield* [] as StreamChunk[]
    const content = String(messages[messages.length - 1]?.content ?? '')
    this.contents.push(content)
    if (/CRASH/.test(content)) throw new Error('sous-agent en échec (simulé)')
    const systemInjected = Boolean(options.system)
    if (/juge|VALIDE ou/i.test(content)) {
      return {
        text: 'VALIDE',
        provider: this.id,
        systemInjected,
        usage: { inputTokens: 4, outputTokens: 2, costUsd: 0.001 }
      }
    }
    const id = [...content.matchAll(/\[sous-tâche (\w+)\]/g)].pop()?.[1] ?? '?'
    return {
      text: `OUT_${id}`,
      provider: this.id,
      systemInjected,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.002 },
      executionEvidence: [
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'mutation simulée'
        },
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'completed',
          ok: true,
          summary: 'tests simulés'
        }
      ]
    }
  }
}

function makeGreedy(
  provider: GreedyProvider,
  decompose: (task: string) => Promise<GreedyTaskNode[]>,
  classifyPhases?: () => Array<'scout' | 'frame' | 'terrain' | 'build' | 'clean'>,
  extra: Partial<ConstructorParameters<typeof Orchestrator>[0]> = {}
): Orchestrator {
  const registry = new ProviderRegistry().register(provider)
  const roles = new RoleModelConfig({
    orchestrator: { provider: provider.id, model: 'orch' },
    subagent: { provider: provider.id, model: 'worker' },
    judge: { provider: provider.id, model: 'judge' }
  })
  return new Orchestrator({
    registry,
    roles,
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    greedyConcurrency: 4,
    decompose,
    classifyPhases,
    ...extra
  })
}

describe('Orchestrator — dispatch completion-driven (DAG de sous-tâches, fonctionnement normal)', () => {
  it('ne décompose pas un workflow explicite sans build', async () => {
    const provider = new GreedyProvider()
    const decompose = vi.fn().mockResolvedValue([
      { id: 'A', deps: [], prompt: 'fais A' },
      { id: 'B', deps: [], prompt: 'fais B' }
    ])
    const result = await makeGreedy(provider, decompose, () => ['scout']).run(
      '/scout audite le repo'
    )

    expect(decompose).not.toHaveBeenCalled()
    expect(result.phaseOutputs.map((output) => output.phase)).toEqual(['scout'])
  })

  it('/judge lance uniquement le juge de closure', async () => {
    const provider = new GreedyProvider()
    const decompose = vi.fn().mockResolvedValue([
      { id: 'A', deps: [], prompt: 'fais A' },
      { id: 'B', deps: [], prompt: 'fais B' }
    ])
    const result = await makeGreedy(provider, decompose, () => []).run('/judge audite le repo')

    expect(decompose).not.toHaveBeenCalled()
    expect(provider.contents).toHaveLength(1)
    expect(result.result).toBe('VALIDE')
    expect(result.phaseOutputs).toEqual([])
  })

  it('conserve les phases standard autour de la frontière build parallélisée', async () => {
    const provider = new GreedyProvider()
    const phases: string[] = []
    const orchestrator = makeGreedy(
      provider,
      async () => [
        { id: 'A', deps: [], prompt: 'fais A' },
        { id: 'B', deps: [], prompt: 'fais B' }
      ],
      () => ['frame', 'build']
    )

    const result = await orchestrator.run(
      'analyse le projet en plusieurs volets',
      undefined,
      (event) => {
        if (event.phase) phases.push(event.phase)
        else if (event.step === 'judge') phases.push('judge')
      }
    )

    // Le plan est phase-aware : frame reste un agent, seul build porte le DAG propose.
    expect(phases).toEqual(['frame', 'build', 'build', 'judge'])
    // Un seul AGREGAT par phase : le decoupage change l'execution, pas la structure du livrable.
    expect(result.phaseOutputs.map((output) => output.phase)).toEqual(['frame', 'build'])
    expect(result.trace.filter((step) => /sous-tâche/.test(step.detail ?? ''))).toHaveLength(2)
    // L'attribution a la bonne phase est prouvee par les evenements onPhase ci-dessus
    // (['frame','frame','build','build','judge']) : les steps de trace ne portent pas de phase.
  })

  it('ne multiplie jamais le meme DAG par toutes les phases', async () => {
    const provider = new GreedyProvider()
    const phases: string[] = []
    const orchestrator = makeGreedy(
      provider,
      async () => [
        { id: 'A', deps: [], prompt: 'volet A' },
        { id: 'B', deps: [], prompt: 'volet B' },
        { id: 'C', deps: [], prompt: 'volet C' }
      ],
      () => ['scout', 'build']
    )
    await orchestrator.run('audit large en plusieurs volets', undefined, (event) => {
      if (event.phase) phases.push(event.phase)
    })
    expect(phases.filter((phase) => phase === 'scout')).toHaveLength(1)
    expect(phases.filter((phase) => phase === 'build')).toHaveLength(3)
  })

  it('sans plan exploitable (<2 sous-taches), retombe sur le chemin sequentiel d’origine', async () => {
    const provider = new GreedyProvider()
    const phases: string[] = []
    const orchestrator = makeGreedy(
      provider,
      async () => [{ id: 'A', deps: [], prompt: 'seul volet' }],
      () => ['scout', 'build']
    )
    await orchestrator.run('tache atomique', undefined, (event) => {
      if (event.phase) phases.push(event.phase)
    })
    // Un seul appel par phase : le garde-fou reste le decomposeur lui-meme.
    expect(phases.filter((phase) => phase === 'scout')).toHaveLength(1)
    expect(phases.filter((phase) => phase === 'build')).toHaveLength(1)
  })

  it('conserve scout, frame, terrain et clean autour du build greedy critique', async () => {
    const provider = new GreedyProvider()
    const orchestrator = makeGreedy(
      provider,
      async () => [
        { id: 'A', deps: [], prompt: 'fais A' },
        { id: 'B', deps: [], prompt: 'fais B' }
      ],
      () => ['scout', 'frame', 'terrain', 'build', 'clean']
    )

    const result = await orchestrator.run('analyse architecture complète en lecture seule')

    expect(result.phaseOutputs.map((output) => output.phase)).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'clean'
    ])
  })

  it('exécute un DAG de sous-tâches et PORTE le livrable d’une dépendance vers son aval', async () => {
    const provider = new GreedyProvider()
    const plan: GreedyTaskNode[] = [
      { id: 'A', deps: [], prompt: 'fais A' },
      { id: 'B', deps: [], prompt: 'fais B' },
      { id: 'C', deps: ['A'], prompt: 'fais C' } // dépend de A
    ]
    const result = await makeGreedy(provider, async () => plan).run(
      'analyse le projet en plusieurs volets'
    )

    // 3 sous-agents + 1 juge.
    const execSteps = result.trace.filter((s) => s.step === 'exec' && s.status === 'completed')
    expect(execSteps.map((s) => s.detail).sort()).toEqual([
      'sous-tâche A',
      'sous-tâche B',
      'sous-tâche C'
    ])
    expect(execSteps.find((step) => step.detail === 'sous-tâche A')?.execution).toMatchObject({
      phase: 'build',
      taskId: 'A',
      dependencyIds: []
    })
    expect(execSteps.find((step) => step.detail === 'sous-tâche C')?.execution).toMatchObject({
      phase: 'build',
      taskId: 'C',
      dependencyIds: ['A']
    })
    // Le prompt de C contient le livrable de A (contexte de dépendance porté).
    const cPrompt = provider.contents.find((c) => /\[sous-tâche C\]/.test(c))
    expect(cPrompt).toMatch(/dépendance A/)
    expect(cPrompt).toMatch(/OUT_A/)
    // Agrégat + juge OK.
    expect(result.result).toContain('OUT_A')
    expect(result.result).toContain('OUT_C')
    expect(result.valid).toBe(true)
    expect(result.failedTasks).toEqual([])
    expect(result.skippedTasks).toEqual([])
    expect(result.phaseOutputs).toHaveLength(3)
  })

  it('court-circuite le juge payant quand le pre-gate local du chemin greedy est rouge', async () => {
    const provider = new GreedyProvider()
    const hooks = new HookBus().register('pre-green', () => ({
      block: true,
      reason: 'verification locale rouge'
    }))
    const result = await makeGreedy(
      provider,
      async () => [
        { id: 'A', deps: [], prompt: 'fais A' },
        { id: 'B', deps: [], prompt: 'fais B' }
      ],
      () => ['build'],
      { hooks }
    ).run('corrige le bug en plusieurs volets')

    expect(provider.contents).toHaveLength(2)
    expect(result.trace.some((step) => step.step === 'judge')).toBe(false)
    expect(result.gateBlocked).toBe(true)
  })

  it('cascade : une sous-tâche dont la dépendance échoue est SAUTÉE, pas exécutée', async () => {
    const provider = new GreedyProvider()
    const plan: GreedyTaskNode[] = [
      { id: 'A', deps: [], prompt: 'fais A CRASH' }, // échoue
      { id: 'B', deps: [], prompt: 'fais B' }, // indépendant → réussit
      { id: 'C', deps: ['A'], prompt: 'fais C' } // sautée (A a échoué)
    ]
    const result = await makeGreedy(provider, async () => plan).run('analyse le projet')

    expect(result.failedTasks).toEqual(['A'])
    expect(result.skippedTasks).toEqual(['C'])
    // B a bien tourné malgré l'échec de A (pas de barrière).
    expect(provider.contents.some((c) => /\[sous-tâche B\]/.test(c))).toBe(true)
    // C n'a JAMAIS été envoyé au provider.
    expect(provider.contents.some((c) => /\[sous-tâche C\]/.test(c))).toBe(false)
    // Une trace de saut est présente.
    expect(result.trace.some((s) => s.status === 'failed' && /sautée/.test(s.error ?? ''))).toBe(
      true
    )
  })

  it('fallback : un plan <2 sous-tâches retombe sur le pipeline séquentiel (rétrocompat)', async () => {
    const provider = new GreedyProvider()
    const plan: GreedyTaskNode[] = [{ id: 'solo', deps: [], prompt: 'unique' }]
    const result = await makeGreedy(provider, async () => plan).run('analyse le projet')

    // Chemin séquentiel : pas de champs greedy, pas de détail « sous-tâche ».
    expect(result.failedTasks).toBeUndefined()
    expect(result.skippedTasks).toBeUndefined()
    expect(result.trace.every((s) => !/sous-tâche/.test(s.detail ?? ''))).toBe(true)
  })
})

describe("Orchestrator — l'issue de décomposition est OBSERVABLE, pas seulement loguée", () => {
  /** Décomposeur qui rend [] tout en NOMMANT pourquoi, via le sink par appel. */
  const decomposerReporting = (
    outcome: DecompositionOutcome
  ): ((
    task: string,
    binding?: unknown,
    onOutcome?: (o: DecompositionOutcome, task: string) => void
  ) => Promise<GreedyTaskNode[]>) =>
    async (task, _binding, onOutcome) => {
      onOutcome?.(outcome, task)
      return outcome.kind === 'plan' ? outcome.nodes : []
    }

  it('un plan REJETÉ sort en step failed, avec son motif — un test peut désormais l’assérer', async () => {
    const provider = new GreedyProvider()
    const steps: OrchestrationStep[] = []
    await makeGreedy(
      provider,
      decomposerReporting({ kind: 'rejected', reason: 'invalid-json' }),
      () => ['build']
    ).run('répare le module', (s) => steps.push(s))

    const decomposeSteps = steps.filter((s) => s.role === 'decompose')
    expect(decomposeSteps).toHaveLength(1)
    expect(decomposeSteps[0].status).toBe('failed')
    expect(decomposeSteps[0].detail).toContain('invalid-json')
  })

  it('une tâche ATOMIQUE n’est PAS un échec — même retour [], step completed', async () => {
    const provider = new GreedyProvider()
    const steps: OrchestrationStep[] = []
    await makeGreedy(provider, decomposerReporting({ kind: 'atomic' }), () => ['build']).run(
      'renomme une variable',
      (s) => steps.push(s)
    )

    const decomposeSteps = steps.filter((s) => s.role === 'decompose')
    expect(decomposeSteps).toHaveLength(1)
    // C'EST le point aveugle d'origine : les deux cas rendent [], seul le statut les sépare.
    expect(decomposeSteps[0].status).toBe('completed')
    expect(decomposeSteps[0].detail).toContain('atomique')
  })

  it('un décomposeur historique à 2 paramètres reste accepté (rétrocompat du contrat)', async () => {
    const provider = new GreedyProvider()
    const steps: OrchestrationStep[] = []
    const legacy = vi.fn().mockResolvedValue([])
    await makeGreedy(provider, legacy, () => ['build']).run('une tâche', (s) => steps.push(s))

    expect(legacy).toHaveBeenCalled()
    // Il n'émet rien : l'observabilité est un ajout, jamais une exigence pour les appelants existants.
    expect(steps.filter((s) => s.role === 'decompose')).toHaveLength(0)
  })
})
