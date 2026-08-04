import { describe, expect, it } from 'vitest'
import { Orchestrator, type RunWorktrees } from './orchestrator'
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
import type { PipelinePhase } from './skill-pipeline'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { ExecutionQuote } from './execution-quote'
import { compileExecutionQuote } from './execution-quote'
import { ExecutionSupervisor } from './execution-supervisor'
import {
  loadOrchestrationStates,
  saveOrchestrationAgentCheckpoint,
  saveOrchestrationState
} from './runs/orchestration-state'
import { preparePersistedRunForRelaunch } from './runs/run-reattach'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Provider qui enregistre chaque appel (modèle, resumeSessionId, message) et rend un sessionId. */
class RecordingProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  /** Tient le rôle d'un adaptateur qui REPREND vraiment : sans ça, plus de session à chaîner. */
  readonly honoursSessionResume = true
  readonly calls: SendOptions[] = []
  readonly userMessages: string[] = []
  execCount = 0
  constructor(private readonly emitsSessionId = true) {}
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    this.userMessages.push(String(messages[messages.length - 1]?.content ?? ''))
    const isExec = options.execution?.sandbox === 'danger-full-access'
    if (isExec) this.execCount += 1
    const isJudge = options.execution?.sandbox === 'read-only'
    return {
      text: isJudge ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system),
      sessionId: this.emitsSessionId ? `sess-${this.calls.length}` : undefined,
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
  opts: {
    classifyPhases?: (t: string) => PipelinePhase[]
    subagent?: Parameters<RoleModelConfig['setBinding']>[1]
    onPhaseCompleted?: (info: {
      runId: string
      task: string
      phaseOutputs: { phase: PipelinePhase; text: string }[]
      executionQuote?: ExecutionQuote
      usage?: ReturnType<ExecutionSupervisor['currentSnapshot']>
      agents?: Array<{ token: string; pid?: number; identity?: string; journalPath?: string }>
    }) => void
    onAgentsChanged?: (
      runId: string,
      agents: Array<{ token: string; pid?: number; identity?: string; journalPath?: string }>
    ) => void
    onRunSettled?: (runId: string) => void
    processIdentity?: (pid: number) => string | undefined
    currentExecutionQuote?: () => ExecutionQuote | undefined
    executionSupervisor?: ExecutionSupervisor
    worktrees?: RunWorktrees
  } = {}
): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry(undefined, opts.executionSupervisor).register(provider),
    roles: new RoleModelConfig({
      subagent: opts.subagent ?? { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\ws',
    worktrees: opts.worktrees ?? makeTestWorktrees('C:\\ws'),
    classifyPhases: opts.classifyPhases,
    onPhaseCompleted: opts.onPhaseCompleted,
    onAgentsChanged: opts.onAgentsChanged,
    ...(opts.processIdentity ? { processIdentity: opts.processIdentity } : {}),
    currentExecutionQuote: opts.currentExecutionQuote,
    onRunSettled: opts.onRunSettled
  })
}

describe('#1 pipeline adaptatif', () => {
  it('classifyPhases prime : une tâche joue exactement le sous-ensemble retourné', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider, { classifyPhases: () => ['build'] })
    await orch.run('corrige le bug')
    // 1 phase exec (build) + 1 juge = 2 appels ; pas 5 phases.
    expect(provider.execCount).toBe(1)
    expect(provider.calls).toHaveLength(2)
  })

  it('sans classifyPhases : fallback execPhases statique (rétrocompat)', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider) // ni classifyPhases ni execPhases → défaut ['build']
    await orch.run('corrige le bug')
    expect(provider.execCount).toBe(1)
  })
})

class DefectJudgeProvider extends RecordingProvider {
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const result = yield* super.send(messages, options)
    return options.execution?.sandbox === 'read-only'
      ? { ...result, text: 'DEFAUT: preuve' }
      : result
  }
}

