import { describe, expect, it } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type OrchestrationPhase } from './orchestrator'
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
import { compileExecutionQuote } from './execution-quote'
import { ExecutionSupervisor } from './execution-supervisor'

/** Provider qui enregistre chaque appel (options) et rend une réponse valide + un usage mesurable. */
class RecordingProvider implements ProviderAdapter {
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []

  constructor(readonly id = 'capture') {}

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    yield* [] as StreamChunk[]
    this.calls.push(options)
    const model = options.model ?? ''
    // Un modèle dont le nom contient "crash" LÈVE (simule une erreur réseau/provider) → ne répond pas.
    if (/crash/i.test(model)) throw new Error(`modèle ${model} en échec (simulé)`)
    // Un modèle dont le nom contient "no" vote DEFAUT ; sinon VALIDE. Les sorties d'exec/synthèse
    // renvoient aussi VALIDE (sans importance pour ces tests d'agrégation).
    return {
      text: /no/i.test(model) ? 'DEFAUT: raison' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
      executionEvidence:
        options.execution?.sandbox === 'danger-full-access'
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
  provider: RecordingProvider,
  cost: CostAggregator,
  phase: 'frame' | 'terrain' = 'frame'
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
    cost,
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: [phase],
    phaseFanOut: (requestedPhase) =>
      requestedPhase === phase
        ? [
            { provider: provider.id, model: 'm1' },
            { provider: provider.id, model: 'm2' }
          ]
        : []
  })
}

