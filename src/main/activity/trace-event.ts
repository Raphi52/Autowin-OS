export type TraceEventType =
  | 'message'
  | 'injection'
  | 'decision'
  | 'tool-call'
  | 'tool-result'
  | 'model-response'
  | 'response-displayed'
  | 'handoff'
  | 'verdict'
  | 'gate'
  | 'retry'
  | 'cancellation'
  | 'error'
  | 'boundary'

export type TraceEventStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TraceActorKind = 'human' | 'system' | 'agent' | 'judge' | 'tool' | 'provider'
export type TraceParticipantKind = TraceActorKind | 'skill' | 'hook' | 'resource'
export type TraceChannel = 'user' | 'system' | 'assistant' | 'tool' | 'internal'
export type TracePayloadKind =
  | 'user-message'
  | 'system-instruction'
  | 'app-state'
  | 'provider-options'
  | 'history'
  | 'resource'
  | 'attachment'
  | 'tool-call'
  | 'tool-result'
  | 'model-response'
  | 'error'

export interface TraceParticipant {
  id: string
  kind: TraceParticipantKind
  label: string
}

export interface TracePayload {
  kind: TracePayloadKind
  content: string
  name?: string
  mediaType?: string
}

export interface TraceObservation {
  boundary: string
  fidelity: 'exact' | 'derived' | 'opaque'
  limitation?: string
}

export interface TraceEventV1 {
  schema: 'autowin.trace/v1'
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  type: TraceEventType
  status: TraceEventStatus
  actor: TraceParticipant
  injector?: TraceParticipant
  recipient?: TraceParticipant
  channel: TraceChannel
  payloads: TracePayload[]
  observation: TraceObservation
  provider?: {
    id: string
    model?: string
    reasoningEffort?: string
    transport?: string
    sessionId?: string
  }
  metrics?: {
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    costUsd?: number
  }
}

const EVENT_TYPES = new Set<TraceEventType>([
  'message',
  'injection',
  'decision',
  'tool-call',
  'tool-result',
  'model-response',
  'handoff',
  'verdict',
  'gate',
  'retry',
  'cancellation',
  'error',
  'boundary',
  'response-displayed'
])
const EVENT_STATUSES = new Set<TraceEventStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
])
const CHANNELS = new Set<TraceChannel>(['user', 'system', 'assistant', 'tool', 'internal'])
const PARTICIPANT_KINDS = new Set<TraceParticipantKind>([
  'human',
  'system',
  'agent',
  'judge',
  'tool',
  'provider',
  'skill',
  'hook',
  'resource'
])
const PAYLOAD_KINDS = new Set<TracePayloadKind>([
  'user-message',
  'system-instruction',
  'app-state',
  'provider-options',
  'history',
  'resource',
  'attachment',
  'tool-call',
  'tool-result',
  'model-response',
  'error'
])

function nonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`TraceEvent: ${field} vide`)
}

function participant(value: TraceParticipant | undefined, field: string): void {
  if (!value) throw new Error(`TraceEvent: ${field} absent`)
  nonEmpty(value.id, `${field}.id`)
  nonEmpty(value.label, `${field}.label`)
  if (!PARTICIPANT_KINDS.has(value.kind)) throw new Error(`TraceEvent: ${field}.kind invalide`)
}

export function assertTraceEvent(event: TraceEventV1): TraceEventV1 {
  if (!event || event.schema !== 'autowin.trace/v1') throw new Error('TraceEvent: schéma invalide')
  nonEmpty(event.id, 'id')
  nonEmpty(event.conversationId, 'conversationId')
  nonEmpty(event.turnId, 'turnId')
  if (event.parentId === event.id) throw new Error('TraceEvent: parent causal réflexif')
  if (!Number.isFinite(Date.parse(event.timestamp)))
    throw new Error('TraceEvent: timestamp invalide')
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0)
    throw new Error('TraceEvent: séquence invalide')
  if (!EVENT_TYPES.has(event.type)) throw new Error('TraceEvent: type invalide')
  if (!EVENT_STATUSES.has(event.status)) throw new Error('TraceEvent: statut invalide')
  if (!CHANNELS.has(event.channel)) throw new Error('TraceEvent: canal invalide')
  participant(event.actor, 'actor')
  if (event.injector) participant(event.injector, 'injector')
  if (event.recipient) participant(event.recipient, 'recipient')
  if (!Array.isArray(event.payloads) || event.payloads.length === 0)
    throw new Error('TraceEvent: payloads vides')
  for (const payload of event.payloads) {
    if (!PAYLOAD_KINDS.has(payload.kind)) throw new Error('TraceEvent: payload.kind invalide')
    if (typeof payload.content !== 'string') throw new Error('TraceEvent: payload.content invalide')
  }
  nonEmpty(event.observation?.boundary, 'observation.boundary')
  if (!['exact', 'derived', 'opaque'].includes(event.observation.fidelity))
    throw new Error('TraceEvent: fidélité invalide')
  for (const value of Object.values(event.metrics ?? {})) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error('TraceEvent: métrique invalide')
  }
  return event
}
