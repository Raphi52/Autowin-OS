import type { OrchestrationPhase, OrchestrationStep } from '../orchestrator'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { appendPromptCall, promptObservabilityRoot } from './prompt-observability'
import { promptCallToTraceEvents } from './prompt-call-trace'
import { TraceStore } from './trace-store'
import { assertTraceEvent, type TraceEventV1 } from './trace-event'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import { evidencePayloads } from './evidence-payloads'
import { stepPayloads } from './step-reasoning-payloads'
import { latestBrainTraceId } from './brain-trace-spool'
import type { PipelinePhase } from '../skill-pipeline'

interface OrchestrationTraceContext {
  conversationId: string
  turnId: string
  iteration: number
  runId?: string
}

export function persistRunLifecycle(
  lifecycle: RunLifecycleEvent,
  context: { conversationId: string; turnId: string },
  traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
): void {
  const currentTurn = traceStore
    .readConversation(context.conversationId)
    .filter((event) => event.turnId === context.turnId)
  const runEvents = currentTurn.filter(
    (event) => event.run?.runId === lifecycle.runId || event.execution?.runId === lifecycle.runId
  )
  const sequence = traceStore.nextSequence(context.conversationId)
  const label =
    lifecycle.stage === 'quote'
      ? lifecycle.quote.regime
      : lifecycle.stage === 'workspace'
        ? lifecycle.workspace.path
        : lifecycle.stage === 'git'
          ? lifecycle.git.outcome
          : lifecycle.closure.status
  traceStore.append(
    assertTraceEvent({
      schema: 'autowin.trace/v1',
      id: `${context.turnId}:run:${lifecycle.runId}:${lifecycle.stage}:${sequence}`,
      conversationId: context.conversationId,
      turnId: context.turnId,
      parentId: runEvents.at(-1)?.id,
      timestamp: new Date(lifecycle.timestampMs).toISOString(),
      sequence,
      type:
        lifecycle.stage === 'closure'
          ? 'gate'
          : lifecycle.stage === 'quote'
            ? 'decision'
            : 'boundary',
      status:
        lifecycle.stage === 'closure'
          ? lifecycle.closure.status === 'open'
            ? 'running'
            : lifecycle.closure.status === 'red'
              ? 'failed'
              : 'completed'
          : lifecycle.stage === 'quote'
            ? 'completed'
            : lifecycle.stage === 'workspace'
              ? 'running'
              : lifecycle.git.outcome === 'conflict' || lifecycle.git.outcome === 'blocked'
                ? 'failed'
                : 'completed',
      actor: { id: 'autowin-run', kind: 'system', label: 'Autowin OS' },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      channel: 'internal',
      payloads: [{ kind: 'app-state', content: label }],
      observation: { boundary: `Autowin run ${lifecycle.stage}`, fidelity: 'exact' },
      execution: { runId: lifecycle.runId },
      run: lifecycle,
      // Lifecycle = structure/rollup, jamais un nouvel appel facturable.
      metrics: undefined
    })
  )
}

export function persistOrchestrationPhaseStart(
  phase: OrchestrationPhase,
  context: OrchestrationTraceContext,
  traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
): void {
  if (!phase.execution?.attemptId || (phase.step !== 'exec' && phase.step !== 'judge')) return
  const currentTurn = traceStore
    .readConversation(context.conversationId)
    .filter((event) => event.turnId === context.turnId)
  const runTurn = context.runId
    ? currentTurn.filter(
        (event) => event.execution?.runId === context.runId || event.run?.runId === context.runId
      )
    : currentTurn
  const groupEvents = phase.execution.groupId
    ? runTurn.filter((event) => event.execution?.groupId === phase.execution?.groupId)
    : []
  const parentId = groupEvents.length > 0 ? groupEvents[0].parentId : runTurn.at(-1)?.id
  const sequence = traceStore.nextSequence(context.conversationId)
  traceStore.append(
    assertTraceEvent({
      schema: 'autowin.trace/v1',
      id: `${context.turnId}:running:${phase.execution.attemptId}:${sequence}`,
      conversationId: context.conversationId,
      turnId: context.turnId,
      parentId,
      timestamp: new Date().toISOString(),
      sequence,
      type: phase.step === 'judge' ? 'verdict' : 'handoff',
      status: 'running',
      actor: {
        id: phase.execution.agentId ?? phase.role ?? phase.step,
        kind: phase.provider ? 'agent' : 'system',
        label: phase.role ?? phase.execution.agentId ?? phase.step
      },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      channel: 'internal',
      payloads: [{ kind: 'app-state', content: `${phase.step} démarré` }],
      observation: { boundary: `Autowin orchestration ${phase.step} start`, fidelity: 'exact' },
      execution: { ...phase.execution, runId: context.runId ?? phase.execution.runId },
      provider: phase.provider ? { id: phase.provider, model: phase.model } : undefined
    })
  )
}

