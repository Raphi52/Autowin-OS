import { describe, expect, it } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type GreedyTaskNode } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
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
  decompose: (task: string) => Promise<GreedyTaskNode[]>
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
    decompose
  })
}

describe('Orchestrator — dispatch completion-driven (DAG de sous-tâches, fonctionnement normal)', () => {
  it('exécute un DAG de sous-tâches et PORTE le livrable d’une dépendance vers son aval', async () => {
    const provider = new GreedyProvider()
    const plan: GreedyTaskNode[] = [
      { id: 'A', deps: [], prompt: 'fais A' },
      { id: 'B', deps: [], prompt: 'fais B' },
      { id: 'C', deps: ['A'], prompt: 'fais C' } // dépend de A
    ]
    const result = await makeGreedy(provider, async () => plan).run('analyse le projet en plusieurs volets')

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
    expect(result.trace.some((s) => s.status === 'failed' && /sautée/.test(s.error ?? ''))).toBe(true)
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
