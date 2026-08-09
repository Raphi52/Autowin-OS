function legacyAuthorityDecision(input: {
  mode: 'plan' | 'ask' | 'auto'
  mutates: boolean
  authority: 'automatic' | 'sensitive' | 'destructive'
}): 'allow' | 'confirm' | 'deny' {
  if (!input.mutates) return 'allow'
  if (input.mode === 'plan') return 'deny'
  if (input.authority === 'destructive') return 'confirm'
  if (input.mode === 'ask' && input.authority === 'sensitive') return 'confirm'
  return 'allow'
}

export type TraceEventType =
  | 'message'
  | 'injection'
  | 'decision'
  | 'tool-call'
  | 'tool-result'
  | 'model-response'
  /**
   * Un livrable produit par le modele (fichier, image, document) — une SORTIE, pas le retour d'un
   * outil. Ajoute le 2026-08-07 : les artefacts etaient persistes dans le tour de chat mais
   * n'apparaissaient dans AUCUN evenement causal, si bien qu'Observatory omettait purement et
   * simplement un livrable tout en pretendant montrer ce que le tour avait produit. Type distinct de
   * `tool-result` a dessein : les confondre faussait le comptage des appels d'outils.
   */
  | 'artifact'
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
  /**
   * Raisonnement : la reflexion du modele, ou le `thinking` d'un sous-agent. Distinct de
   * `model-response` (la reponse REMISE) : confondre les deux ferait passer une deliberation pour
   * une conclusion.
   */
  | 'reasoning'
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

export interface TraceExecutionContext {
  phase?: string
  agentId?: string
  taskId?: string
  groupId?: string
  dependencyIds?: string[]
  runId?: string
  attemptId?: string
}

/** Schéma historique en lecture seule pour afficher les reçus produits avant la politique unique. */
export interface TraceAuthorityReceipt {
  mode: 'plan' | 'ask' | 'auto'
  commandAuthority: 'automatic' | 'sensitive' | 'destructive'
  mutates: boolean
  decision: 'allow' | 'confirm' | 'deny'
  decisionId?: string
  resolution?: 'approve' | 'cancel'
  resolvedBy?: 'user' | 'timeout-default'
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
  execution?: TraceExecutionContext
  authority?: TraceAuthorityReceipt
  run?: RunLifecycleEvent
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
  'artifact',
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
  'reasoning',
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
  if (event.run) {
    nonEmpty(event.run.runId, 'run.runId')
    if (!Number.isFinite(event.run.timestampMs) || event.run.timestampMs < 0)
      throw new Error('TraceEvent: run.timestampMs invalide')
    if (!['quote', 'workspace', 'git', 'closure'].includes(event.run.stage))
      throw new Error('TraceEvent: run.stage invalide')
  }
  if (event.authority) {
    if (
      event.type !== 'decision' ||
      event.actor.id !== 'autowin-authority' ||
      event.actor.kind !== 'system' ||
      event.channel !== 'internal' ||
      event.observation.boundary !== 'app-command-bus' ||
      event.observation.fidelity !== 'exact'
    )
      throw new Error('TraceEvent: authority envelope invalide')
    if (!['plan', 'ask', 'auto'].includes(event.authority.mode))
      throw new Error('TraceEvent: authority.mode invalide')
    if (!['automatic', 'sensitive', 'destructive'].includes(event.authority.commandAuthority))
      throw new Error('TraceEvent: authority.commandAuthority invalide')
    if (typeof event.authority.mutates !== 'boolean')
      throw new Error('TraceEvent: authority.mutates invalide')
    if (!['allow', 'confirm', 'deny'].includes(event.authority.decision))
      throw new Error('TraceEvent: authority.decision invalide')
    if (
      event.authority.decision !==
      legacyAuthorityDecision({
        mode: event.authority.mode,
        mutates: event.authority.mutates,
        authority: event.authority.commandAuthority
      })
    )
      throw new Error('TraceEvent: authority.decision contraire a la politique')
    if (event.authority.decisionId !== undefined)
      nonEmpty(event.authority.decisionId, 'authority.decisionId')
    if (
      event.authority.resolution !== undefined &&
      !['approve', 'cancel'].includes(event.authority.resolution)
    )
      throw new Error('TraceEvent: authority.resolution invalide')
    if (
      event.authority.resolvedBy !== undefined &&
      !['user', 'timeout-default'].includes(event.authority.resolvedBy)
    )
      throw new Error('TraceEvent: authority.resolvedBy invalide')
    const hasResolution = event.authority.resolution !== undefined
    const hasResolver = event.authority.resolvedBy !== undefined
    if (hasResolution !== hasResolver)
      throw new Error('TraceEvent: authority resolution incomplete')
    if (event.authority.decision === 'confirm') {
      if (!event.authority.decisionId)
        throw new Error('TraceEvent: authority.decisionId requis pour confirm')
      if (!hasResolution && event.status !== 'pending')
        throw new Error('TraceEvent: authority confirm non resolu doit rester pending')
      if (event.authority.resolution === 'cancel' && event.status !== 'cancelled')
        throw new Error('TraceEvent: authority cancel doit etre cancelled')
      if (
        event.authority.resolution === 'approve' &&
        !['completed', 'failed'].includes(event.status)
      )
        throw new Error('TraceEvent: authority approve doit etre terminal')
    } else {
      if (event.authority.decisionId || hasResolution || hasResolver)
        throw new Error('TraceEvent: authority resolution interdite hors confirm')
      if (event.authority.decision === 'deny' && event.status !== 'failed')
        throw new Error('TraceEvent: authority deny doit etre failed')
      if (event.authority.decision === 'allow' && !['completed', 'failed'].includes(event.status))
        throw new Error('TraceEvent: authority allow doit etre terminal')
    }
  }
  return event
}
import type { RunLifecycleEvent } from '../../shared/run-execution'

