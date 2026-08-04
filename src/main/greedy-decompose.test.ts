import { describe, expect, it } from 'vitest'
import { buildOrchestratorDecomposer, parseDecompositionPlan } from './greedy-decompose'
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
