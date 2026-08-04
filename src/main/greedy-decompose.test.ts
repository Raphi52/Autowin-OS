import { describe, expect, it } from 'vitest'
import {
  analyzeDecomposition,
  buildOrchestratorDecomposer,
  parseDecompositionPlan
} from './greedy-decompose'
import type { DecompositionOutcome } from './greedy-decompose'
import { compileExecutionQuote } from './execution-quote'
import { ExecutionSupervisor } from './execution-supervisor'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'

describe('parseDecompositionPlan', () => {
  it('parse un tableau JSON propre en nœuds', () => {
    const plan = parseDecompositionPlan(
      '[{"id":"a","prompt":"fais a","deps":[]},{"id":"b","prompt":"fais b","deps":["a"]}]'
    )
    expect(plan).toEqual([
      { id: 'a', prompt: 'fais a', deps: [] },
      { id: 'b', prompt: 'fais b', deps: ['a'] }
    ])
  })

  it('extrait le JSON même entouré de prose / fences ```json', () => {
    const text = 'Voici le plan :\n```json\n[{"id":"x","prompt":"p","deps":[]}]\n```\nVoilà.'
    expect(parseDecompositionPlan(text)).toEqual([{ id: 'x', prompt: 'p', deps: [] }])
  })

  it('rejette (→ []) un plan avec dépendance inconnue', () => {
    expect(parseDecompositionPlan('[{"id":"a","prompt":"p","deps":["ghost"]}]')).toEqual([])
  })

  it('rejette (→ []) un cycle', () => {
    expect(
      parseDecompositionPlan(
        '[{"id":"a","prompt":"p","deps":["b"]},{"id":"b","prompt":"q","deps":["a"]}]'
      )
    ).toEqual([])
  })

  it('rejette (→ []) ids dupliqués, prompt vide, ou item non-objet', () => {
    expect(
      parseDecompositionPlan(
        '[{"id":"a","prompt":"p","deps":[]},{"id":"a","prompt":"q","deps":[]}]'
      )
    ).toEqual([])
    expect(parseDecompositionPlan('[{"id":"a","prompt":"","deps":[]}]')).toEqual([])
    expect(parseDecompositionPlan('[42]')).toEqual([])
  })

  it('renvoie [] sur absence de JSON, JSON invalide, ou tableau vide', () => {
    expect(parseDecompositionPlan('aucun plan ici')).toEqual([])
    expect(parseDecompositionPlan('[{cassé}]')).toEqual([])
    expect(parseDecompositionPlan('[]')).toEqual([])
    expect(parseDecompositionPlan('')).toEqual([])
  })

  it('tolère deps absent (⇒ [])', () => {
    expect(parseDecompositionPlan('[{"id":"a","prompt":"p"}]')).toEqual([
      { id: 'a', prompt: 'p', deps: [] }
    ])
  })
})

describe('analyzeDecomposition — un échec ne se déguise plus en tâche atomique', () => {
  it('distingue « le modèle juge la tâche atomique » de « le modèle a foiré son JSON »', () => {
    // Les deux retombent en séquentiel via parseDecompositionPlan : c'était exactement le point aveugle.
    expect(parseDecompositionPlan('[]')).toEqual([])
    expect(parseDecompositionPlan('{"pas":"un tableau"}')).toEqual([])
    // ...mais l'issue nommée les sépare.
    expect(analyzeDecomposition('[]')).toEqual({ kind: 'atomic' })
    expect(analyzeDecomposition('{"pas":"un tableau"}')).toEqual({
      kind: 'rejected',
      reason: 'no-json'
    })
  })

  it('nomme chaque motif de rejet distinctement', () => {
    const reasonOf = (text: string): string => {
      const outcome = analyzeDecomposition(text)
      return outcome.kind === 'rejected' ? outcome.reason : outcome.kind
    }
    expect(reasonOf('aucun plan ici, que de la prose')).toBe('no-json')
    expect(reasonOf('[{"id":"a", "prompt":]')).toBe('invalid-json')
    expect(reasonOf('[{"id":"a","prompt":"p"},{"id":"a","prompt":"q"}]')).toBe('duplicate-ids')
    expect(reasonOf('[{"id":"a","prompt":"p","deps":["fantome"]}]')).toBe('unknown-dep')
    expect(reasonOf('[{"id":"a","prompt":"p","deps":["b"]},{"id":"b","prompt":"q","deps":["a"]}]')).toBe(
      'cycle'
    )
    expect(reasonOf('[{"id":"a"}]')).toBe('malformed-node')
    expect(reasonOf('[{"id":"a","prompt":"p","deps":[42]}]')).toBe('malformed-node')
  })

  it('rend le plan validé sous la clé nodes, identique à la vue historique', () => {
    const text = '[{"id":"a","prompt":"fais a","deps":[]},{"id":"b","prompt":"fais b","deps":["a"]}]'
    const outcome = analyzeDecomposition(text)
    expect(outcome.kind).toBe('plan')
    expect(outcome.kind === 'plan' ? outcome.nodes : []).toEqual(parseDecompositionPlan(text))
  })
})