describe('budget de recuperation du devis', () => {
  it('ne lance aucune reparation quand maxRecoveries vaut zero', async () => {
    const provider = new DefectJudgeProvider()
    const quote = compileExecutionQuote('corrige la typo')
    quote.limits.maxRecoveries = 0
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      currentExecutionQuote: () => quote
    })

    const result = await orch.run('corrige la typo')

    expect(result.gateBlocked).toBe(true)
    expect(provider.calls).toHaveLength(2)
    expect(provider.execCount).toBe(1)
  })
})

describe('#2 modèle par phase', () => {
  it('applique le petit modèle sur les phases d’analyse, le gros sur build', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['frame', 'build'],
      subagent: {
        provider: provider.id,
        model: 'gros',
        reasoningEffort: 'high',
        phaseModel: { frame: { model: 'petit', reasoningEffort: 'low' } }
      }
    })
    await orch.run('ajoute une fonctionnalité')
    // calls[0] = frame (petit), calls[1] = build (gros), calls[2] = juge
    expect(provider.calls[0].model).toBe('petit')
    expect(provider.calls[0].reasoningEffort).toBe('low')
    expect(provider.calls[1].model).toBe('gros')
    expect(provider.calls[1].reasoningEffort).toBe('high')
  })
})

describe('#3 session-resume chaîné', () => {
  it('la phase N+1 reçoit le sessionId de la phase N et un message allégé', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider, { classifyPhases: () => ['frame', 'build'] })
    await orch.run('ajoute une fonctionnalité')
    // Phase 1 (frame) : pas de resume, message complet contient la TÂCHE.
    expect(provider.calls[0].resumeSessionId).toBeUndefined()
    expect(provider.userMessages[0]).toContain('TÂCHE')
    // Phase 2 (build) : reprend la session de la phase 1, message allégé (pas de re-injection TÂCHE).
    expect(provider.calls[1].resumeSessionId).toBe('sess-1')
    expect(provider.userMessages[1]).toContain('Continue À PARTIR de l')
    expect(provider.userMessages[1]).not.toContain('TÂCHE:')
    // …MAIS le CADRAGE reste TOUJOURS ré-injecté explicitement : c'est le socle du prompt remis au
    // sous-agent, on ne le confie jamais au seul historique de session (opaque, variable, cassé par un fan-out).
    expect(provider.userMessages[1]).toContain('RAPPEL DU CADRAGE')
    expect(provider.userMessages[1]).toContain('[phase frame]')
  })

  it('dégradation gracieuse : provider sans sessionId → pas de resume, message complet', async () => {
    const provider = new RecordingProvider(false) // n'émet aucun sessionId
    const orch = makeOrchestrator(provider, { classifyPhases: () => ['frame', 'build'] })
    await orch.run('ajoute une fonctionnalité')
    expect(provider.calls[0].resumeSessionId).toBeUndefined()
    expect(provider.calls[1].resumeSessionId).toBeUndefined()
    expect(provider.userMessages[1]).toContain('[phase frame]') // re-injection complète (fallback)
  })
})

describe('survie niveau 3 — reprise d’un run interrompu', () => {
  it('ne REFAIT pas une phase déjà acquise et réinjecte son livrable', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider, { classifyPhases: () => ['frame', 'build'] })
    // `frame` a déjà été produite avant le kill → seule `build` doit appeler le modèle (+ le juge).
    await orch.run('ajoute une fonctionnalité', undefined, undefined, undefined, undefined, '', [
      { phase: 'frame', text: 'BESOIN CADRÉ AVANT LE KILL' }
    ])
    const execCalls = provider.userMessages.filter((m) => m.includes('BESOIN CADRÉ AVANT LE KILL'))
    // La phase reprise est REJOUÉE dans le contexte, jamais re-exécutée.
    expect(execCalls.length).toBeGreaterThan(0)
    expect(provider.userMessages[0]).toContain('[phase frame] BESOIN CADRÉ AVANT LE KILL')
  })

  it('notifie l’acquis DÈS LE DÉMARRAGE puis après chaque phase (persistance + effacement)', async () => {
    const provider = new RecordingProvider()
    const completed: { runId: string; phases: string[] }[] = []
    const settled: string[] = []
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['frame', 'build'],
      onPhaseCompleted: ({ runId, phaseOutputs }) =>
        completed.push({ runId, phases: phaseOutputs.map((o) => o.phase) }),
      onRunSettled: (runId) => settled.push(runId)
    })
    await orch.run('ajoute une fonctionnalité')
    // Le PREMIER acquis est vide, enregistré avant toute phase : c'est lui qui rend reprenable un run
    // tué pendant sa première phase (la plus longue). Sans lui, la tâche était simplement perdue.
    expect(completed.map((c) => c.phases)).toEqual([[], ['frame'], ['frame', 'build']])
    expect(settled).toEqual([completed[0].runId])
  })
})