describe('Orchestrator — fan-out multi-modèles (phase frame)', () => {
  it('réduit la topologie avant tout appel pour préserver build, juge et récupération', async () => {
    const provider = new RecordingProvider()
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('ajoute une page de réglages')
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orch = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      classifyPhases: () => ['frame', 'build'],
      currentExecutionQuote: () => supervisor.currentQuote(),
      currentExecutionUsage: () => supervisor.currentSnapshot(),
      phaseFanOut: (phase) =>
        phase === 'frame'
          ? ['m1', 'm2', 'm3'].map((model) => ({ provider: provider.id, model }))
          : []
    })

    await supervisor.run(quote, undefined, () => orch.run('ajoute une page de réglages'))

    expect(provider.calls.map((call) => call.model)).toEqual(['m1', 'worker', 'judge'])
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedAgents: 3,
      completedCalls: 3,
      activeCalls: 0
    })
    expect(quote.allocation).toMatchObject({
      phaseMembers: { frame: 1 },
      reservedMandatoryAgents: 5,
      estimatedMaxAgents: 5
    })
  })

  it('refuse un pipeline impossible sans toucher le provider', async () => {
    const provider = new RecordingProvider()
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('ajoute une page de réglages', { maxProviderCalls: 2 })
    const registry = new ProviderRegistry(undefined, supervisor).register(provider)
    const orch = new Orchestrator({
      registry,
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      classifyPhases: () => ['frame', 'build'],
      currentExecutionQuote: () => supervisor.currentQuote(),
      currentExecutionUsage: () => supervisor.currentSnapshot()
    })

    await expect(
      supervisor.run(quote, undefined, () => orch.run('ajoute une page de réglages'))
    ).rejects.toThrow(/devis impossible.*avant exécution/i)
    expect(provider.calls).toHaveLength(0)
  })

  it('exécute deux membres Terrain et les rattache au groupe terrain:fanout', async () => {
    const provider = new RecordingProvider()
    const result = await makeOrchestrator(provider, new CostAggregator(), 'terrain').run(
      'prépare le terrain de vérification'
    )

    expect(provider.calls.map((call) => call.model).slice(0, 4)).toEqual([
      'm1',
      'm2',
      'orch',
      'judge'
    ])
    const terrainSteps = result.trace.filter((step) => step.execution?.groupId === 'terrain:fanout')
    expect(terrainSteps).toHaveLength(2)
    expect(terrainSteps.map((step) => step.execution?.phase)).toEqual(['terrain', 'terrain'])
    expect(new Set(terrainSteps.map((step) => step.execution?.agentId))).toEqual(
      new Set(['terrain:m1', 'terrain:m2'])
    )
  })

  it('conserve les membres Terrain quand la phase est décomposée en sous-tâches greedy', async () => {
    const provider = new RecordingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orch = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['terrain', 'build'],
      decompose: async () => [
        { id: 'observe', prompt: 'observe le projet', deps: [] },
        { id: 'prepare', prompt: 'prépare les contrôles', deps: [] }
      ],
      phaseFanOut: (phase) =>
        phase === 'terrain'
          ? [
              { provider: provider.id, model: 'm1' },
              { provider: provider.id, model: 'm2' }
            ]
          : []
    })

    const result = await orch.run('prépare puis construis la modification')

    const terrainAgents = result.trace.filter(
      (step) => step.role === 'subagent' && step.execution?.phase === 'terrain'
    )
    // Le DAG ne se recopie plus sur chaque phase : Terrain garde son panel, une fois par membre.
    expect(terrainAgents).toHaveLength(2)
    expect(new Set(terrainAgents.map((step) => step.model))).toEqual(new Set(['m1', 'm2']))
    expect(terrainAgents.some((step) => step.model === 'worker')).toBe(false)
  })

  it("interrompt le pipeline quand aucun membre Terrain n'a produit de sortie", async () => {
    const provider = new RecordingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orch = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['terrain', 'build'],
      decompose: async () => [
        { id: 'observe', prompt: 'observe le projet', deps: [] },
        { id: 'prepare', prompt: 'prépare les contrôles', deps: ['observe'] }
      ],
      phaseFanOut: (phase) =>
        phase === 'terrain'
          ? [
              { provider: provider.id, model: 'crash-m1' },
              { provider: provider.id, model: 'crash-m2' }
            ]
          : []
    })

    await expect(orch.run('prépare puis construis la modification')).rejects.toThrow(
      /aucun modèle n'a produit de sortie/i
    )
    expect(provider.calls.some((call) => call.model === 'worker')).toBe(false)
  })

  it('attribue un attemptId stable à chacun des N agents dès son démarrage live', async () => {
    const provider = new RecordingProvider()
    const starts: OrchestrationPhase[] = []
    const result = await makeOrchestrator(provider, new CostAggregator()).run(
      'cadre les pistes du projet',
      undefined,
      (phase) => starts.push(phase)
    )

    const fanoutStarts = starts.filter((phase) => phase.execution?.groupId === 'frame:fanout')
    const fanoutSteps = result.trace.filter((step) => step.execution?.groupId === 'frame:fanout')
    expect(fanoutStarts).toHaveLength(2)
    expect(new Set(fanoutStarts.map((phase) => phase.execution?.attemptId)).size).toBe(2)
    expect(fanoutStarts.map((phase) => phase.execution?.attemptId).sort()).toEqual(
      fanoutSteps.map((step) => step.execution?.attemptId).sort()
    )
  })

  it('exécute la phase sur les N modèles puis synthétise via l’orchestrateur', async () => {
    const provider = new RecordingProvider()
    const cost = new CostAggregator()
    const result = await makeOrchestrator(provider, cost).run('cadre les pistes du projet')

    // 2 membres (frame) + 1 synthèse (orchestrateur) + 1 juge = 4 appels.
    expect(provider.calls).toHaveLength(4)
    const models = provider.calls.map((c) => c.model)
    // les 2 premiers = les 2 modèles du bloc frame (ordre non garanti → set)
    expect(new Set(models.slice(0, 2))).toEqual(new Set(['m1', 'm2']))
    // puis la synthèse par le modèle orchestrateur, puis le juge
    expect(models[2]).toBe('orch')
    expect(models[3]).toBe('judge')
    expect(result.valid).toBe(true)
  })

  it('fige un modèle planifié sur tous les appels du run sans muter la topologie', async () => {
    const provider = new RecordingProvider()
    const cost = new CostAggregator()

    await makeOrchestrator(provider, cost).run(
      'cadre les pistes du projet',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { provider: provider.id, model: 'scheduled', reasoningEffort: 'high' }
    )

    expect(provider.calls.map((call) => call.model)).toEqual(['scheduled', 'scheduled'])
    expect(provider.calls.map((call) => call.reasoningEffort)).toEqual(['high', 'high'])
  })

  it('rend le coût par modèle VISIBLE dans la trace (chaque step de fan-out porte model + costUsd)', async () => {
    const provider = new RecordingProvider()
    const cost = new CostAggregator()
    const result = await makeOrchestrator(provider, cost).run('cadre les pistes du projet')

    // La visibilité ×N vit dans la trace d'orchestration : un step par modèle, chacun avec son coût.
    const execModels = result.trace.filter((s) => s.step === 'exec' && s.model).map((s) => s.model)
    expect(execModels).toContain('m1')
    expect(execModels).toContain('m2')
    expect(execModels).toContain('orch') // la synthèse
    const m1Step = result.trace.find((s) => s.model === 'm1')
    expect(m1Step?.costUsd).toBeGreaterThan(0)
    const panelSteps = result.trace.filter((step) => step.execution?.groupId === 'frame:fanout')
    expect(panelSteps).toHaveLength(2)
    expect(panelSteps.map((step) => step.execution?.phase)).toEqual(['frame', 'frame'])
    expect(new Set(panelSteps.map((step) => step.execution?.agentId))).toEqual(
      new Set(['frame:m1', 'frame:m2'])
    )
  })

  it('mono-modèle (aucun phaseFanOut) : comportement inchangé, 1 exec + 1 juge', async () => {
    const provider = new RecordingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orch = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['frame']
      // pas de phaseFanOut → chemin mono-modèle
    })
    const result = await orch.run('cadre les pistes du projet')
    expect(provider.calls).toHaveLength(2) // 1 exec + 1 juge (aucune synthèse)
    expect(provider.calls.map((call) => call.model)).toEqual(['worker', 'judge'])
    expect(result.valid).toBe(true)
  })

  it.each(['frame', 'scout', 'terrain'] as const)(
    'utilise le binding du slot %s quand le panel contient exactement un membre',
    async (phase) => {
      const defaultProvider = new RecordingProvider('default-binding')
      const slotProvider = new RecordingProvider('singleton-slot')
      const registry = new ProviderRegistry().register(defaultProvider).register(slotProvider)
      const roles = new RoleModelConfig({
        subagent: { provider: defaultProvider.id, model: 'worker' },
        judge: { provider: defaultProvider.id, model: 'judge' }
      })
      const orch = new Orchestrator({
        registry,
        roles,
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        authority: new AuthoritySas(),
        executionWorkspace: 'C:\\ws',
        worktrees: makeTestWorktrees('C:\\ws'),
        execPhases: [phase],
        phaseFanOut: (requestedPhase) =>
          requestedPhase === phase
            ? [{ provider: slotProvider.id, model: `${phase}-singleton` }]
            : []
      })

      const result = await orch.run('cadre les pistes du projet')

      expect(slotProvider.calls.map((call) => call.model)).toEqual([`${phase}-singleton`])
      expect(defaultProvider.calls.map((call) => call.model)).toEqual(['judge'])
      expect(result.valid).toBe(true)
    }
  )
})

