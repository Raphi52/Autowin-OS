import type { OrchestrationStep } from '../orchestrator'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { appendPromptCall, promptObservabilityRoot } from './prompt-observability'
import { promptCallToTraceEvents } from './prompt-call-trace'
import { TraceStore } from './trace-store'
import { assertTraceEvent, type TraceEventV1 } from './trace-event'

export function persistOrchestrationStep(
  step: OrchestrationStep,
  context: { conversationId: string; turnId: string; iteration: number },
  promptRoot = promptObservabilityRoot(),
  traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
): void {
  const existing = traceStore.readConversation(context.conversationId)
  const currentTurn = existing.filter((event) => event.turnId === context.turnId)
  const groupEvents = step.execution?.groupId
    ? currentTurn.filter((event) => event.execution?.groupId === step.execution?.groupId)
    : []
  const dependencyParent = [...(step.execution?.dependencyIds ?? [])]
    .reverse()
    .map((dependencyId) =>
      [...currentTurn]
        .reverse()
        .find((event) => event.execution?.taskId === dependencyId && event.type === 'handoff')
    )
    .find(Boolean)
  let parentId =
    dependencyParent?.id ??
    (groupEvents.length > 0 ? groupEvents[0].parentId : currentTurn.at(-1)?.id)
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
      status: step.status ?? 'completed',
      actor: {
        id: step.execution?.agentId ?? step.role ?? step.step,
        kind: step.step === 'gate' || !step.provider ? 'system' : 'agent',
        label: step.role ?? step.execution?.agentId ?? step.step
      },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      channel: 'internal',
      payloads: [
        {
          kind: step.step === 'gate' ? 'app-state' : 'model-response',
          content: step.error ?? step.text ?? step.detail ?? ''
        }
      ],
      observation: { boundary: `Autowin orchestration ${step.step}`, fidelity: 'exact' },
      execution: step.execution,
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
        payloads: [{ kind: 'tool-call', content: item.summary || item.type }],
        observation: { boundary: `Autowin exec ${item.type}`, fidelity: 'exact' },
        execution: step.execution
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
      actor: step.role,
      provider: step.prompt.provider,
      model: step.prompt.model,
      transport: step.prompt.transport,
      boundary: 'Autowin OS -> provider transport',
      limitation: step.prompt.limitation,
      system: step.prompt.system,
      systemBlocks: step.prompt.systemBlocks,
      messages: step.prompt.messages,
      options: step.prompt.options,
      response: step.text,
      status: step.status ?? 'completed',
      error: step.error,
      usage: step.usage,
      durationMs: step.durationMs
    },
    promptRoot
  )
  const providerEvents = promptCallToTraceEvents(call, sequence, parentId).map((event) => ({
    ...event,
    execution: step.execution
  }))
  for (const event of providerEvents) traceStore.append(event)
  sequence += providerEvents.length
  parentId = providerEvents.at(-1)?.id
  if (step.step === 'judge') traceStore.append(structural())
}
