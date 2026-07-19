import type { PromptCallRecord } from './prompt-observability'
import { assertTraceEvent, type TraceEventV1, type TracePayload } from './trace-event'

export function promptCallToTraceEvents(
  call: PromptCallRecord,
  base = call.iteration * 100,
  entryParentId?: string
): TraceEventV1[] {
  const actor = { id: call.actor, kind: 'agent' as const, label: call.actor }
  const provider = {
    id: call.provider,
    model: call.model,
    reasoningEffort:
      typeof call.options.reasoningEffort === 'string' ? call.options.reasoningEffort : undefined,
    transport: call.transport,
    sessionId: call.sessionId
  }
  const messagePayloads: TracePayload[] = call.messages.flatMap((message) => [
    { kind: message.role === 'user' ? 'user-message' : 'history', content: message.content },
    ...(message.attachments ?? []).map<TracePayload>((attachment) => ({
      kind: 'attachment',
      name: attachment.name,
      mediaType: attachment.mimeType,
      content: attachment.content
    }))
  ])
  const systemPayloads: TracePayload[] = call.system
    ? [{ kind: 'system-instruction', content: call.system }]
    : [{ kind: 'system-instruction', content: '' }]

  const make = (
    offset: number,
    type: TraceEventV1['type'],
    payloads: TracePayload[],
    overrides: Partial<TraceEventV1> = {}
  ): TraceEventV1 => {
    const id = `${call.id}:${offset}`
    return assertTraceEvent({
      schema: 'autowin.trace/v1',
      id,
      conversationId: call.conversationId,
      turnId: call.turnId,
      parentId: offset ? `${call.id}:${offset - 1}` : entryParentId,
      timestamp: call.ts,
      sequence: base + offset,
      type,
      status: 'completed',
      actor,
      recipient: { id: call.provider, kind: 'provider', label: call.provider },
      channel:
        type === 'model-response' ? 'assistant' : type === 'injection' ? 'system' : 'internal',
      payloads,
      observation: {
        boundary: call.boundary,
        fidelity: type === 'boundary' ? 'exact' : 'derived',
        limitation: call.limitation
      },
      provider,
      ...overrides
    })
  }

  return [
    make(0, 'message', messagePayloads, { channel: 'user' }),
    make(1, 'injection', systemPayloads, {
      injector: { id: 'autowin', kind: 'system', label: 'Autowin OS' }
    }),
    make(2, 'boundary', [
      { kind: 'app-state', content: JSON.stringify(call.options), mediaType: 'application/json' }
    ]),
    make(
      3,
      call.status === 'failed' ? 'error' : 'model-response',
      [
        {
          kind: call.status === 'failed' ? 'error' : 'model-response',
          content: call.status === 'failed' ? (call.error ?? call.response) : call.response
        }
      ],
      {
        status: call.status === 'failed' ? 'failed' : 'completed',
        actor: { id: call.provider, kind: 'provider', label: call.provider },
        recipient: actor,
        metrics:
          call.usage || call.durationMs !== undefined
            ? {
                durationMs: call.durationMs,
                inputTokens: call.usage?.inputTokens,
                outputTokens: call.usage?.outputTokens,
                cacheReadTokens: call.usage?.cacheReadTokens,
                costUsd: call.usage?.costUsd
              }
            : undefined
      }
    )
  ]
}
