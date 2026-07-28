import { describe, expect, it, vi } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type GreedyTaskNode } from './orchestrator'
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
      executionEvidence: []
    }
  }
}

function makeGreedy(
  provider: GreedyProvider,
  decompose: (task: string) => Promise<GreedyTaskNode[]>,
  classifyPhases?: () => Array<'scout' | 'frame' | 'terrain' | 'build' | 'clean'>
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
    greedyConcurrency: 4,
    decompose,
    classifyPhases
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

    expect(phases).toEqual(['frame', 'build', 'build', 'judge'])
    expect(result.phaseOutputs.map((output) => output.phase)).toEqual(['frame', 'build'])
    expect(result.trace.filter((step) => /sous-tâche/.test(step.detail ?? ''))).toHaveLength(2)
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