describe('survie niveau 3 — garde-fou acquis vide', () => {
  it('REJOUE une phase dont le livrable repris est vide (ne la saute pas)', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider, { classifyPhases: () => ['frame', 'build'] })
    // `frame` persistée sans livrable (cas réel) → elle DOIT être rejouée, sinon son travail est perdu.
    await orch.run('ajoute une fonctionnalité', undefined, undefined, undefined, undefined, '', [
      { phase: 'frame', text: '   ' }
    ])
    // frame + build + juge = 3 appels ; si frame avait été sautée à tort, il n'y en aurait que 2.
    expect(provider.calls).toHaveLength(3)
    expect(provider.userMessages[0]).toContain('TÂCHE')
  })
})

/**
 * RATTACHEMENT. Un CLI détaché survit à la mort de l'app et continue d'écrire dans son journal.
 * Pour s'y rebrancher au redémarrage — au lieu de tout relancer ou de demander un clic — l'état
 * persisté doit porter le jeton, le pid et le CHEMIN DU JOURNAL de chaque agent lancé.
 */
class JournalingProvider extends RecordingProvider {
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    // Ce que fait un vrai provider survivable : il annonce son journal, puis son pid.
    options.execution?.onJournal?.('tok-1', 'C:/journaux/tok-1.stdout.jsonl')
    options.execution?.onSpawned?.('tok-1', 4242)
    return yield* super.send(messages, options)
  }
}

class SpawnIntentProvider extends RecordingProvider {
  private announced = false

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if (!this.announced) {
      this.announced = true
      options.execution?.onSpawnIntent?.('tok-pending', true)
      options.execution?.onSpawned?.('tok-pending', 4242)
    }
    return yield* super.send(messages, options)
  }
}

class CancelledSpawnIntentProvider extends RecordingProvider {
  private announced = false

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if (!this.announced) {
      this.announced = true
      options.execution?.onSpawnIntent?.('tok-failed', true)
      options.execution?.onSpawnIntent?.('tok-failed', false)
    }
    return yield* super.send(messages, options)
  }
}

class FailedSpawnBoundaryProvider extends RecordingProvider {
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    options.execution?.onSpawnIntent?.('tok-failed-boundary', true)
    options.execution?.onSpawnIntent?.('tok-failed-boundary', false)
    throw new Error('spawn failed after cancellation checkpoint')
  }
}

class ConcurrentObserverProvider extends RecordingProvider {
  private callIndex = 0
  private firstEnteredResolve!: () => void
  private secondEnteredResolve!: () => void
  private firstReleaseResolve!: () => void
  private secondReleaseResolve!: () => void
  readonly firstEntered = new Promise<void>((resolve) => (this.firstEnteredResolve = resolve))
  readonly secondEntered = new Promise<void>((resolve) => (this.secondEnteredResolve = resolve))
  private readonly firstRelease = new Promise<void>(
    (resolve) => (this.firstReleaseResolve = resolve)
  )
  private readonly secondRelease = new Promise<void>(
    (resolve) => (this.secondReleaseResolve = resolve)
  )

  releaseFirst(): void {
    this.firstReleaseResolve()
  }

  releaseSecond(): void {
    this.secondReleaseResolve()
  }

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const index = ++this.callIndex
    if (index === 1) {
      this.firstEnteredResolve()
      await this.firstRelease
    } else if (index === 2) {
      this.secondEnteredResolve()
      await this.secondRelease
    }
    options.execution?.onSpawnIntent?.(`tok-${index}`, true)
    options.execution?.onSpawned?.(`tok-${index}`, 4200 + index)
    return yield* super.send(messages, options)
  }
}

