import { assertTraceEvent, type TraceEventV1 } from './trace-event'

interface PilotActionTraceInput {
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  kind: 'command' | 'result' | 'error' | 'retry' | 'cancellation'
  name?: string
  data?: unknown
  ok?: boolean
}

export function pilotActionToTraceEvent(input: PilotActionTraceInput): TraceEventV1 {
  const type: TraceEventV1['type'] = input.kind === 'command'
    ? 'tool-call'
    : input.kind === 'result'
      ? 'tool-result'
      : input.kind
  const failed = input.kind === 'error' || (input.kind === 'result' && input.ok === false)
  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: input.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    parentId: input.parentId,
    timestamp: input.timestamp,
    sequence: input.sequence,
    type,
    status: input.kind === 'cancellation' ? 'cancelled' : failed ? 'failed' : 'completed',
    actor: input.kind === 'command'
      ? { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' }
      : { id: input.name ?? 'autowin-tool', kind: 'tool', label: input.name ?? 'Outil Autowin' },
    injector: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    recipient: input.kind === 'command'
      ? { id: input.name ?? 'autowin-tool', kind: 'tool', label: input.name ?? 'Outil Autowin' }
      : { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    channel: input.kind === 'retry' || input.kind === 'cancellation' ? 'internal' : 'tool',
    payloads: [{
      kind: input.kind === 'command' ? 'tool-call' : failed || input.kind === 'retry' || input.kind === 'cancellation' ? 'error' : 'tool-result',
      name: input.name,
      content: typeof input.data === 'string' ? input.data : JSON.stringify(input.data ?? null, null, 2)
    }],
    observation: { boundary: 'Autowin OS command bus', fidelity: 'exact' }
  })
}