/**
 * Choisit le parent causal d'un pas en UN SEUL parcours de la liste du fil.
 *
 * Jusqu'au 2026-09-04 cette resolution enchainait quatre balayages de la liste complete par pas
 * persiste — filtre du tour, filtre du run, filtre du groupe, puis une copie INVERSEE de la liste
 * par dependance — soit O(4 x evenements) alors que la liste grandit a chaque pas d'un tour long.
 * La liste n'est plus parcourue qu'UNE fois par pas : `execution` est lu une seule fois puis garde
 * en local, et `run` reste consulte exactement la ou l'ancienne condition le consultait, c'est-a-dire
 * seulement quand `execution.runId` n'a pas conclu.
 *
 * Choix du parent, a l'identique de l'ancienne cascade :
 *  1. le DERNIER evenement `handoff` du run portant la dependance la plus tardive qui en ait un ;
 *  2. sinon le parent du PREMIER evenement du groupe, s'il y en a un ;
 *  3. sinon le DERNIER evenement du run.
 */
function resolveStepParentId(
  events: readonly TraceEventV1[],
  turnId: string,
  runId: string | undefined,
  execution: OrchestrationStep['execution']
): string | undefined {
  const groupId = execution?.groupId
  const dependencyIds = execution?.dependencyIds ?? []
  const wanted = dependencyIds.length > 0 ? new Set(dependencyIds) : undefined
  const dependencyHandoffs = new Map<string, TraceEventV1>()
  let lastRunEvent: TraceEventV1 | undefined
  let firstGroupEvent: TraceEventV1 | undefined

  for (const event of events) {
    if (event.turnId !== turnId) continue
    const eventExecution = event.execution
    if (runId && eventExecution?.runId !== runId && event.run?.runId !== runId) continue
    lastRunEvent = event
    if (groupId && !firstGroupEvent && eventExecution?.groupId === groupId) firstGroupEvent = event
    if (wanted && event.type === 'handoff') {
      const taskId = eventExecution?.taskId
      // Ecrase : la Map garde le DERNIER handoff de chaque dependance, comme la recherche inversee.
      if (taskId !== undefined && wanted.has(taskId)) dependencyHandoffs.set(taskId, event)
    }
  }

  if (wanted) {
    for (let index = dependencyIds.length - 1; index >= 0; index -= 1) {
      const dependencyParent = dependencyHandoffs.get(dependencyIds[index])
      if (dependencyParent) return dependencyParent.id
    }
  }
  if (firstGroupEvent) return firstGroupEvent.parentId
  return lastRunEvent?.id
}