describe('rattachement — l’état persisté porte les agents lancés', () => {
  it('libère les agents en mémoire quand le run atteint son état terminal', async () => {
    const provider = new SpawnIntentProvider()
    const orch = makeOrchestrator(provider, { classifyPhases: () => ['build'] })

    await orch.run('modifie un fichier')

    const state = orch as unknown as { runAgents: Map<string, unknown> }
    expect(state.runAgents.size).toBe(0)
  })

  it("conserve les agents d'un run vert dont l'intégration reste reprenable", async () => {
    const provider = new SpawnIntentProvider()
    const worktrees = makeTestWorktrees('C:\\ws')
    worktrees.end = () => ({ outcome: 'conflict' })
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      worktrees
    })

    await orch.run('modifie un fichier')

    const state = orch as unknown as { runAgents: Map<string, unknown> }
    expect(state.runAgents.size).toBe(1)
  })

  it('isole les observateurs de deux runs concurrents sur le meme cwd', async () => {
    const provider = new ConcurrentObserverProvider()
    const tokensByRun = new Map<string, string[]>()
    const runByTask = new Map<string, string>()
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      onPhaseCompleted: (info) => runByTask.set(info.task, info.runId),
      onAgentsChanged: (runId, agents) =>
        tokensByRun.set(
          runId,
          agents.map((agent) => agent.token)
        )
    })

    const first = orch.run('analyse concurrente A')
    await provider.firstEntered
    const second = orch.run('analyse concurrente B')
    await provider.secondEntered
    provider.releaseFirst()
    await first
    provider.releaseSecond()
    await second

    expect(tokensByRun.get(runByTask.get('analyse concurrente A') ?? '')).toEqual([
      'tok-1',
      'tok-3'
    ])
    expect(tokensByRun.get(runByTask.get('analyse concurrente B') ?? '')).toEqual([
      'tok-2',
      'tok-4'
    ])
  })

  it("persiste le token pending avant que le provider n'annonce son pid", async () => {
    const provider = new SpawnIntentProvider()
    const snapshots: Array<Array<{ token: string; pid?: number }>> = []
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      onAgentsChanged: (_runId, agents) => snapshots.push(agents)
    })

    await orch.run('modifie un fichier')

    expect(snapshots.slice(0, 2)).toEqual([
      [{ token: 'tok-pending' }],
      [{ token: 'tok-pending', pid: 4242 }]
    ])
  })

  it("persiste sur disque l'appel actif avant l'annonce du pid", async () => {
    const root = mkdtempSync(join(tmpdir(), 'orch-pending-'))
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('modifie un fichier')
    let checkpointAtIntent: ReturnType<typeof loadOrchestrationStates>[number] | undefined
    const provider = new SpawnIntentProvider()
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      executionSupervisor: supervisor,
      currentExecutionQuote: () => supervisor.currentQuote(),
      onPhaseCompleted: (info) =>
        saveOrchestrationState(root, {
          runId: info.runId,
          task: info.task,
          phaseOutputs: info.phaseOutputs,
          ...(info.executionQuote ? { executionQuote: info.executionQuote } : {}),
          ...(info.usage ? { usage: info.usage } : {}),
          ...(info.agents?.length ? { agents: info.agents } : {}),
          startedAt: 1,
          updatedAt: 1
        }),
      onAgentsChanged: (runId, agents) => {
        saveOrchestrationAgentCheckpoint(root, runId, agents, supervisor.currentSnapshot(), 2)
        if (!agents[0]?.pid) checkpointAtIntent = loadOrchestrationStates(root)[0]
      }
    })

    try {
      await supervisor.run(quote, undefined, () => orch.run('modifie un fichier'))
      expect(checkpointAtIntent).toMatchObject({
        agents: [{ token: 'tok-pending' }],
        usage: { startedAgents: 1, startedCalls: 1, activeCalls: 1 },
        updatedAt: 2
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("retire le token pending quand le spawn est annule avant d'obtenir un pid", async () => {
    const provider = new CancelledSpawnIntentProvider()
    const snapshots: Array<Array<{ token: string; pid?: number }>> = []
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      onAgentsChanged: (_runId, agents) => snapshots.push(agents)
    })

    await expect(orch.run('modifie un fichier')).rejects.toThrow(/annul.*processus/i)

    expect(snapshots.slice(0, 2)).toEqual([[{ token: 'tok-failed' }], []])
  })

  it("règle l'appel avant de persister le retrait d'un spawn annulé", async () => {
    const root = mkdtempSync(join(tmpdir(), 'orch-cancelled-spawn-'))
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('modifie un fichier')
    const provider = new FailedSpawnBoundaryProvider()
    let checkpointAtCancellation: ReturnType<typeof loadOrchestrationStates>[number] | undefined
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      executionSupervisor: supervisor,
      currentExecutionQuote: () => supervisor.currentQuote(),
      onPhaseCompleted: (info) =>
        saveOrchestrationState(root, {
          runId: info.runId,
          task: info.task,
          phaseOutputs: info.phaseOutputs,
          ...(info.executionQuote ? { executionQuote: info.executionQuote } : {}),
          ...(info.usage ? { usage: info.usage } : {}),
          ...(info.agents?.length ? { agents: info.agents } : {}),
          startedAt: 1,
          updatedAt: 1
        }),
      onAgentsChanged: (runId, agents) => {
        saveOrchestrationAgentCheckpoint(root, runId, agents, supervisor.currentSnapshot(), 2)
        if (agents.length === 0) checkpointAtCancellation = loadOrchestrationStates(root)[0]
      }
    })

    try {
      await expect(
        supervisor.run(quote, undefined, () => orch.run('modifie un fichier'))
      ).rejects.toThrow('spawn failed after cancellation checkpoint')
      expect(checkpointAtCancellation?.usage).toMatchObject({
        startedCalls: 1,
        failedCalls: 1,
        activeCalls: 0
      })

      const prepared = preparePersistedRunForRelaunch(
        root,
        checkpointAtCancellation!.runId,
        () => undefined
      )
      const resumedSupervisor = new ExecutionSupervisor()
      let resumedProviderReached = false
      await resumedSupervisor.run(
        quote,
        undefined,
        async () => {
          const reservation = resumedSupervisor.reserveProviderCall(undefined, true)
          resumedProviderReached = true
          reservation?.complete({ inputTokens: 1, outputTokens: 1 })
        },
        prepared?.usage
      )

      expect(resumedProviderReached).toBe(true)
      expect(resumedSupervisor.lastSnapshot()).toMatchObject({
        startedCalls: 2,
        activeCalls: 0
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('repersiste journal et pid dès leur annonce, avant la fin de la phase', async () => {
    const provider = new JournalingProvider()
    const events: string[] = []
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      onPhaseCompleted: (info) => events.push(`phase:${info.phaseOutputs.length}`),
      onAgentsChanged: (_runId, agents) =>
        events.push(`agents:${agents[0]?.pid ? 'pid' : 'journal'}`)
    })

    await orch.run('modifie un fichier')

    expect(events.slice(0, 4)).toEqual(['phase:0', 'agents:journal', 'agents:pid', 'phase:1'])
  })

  it('le journal et le pid annoncés par le provider arrivent jusqu’au point de sauvegarde', async () => {
    const provider = new JournalingProvider()
    const saved: Array<{ agents?: Array<{ token: string; pid?: number; journalPath?: string }> }> =
      []
    const orch = makeOrchestrator(provider, {
      classifyPhases: () => ['build'],
      onPhaseCompleted: (info) => saved.push({ agents: info.agents })
    })

    await orch.run('modifie un fichier')

    const dernier = saved.at(-1)
    expect(dernier?.agents).toEqual([
      { token: 'tok-1', pid: 4242, journalPath: 'C:/journaux/tok-1.stdout.jsonl' }
    ])
  })
})
