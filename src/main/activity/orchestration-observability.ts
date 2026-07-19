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
  let parentId = existing.at(-1)?.id
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
        id: step.role ?? step.step,
        kind: step.step === 'gate' ? 'system' : 'agent',
        label: step.role ?? step.step
      },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      channel: 'internal',
      payloads: [
        {
          kind: step.step === 'gate' ? 'app-state' : 'model-response',
          content: step.error ?? step.text ?? step.detail ?? ''
        }
      ],
      observation: { boundary: `Autowin orchestration ${step.step}`, fidelity: 'exact' }
    })

  if (step.step === 'exec') {
    const event = structural()
    traceStore.append(event)
    parentId = event.id
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
  const providerEvents = promptCallToTraceEvents(call, sequence, parentId)
  for (const event of providerEvents) traceStore.append(event)
  sequence += providerEvents.length
  parentId = providerEvents.at(-1)?.id
  if (step.step === 'judge') traceStore.append(structural())
}
