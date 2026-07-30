import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
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

/** Provider qui enregistre chaque appel (modèle, resumeSessionId, message) et rend un sessionId. */
class RecordingProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
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
    }) => void
    onRunSettled?: (runId: string) => void
  } = {}
): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: opts.subagent ?? { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: opts.classifyPhases,
    onPhaseCompleted: opts.onPhaseCompleted,
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