export function persistOrchestrationStep(
  step: OrchestrationStep,
  context: OrchestrationTraceContext,
  promptRoot = promptObservabilityRoot(),
  traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
): void {
  const existing = traceStore.readConversation(context.conversationId)
  let parentId = resolveStepParentId(existing, context.turnId, context.runId, step.execution)
  let sequence = traceStore.nextSequence(context.conversationId)
  const structuralType: TraceEventV1['type'] =
    step.step === 'exec' ? 'handoff' : step.step === 'judge' ? 'verdict' : 'gate'
  const structural = (): TraceEventV1 =>
    assertTraceEvent({
      schema: 'autowin.trace/v1',
      id: `${context.turnId}:${step.step}:${context.iteration}:${sequence}`,
      conversationId: context.conversationId,
      turnId: context.turnId,
      parentId,
      timestamp: new Date().toISOString(),
      sequence: sequence++,
      type: structuralType,
      status: step.status === 'provider-blocked' ? 'failed' : (step.status ?? 'completed'),
      actor: {
        id: step.execution?.agentId ?? step.role ?? step.step,
        kind: step.step === 'gate' || !step.provider ? 'system' : 'agent',
        label: step.role ?? step.execution?.agentId ?? step.step
      },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      channel: 'internal',
      /**
       * Inclut desormais le RAISONNEMENT du sous-agent (`step.thinking`), affiche dans le chat mais
       * absent de la trace jusqu'au 2026-08-07 : Observatory montrait la conclusion d'un sous-agent
       * sans la deliberation qui y menait. Charge distincte, jamais concatenee a la conclusion.
       */
      payloads: stepPayloads(step),
      observation: { boundary: `Autowin orchestration ${step.step}`, fidelity: 'exact' },
      execution: { ...step.execution, runId: context.runId ?? step.execution?.runId },
      provider: step.provider ? { id: step.provider, model: step.model } : undefined,
      metrics: {
        durationMs: step.durationMs,
        inputTokens: step.usage?.inputTokens,
        outputTokens: step.usage?.outputTokens,
        cacheReadTokens: step.usage?.cacheReadTokens,
        costUsd: step.costUsd ?? step.usage?.costUsd
      }
    })

  if (step.step === 'exec') {
    const event = structural()
    traceStore.append(event)
    parentId = event.id
    // G1/G3 — persiste les VRAIES actions du sous-agent (commandes shell, patchs fichiers) comme
    // événements causaux `tool-call` : sinon l'usage d'outils réel reste invisible dans Observatory
    // (seules les traces natives y comptaient). Rattachés à l'étape exec, dans l'ordre observé.
    for (const item of step.evidence ?? []) {
      // Calcule AVANT le litteral : un spread d'IIFE elargissait le type et faisait echouer le
      // typecheck sur l'evenement entier.
      const evidenceCharges = evidencePayloads(item)
      const toolEvent = assertTraceEvent({
        schema: 'autowin.trace/v1',
        id: `${context.turnId}:tool:${step.step}:${context.iteration}:${sequence}`,
        conversationId: context.conversationId,
        turnId: context.turnId,
        parentId,
        timestamp: new Date().toISOString(),
        sequence: sequence++,
        type: 'tool-call',
        status: item.ok ? 'completed' : 'failed',
        actor: { id: item.kind, kind: 'tool', label: item.kind },
        recipient: { id: step.role ?? 'subagent', kind: 'agent', label: step.role ?? 'subagent' },
        channel: 'tool',
        /**
         * Transporte ce que le CHAT affiche deja (commande, code de sortie, sortie brute, diff) au
         * lieu du seul resume.
         *
         * Avant le 2026-08-07 cette charge valait `item.summary || item.type` TOUT EN declarant
         * `fidelity: 'exact'` — un libelle menteur : Observatory affirmait l'exactitude en montrant
         * une version appauvrie de ce que l'utilisateur avait sous les yeux. La fidelite est
         * desormais CALCULEE : `exact` seulement si le contenu integral passe, `derived` sinon
         * (resume seul, ou sortie bornee — et la borne est annoncee dans le contenu).
         */
        payloads: evidenceCharges.payloads,
        observation: {
          boundary: `Autowin exec ${item.type}`,
          fidelity: evidenceCharges.fidelity,
          limitation: evidenceCharges.limitation
        },
        execution: { ...step.execution, runId: context.runId ?? step.execution?.runId }
      })
      traceStore.append(toolEvent)
      parentId = toolEvent.id
    }
  }
  if (!step.prompt || !step.provider || !step.role || step.text === undefined) {
    if (step.step !== 'exec') traceStore.append(structural())
    return
  }
  const call = appendPromptCall(
    {
      ...context,
      brainTraceId: latestBrainTraceId(context.conversationId, context.turnId),
      actor: step.role,
      phase: step.execution?.phase as PipelinePhase | undefined,
      provider: step.prompt.provider,
      model: step.prompt.model,
      transport: step.prompt.transport,
      boundary: 'Autowin OS -> provider transport',
      limitation: step.prompt.limitation,
      system: step.prompt.system,
      systemBlocks: step.prompt.systemBlocks,
      contextBlocks: step.prompt.contextBlocks,
      messages: step.prompt.messages,
      options: step.prompt.options,
      response: step.text,
      status: step.status === 'provider-blocked' ? 'failed' : (step.status ?? 'completed'),
      error: step.error,
      usage: step.usage,
      durationMs: step.durationMs
    },
    promptRoot
  )
  // Le callback appelant persiste ensuite l'activite avec le MEME objet step : cette reference
  // causale remplace les appariements fragiles par provider/cout.
  step.usageCallId = call.id
  const providerEvents = promptCallToTraceEvents(call, sequence, parentId).map((event) => ({
    ...event,
    execution: { ...step.execution, runId: context.runId ?? step.execution?.runId }
  }))
  for (const event of providerEvents) traceStore.append(event)
  sequence += providerEvents.length
  parentId = providerEvents.at(-1)?.id
  if (step.step === 'judge') traceStore.append(structural())
}