describe('Orchestrator — fan-out juge (quorum de vote)', () => {
  function makeJudgePanel(provider: RecordingProvider, judges: string[]): Orchestrator {
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
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
      execPhases: ['frame'],
      judgeFanOut: () => judges.map((model) => ({ provider: provider.id, model }))
    })
  }

  it('majorité VALIDE (2/3) → validé', async () => {
    const provider = new RecordingProvider()
    const starts: OrchestrationPhase[] = []
    // 2 juges votent VALIDE, 1 vote DEFAUT ('j-no') → seuil ⌈3/2⌉=2 atteint.
    const result = await makeJudgePanel(provider, ['j-a', 'j-b', 'j-no']).run(
      'cadre les pistes',
      undefined,
      (phase) => starts.push(phase)
    )
    expect(result.valid).toBe(true)
    // 1 exec (mono, pas de phaseFanOut) + 3 juges = 4 appels.
    expect(provider.calls).toHaveLength(4)
    const judgeSteps = result.trace.filter((step) => step.execution?.groupId === 'judge:fanout')
    expect(judgeSteps).toHaveLength(3)
    expect(new Set(judgeSteps.map((step) => step.execution?.agentId))).toEqual(
      new Set(['judge:j-a', 'judge:j-b', 'judge:j-no'])
    )
    const judgeStarts = starts.filter((phase) => phase.execution?.groupId === 'judge:fanout')
    expect(judgeStarts).toHaveLength(3)
    expect(judgeStarts.map((phase) => phase.execution?.attemptId).sort()).toEqual(
      judgeSteps.map((step) => step.execution?.attemptId).sort()
    )
    expect(result.trace.find((step) => step.execution?.agentId === 'judge:quorum')).toMatchObject({
      role: 'orchestrator',
      provider: undefined,
      model: undefined,
      prompt: undefined
    })
  })

  it('minorité VALIDE (1/3) → défaut (quorum non atteint)', async () => {
    const provider = new RecordingProvider()
    const result = await makeJudgePanel(provider, ['j-a', 'j-no1', 'j-no2']).run('cadre les pistes')
    expect(result.valid).toBe(false)
  })

  it('M1 : un juge crashé ne gonfle PAS le dénominateur du quorum', async () => {
    const provider = new RecordingProvider()
    // 3 juges configurés, 2 crashent, 1 seul répond et vote VALIDE.
    // Avant fix : votingN=3, seuil=2, valide=1 → DEFAUT (faux). Après : votingN=1 (répondants), seuil=1 → VALIDE.
    const result = await makeJudgePanel(provider, ['j-ok', 'crash1', 'crash2']).run(
      'cadre les pistes'
    )
    expect(result.valid).toBe(true)
  })

  it('tous les juges crashent → défaut (aucun vote), pas de faux VALIDE', async () => {
    const provider = new RecordingProvider()
    const result = await makeJudgePanel(provider, ['crash1', 'crash2']).run('cadre les pistes')
    expect(result.valid).toBe(false)
  })
})

