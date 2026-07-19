import { assertTraceEvent, type TraceEventV1 } from './trace-event'

export function responseDisplayedTrace(input: {
  conversationId: string; turnId: string; parentId?: string; sequence: number; content: string; timestamp: string
}): TraceEventV1 {
  return assertTraceEvent({
    schema: 'autowin.trace/v1', id: `${input.conversationId}:displayed:${input.sequence}`,
    conversationId: input.conversationId, turnId: input.turnId, parentId: input.parentId,
    timestamp: input.timestamp, sequence: input.sequence, type: 'response-displayed', status: 'completed',
    actor: { id: 'autowin-renderer', kind: 'system', label: 'Interface Autowin' },
    recipient: { id: 'human', kind: 'human', label: 'Utilisateur' }, channel: 'assistant',
    payloads: [{ kind: 'model-response', content: input.content }],
    observation: { boundary: 'React renderer apres peinture', fidelity: 'exact' }
  })
}