describe('buildOrchestratorDecomposer — le sink voit ce que le retour [] cache', () => {
  const decomposerOver = (
    behaviour: () => string | never,
    onOutcome: (outcome: DecompositionOutcome, task: string) => void
  ): ((task: string) => Promise<unknown>) => {
    const provider: ProviderAdapter = {
      id: 'sink-probe',
      supportsExecution: true,
      auth: async () => true,
      async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
        const text = behaviour()
        yield { delta: 'plan' }
        return { text, provider: 'sink-probe', systemInjected: true }
      }
    }
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'test-model' }
    })
    return buildOrchestratorDecomposer({ registry, roles, cwd: process.cwd(), onOutcome })
  }

  it('signale provider-error quand l’appel modèle jette, au lieu de rendre un [] muet', async () => {
    const seen: DecompositionOutcome[] = []
    const decompose = decomposerOver(() => {
      throw new Error('réseau coupé')
    }, (outcome) => seen.push(outcome))

    await expect(decompose('une tâche')).resolves.toEqual([])
    expect(seen).toEqual([{ kind: 'rejected', reason: 'provider-error' }])
  })

  it('signale atomic — un [] VOULU — et transmet la tâche au sink', async () => {
    const seen: Array<[DecompositionOutcome, string]> = []
    const decompose = decomposerOver(
      () => '[]',
      (outcome, task) => seen.push([outcome, task])
    )

    await expect(decompose('renomme une variable')).resolves.toEqual([])
    expect(seen).toEqual([[{ kind: 'atomic' }, 'renomme une variable']])
  })

  it('n’échoue pas quand le sink lui-même jette : il n’est qu’observateur', async () => {
    const decompose = decomposerOver(
      () => '[{"id":"a","prompt":"fais a","deps":[]},{"id":"b","prompt":"fais b","deps":[]}]',
      () => {
        throw new Error('sink cassé')
      }
    )

    await expect(decompose('une tâche')).resolves.toHaveLength(2)
  })
})

describe('buildOrchestratorDecomposer — cycle de spawn réel', () => {
  it('conserve le succès quand le registre fournit le callback PID absent de l’appelant', async () => {
    const supervisor = new ExecutionSupervisor()
    const provider: ProviderAdapter = {
      id: 'spawn-fallback',
      supportsExecution: true,
      auth: async () => true,
      async *send(
        _messages: Message[],
        options?: SendOptions
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        const token = 'decompose-token'
        const pid = 4242
        options?.execution?.onSpawnIntent?.(token, true)
        if (options?.execution?.onSpawned) options.execution.onSpawned(token, pid)
        else {
          options?.execution?.onProcess?.(pid, true)
          options?.execution?.onSpawnIntent?.(token, false)
        }
        yield { delta: 'plan' }
        return {
          text: '[{"id":"a","prompt":"fais a","deps":[]},{"id":"b","prompt":"fais b","deps":["a"]}]',
          provider: 'spawn-fallback',
          systemInjected: true,
          usage: { inputTokens: 10, outputTokens: 2 }
        }
      }
    }
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'test-model' }
    })
    const decompose = buildOrchestratorDecomposer({ registry, roles, cwd: process.cwd() })
    const quote = compileExecutionQuote('refonds ce workflow complexe')

    const plan = await supervisor.run(quote, undefined, () => decompose('refonds le workflow'))

    expect(plan).toHaveLength(2)
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      completedCalls: 1,
      failedCalls: 0,
      activeCalls: 0,
      totalTokens: 12
    })
  })
})
