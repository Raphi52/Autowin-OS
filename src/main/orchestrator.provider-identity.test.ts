import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type OrchestrationRuntimeSnapshot } from './orchestrator'
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
 * Provider enregistré sous `requested` mais qui, dans sa réponse, se déclare `actual-executor`
 * (simule le reroute du registre : rôle non-exécuteur → exécuteur local). La trace et le coût
 * doivent refléter le provider RÉEL (`actual-executor`), pas le demandé.
 */
class StableProvider implements ProviderAdapter {
  readonly supportsExecution = true
  calls = 0

  constructor(
    readonly id: string,
    private readonly model: string
  ) {}

  async auth(): Promise<boolean> {
    return true
  }

  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    return {
      text: 'VALIDE',
      provider: this.id,
      model: this.model,
      systemInjected: true,
      usage: { inputTokens: 2, outputTokens: 1 }
    }
  }
}

class ReroutingProvider implements ProviderAdapter {
  readonly id = 'requested'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: 'VALIDE',
      provider: 'actual-executor',
      model: 'actual-model',
      systemInjected: true,
      usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.002 }
    }
  }
}

describe('Orchestrator — identité provider réelle dans trace + coût', () => {
  it('trace et coût attribuent le provider AYANT RÉPONDU, pas le demandé', async () => {
    const provider = new ReroutingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: 'requested', model: 'worker' },
      judge: { provider: 'requested', model: 'judge' }
    })
    const cost = new CostAggregator()
    const result = await new Orchestrator({
      registry,
      roles,
      cost,
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['build']
    }).run('cadre les pistes du projet')

    // La trace montre le provider réel sur les steps exec/judge.
    const providers = result.trace
      .filter((s) => s.step === 'exec' || s.step === 'judge')
      .map((s) => s.provider)
    expect(providers).toContain('actual-executor')
    expect(providers).not.toContain('requested')

    // Le coût est agrégé sous le provider réel, jamais sous le demandé.
    expect(cost.byProvider()['actual-executor']).toBeDefined()
    expect(cost.byProvider()['requested']).toBeUndefined()

    // #6 — la trace porte le MODÈLE réellement rapporté par le provider, pas le demandé.
    const models = result.trace
      .filter((s) => s.step === 'exec' || s.step === 'judge')
      .map((s) => s.model)
    expect(models).toContain('actual-model')
    expect(models).not.toContain('worker')
  })

  it('execute tout le run avec le snapshot persiste meme si les roles globaux ont change', async () => {
    const codex = new StableProvider('codex-snapshot', 'gpt-5.6-sol')
    const gemini = new StableProvider('gemini-stale', 'gemini-2.5-pro')
    const registry = new ProviderRegistry().register(codex).register(gemini)
    const roles = new RoleModelConfig({
      orchestrator: { provider: gemini.id, model: 'gemini-2.5-pro' },
      subagent: { provider: gemini.id, model: 'gemini-2.5-pro' },
      judge: { provider: gemini.id, model: 'gemini-2.5-pro' },
      scout: { provider: gemini.id, model: 'gemini-2.5-pro' }
    })
    const binding = { provider: codex.id, model: 'gpt-5.6-sol', reasoningEffort: 'low' as const }
    const snapshot: OrchestrationRuntimeSnapshot = {
      roles: {
        orchestrator: binding,
        subagent: binding,
        judge: binding,
        scout: binding
      },
      phaseFanOut: { build: [] },
      judgeFanOut: []
    }
    const checkpointSnapshots: Array<OrchestrationRuntimeSnapshot | undefined> = []

    const result = await new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['build'],
      onPhaseCompleted: (checkpoint) => checkpointSnapshots.push(checkpoint.runtimeSnapshot)
    }).run(
      'corrige le bug',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      snapshot
    )

    expect(codex.calls).toBeGreaterThan(0)
    expect(gemini.calls).toBe(0)
    expect(
      result.trace
        .filter((step) => step.step === 'exec' || step.step === 'judge')
        .map((step) => `${step.provider}/${step.model}`)
    ).toEqual(expect.arrayContaining(['codex-snapshot/gpt-5.6-sol']))
    expect(checkpointSnapshots.length).toBeGreaterThanOrEqual(2)
    expect(checkpointSnapshots.every((checkpoint) => checkpoint === snapshot)).toBe(true)
  })
})