describe('Orchestrator — fan-out exec : cas limites', () => {
  it('M2 : tous les modèles échouent → la phase JETTE (pas de synthèse fantôme propagée)', async () => {
    const provider = new RecordingProvider()
    const cost = new CostAggregator()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orch = new Orchestrator({
      registry,
      roles,
      cost,
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['frame'],
      phaseFanOut: (phase) =>
        phase === 'frame'
          ? [
              { provider: provider.id, model: 'crash1' },
              { provider: provider.id, model: 'crash2' }
            ]
          : []
    })
    await expect(orch.run('cadre les pistes')).rejects.toThrow(/aucun modèle/i)
  })

  it('good.length===1 (un seul survivant) → pas d’appel de synthèse (orchestrateur non sollicité)', async () => {
    const provider = new RecordingProvider()
    const cost = new CostAggregator()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orch = new Orchestrator({
      registry,
      roles,
      cost,
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['frame'],
      phaseFanOut: (phase) =>
        phase === 'frame'
          ? [
              { provider: provider.id, model: 'm1' },
              { provider: provider.id, model: 'crash2' }
            ]
          : []
    })
    const result = await orch.run('cadre les pistes')
    // m1 réussit, crash2 échoue → 1 survivant → PAS de step de synthèse par l'orchestrateur.
    const synthSteps = result.trace.filter((s) => s.step === 'exec' && s.model === 'orch')
    expect(synthSteps).toHaveLength(0)
    expect(result.valid).toBe(true)
  })
})