/**
 * Identifiant d'un évènement d'ACTION du pilote dans la trace causale.
 *
 * POURQUOI CETTE FONCTION EXISTE. L'identifiant était construit en ligne comme
 * `${turnId}:action:${compteur}:${kind}`, où le compteur était REMIS À ZÉRO à chaque `prompt-call`.
 * Or `retry`, `error` et `cancellation` n'ont pas d'`actionId` : ils retombaient sur ce compteur. Un tour
 * portant deux `retry` séparés par un `prompt-call` produisait donc DEUX FOIS `…:action:0:retry`, et
 * `TraceStore.append` refusait le doublon en jetant — ce qui faisait échouer le tour entier.
 *
 * Mesuré sur les incidents réels du 2026-08-05 : après avoir fermé les cascades d'abandon, de quota et de
 * remédiation, `événement dupliqué: <uuid>:action:0:retry` était le SEUL incident restant, et la seule
 * cause légitime encore capable de déclencher un auto-kaizen.
 *
 * Le correctif : quand l'évènement n'a pas d'`actionId` propre, on utilise un ordinal MONOTONE du tour,
 * jamais remis à zéro. L'unicité est alors garantie par construction, plus par la chance d'un compteur.
 * Le préfixe d'itération est conservé pour que l'identifiant reste lisible dans un journal.
 */
export function traceActionEventId(input: {
  turnId: string
  kind: string
  /** Identifiant d'action FOURNI par l'évènement (`command`/`result`). Déjà unique quand il existe. */
  actionId?: string
  /** Itération du pilote, à titre indicatif dans l'identifiant. */
  iteration?: number
  /** Ordinal MONOTONE du tour : c'est lui qui porte l'unicité, et il ne doit jamais être réinitialisé. */
  ordinal: number
}): string {
  const stable = input.actionId?.replaceAll(':', '-') ?? `${input.iteration ?? 0}-${input.ordinal}`
  return `${input.turnId}:action:${stable}:${input.kind}`
}
