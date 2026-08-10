import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { BrainTrace } from '../activity/brain-trace-spool'
import { assertTraceEvent, type TraceEventV1 } from '../activity/trace-event'

export type SemanticTemporalNodeKind =
  | 'mission'
  | 'phase'
  | 'event'
  | 'decision'
  | 'outcome'
  | 'evidence'
  | 'artifact'
  | 'memory'
  | 'brain-source'

export type SemanticTemporalRelation =
  | 'contains'
  | 'caused-by'
  | 'supports'
  | 'produced'
  | 'consulted'
  | 'supersedes'
  | 'contradicts'
  | 'observed'
  | 'related'
  | 'links-to'

export interface SemanticTemporalSource {
  kind: 'trace-event' | 'brain-trace' | 'brain-note' | 'remembered-fact' | 'derived'
  id: string
  conversationId?: string
  turnId?: string
}

export interface SemanticTemporalNode {
  id: string
  kind: SemanticTemporalNodeKind
  label: string
  timestamp?: string
  source: SemanticTemporalSource
  status?: string
  phase?: string
  provider?: string
  model?: string
}

export interface SemanticTemporalEdge {
  id: string
  source: string
  target: string
  relation: SemanticTemporalRelation
}

export interface SemanticTemporalProjectionV1 {
  schema: 'autowin.semantic-temporal/v1'
  inputDigest?: string
  sourceDigest: string
  nodes: SemanticTemporalNode[]
  edges: SemanticTemporalEdge[]
}

export interface TemporalRememberRecord {
  id: string
  timestamp: string
  conversationId: string
  turnId?: string
  title: string
  state: 'local' | 'deposited' | 'unknown'
  source?: string
}

export interface SemanticTemporalProjectionInput {
  events?: readonly TraceEventV1[]
  brainTraces?: readonly BrainTrace[]
  remembered?: readonly TemporalRememberRecord[]
}

function hash(value: string, length = 24): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length)
}

export function semanticTemporalInputDigest(input: SemanticTemporalProjectionInput): string {
  const normalize = <T>(values: readonly T[], keyFor: (value: T) => string): T[] =>
    values
      .map((value) => ({ value, key: keyFor(value), serialized: JSON.stringify(value) }))
      .sort(
        (left, right) =>
          left.key.localeCompare(right.key) || left.serialized.localeCompare(right.serialized)
      )
      .map(({ value }) => value)
  const events = normalize(input.events ?? [], (value) => {
    const event = value as Partial<TraceEventV1>
    return `${String(event.conversationId ?? '')}\0${String(event.turnId ?? '')}\0${String(event.sequence ?? '')}\0${String(event.id ?? '')}`
  })
  const brainTraces = normalize(input.brainTraces ?? [], (value) => {
    const trace = value as Partial<BrainTrace>
    return `${String(trace.conversationId ?? '')}\0${String(trace.turnId ?? '')}\0${String(trace.timestamp ?? '')}`
  })
  const remembered = normalize(
    input.remembered ?? [],
    (value) => `${String(value.timestamp ?? '')}\0${String(value.id ?? '')}`
  )
  return createHash('sha256')
    .update(JSON.stringify({ events, brainTraces, remembered }), 'utf8')
    .digest('hex')
}

export function semanticTemporalProjectionDigest(
  nodes: readonly SemanticTemporalNode[],
  edges: readonly SemanticTemporalEdge[]
): string {
  return createHash('sha256').update(JSON.stringify({ nodes, edges }), 'utf8').digest('hex')
}

function nodeId(kind: SemanticTemporalNodeKind, sourceKind: string, sourceId: string): string {
  return `${kind}:${hash(`${sourceKind}\0${sourceId}`)}`
}

function eventKind(event: TraceEventV1): SemanticTemporalNodeKind {
  if (event.observation.boundary === 'Autowin orchestration outcome') return 'outcome'
  if (event.type === 'decision' || event.type === 'gate' || event.type === 'verdict')
    return 'decision'
  if (event.type === 'tool-call' || event.type === 'tool-result') return 'evidence'
  if (event.type === 'artifact') return 'artifact'
  return 'event'
}

function eventLabel(event: TraceEventV1): string {
  const provider = event.provider?.model ?? event.provider?.id
  return [event.type, event.status, provider].filter(Boolean).join(' · ')
}

function missionSourceId(
  event: Pick<TraceEventV1, 'conversationId' | 'turnId' | 'execution'>
): string {
  return event.execution?.runId ?? `turn:${event.conversationId}:${event.turnId}`
}

function explicitRelation(type: string): SemanticTemporalRelation | undefined {
  if (type === 'caused_by') return 'caused-by'
  if (type === 'links_to') return 'links-to'
  if (type === 'related' || type === 'supersedes' || type === 'contradicts') return type
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBrainTrace(value: unknown): value is BrainTrace {
  if (!isRecord(value)) return false
  if (
    typeof value.timestamp !== 'string' ||
    typeof value.conversationId !== 'string' ||
    typeof value.query !== 'string' ||
    typeof value.injectedChars !== 'number' ||
    !Number.isFinite(value.injectedChars)
  ) {
    return false
  }
  if (value.turnId !== undefined && typeof value.turnId !== 'string') return false
  if (value.navigation === undefined) return true
  if (!isRecord(value.navigation)) return false
  const candidates = value.navigation.candidates
  if (candidates === undefined) return true
  if (!Array.isArray(candidates)) return false
  return candidates.every((candidate) => {
    if (!isRecord(candidate) || typeof candidate.path !== 'string') return false
    if (candidate.relations === undefined) return true
    return (
      Array.isArray(candidate.relations) &&
      candidate.relations.every(
        (relation) =>
          isRecord(relation) &&
          typeof relation.type === 'string' &&
          typeof relation.target === 'string'
      )
    )
  })
}

function isTraceEvent(value: unknown): value is TraceEventV1 {
  try {
    assertTraceEvent(value as TraceEventV1)
    return true
  } catch {
    return false
  }
}

/**
 * Deterministic, metadata-only projection. It never parses payload prose to invent semantic links;
 * supports comes solely from the causal parent chain and Brain relations are accepted only when typed.
 */
export function buildSemanticTemporalProjection(
  input: SemanticTemporalProjectionInput,
  inputDigest = semanticTemporalInputDigest(input)
): SemanticTemporalProjectionV1 {
  const nodes = new Map<string, SemanticTemporalNode>()
  const edges = new Map<string, SemanticTemporalEdge>()

  const addNode = (node: SemanticTemporalNode): SemanticTemporalNode => {
    const existing = nodes.get(node.id)
    if (!existing) nodes.set(node.id, node)
    else if (node.timestamp && (!existing.timestamp || node.timestamp < existing.timestamp)) {
      nodes.set(node.id, { ...existing, timestamp: node.timestamp })
    }
    return nodes.get(node.id)!
  }
  const addEdge = (source: string, target: string, relation: SemanticTemporalRelation): void => {
    if (source === target) return
    const id = `edge:${hash(`${relation}\0${source}\0${target}`)}`
    edges.set(id, { id, source, target, relation })
  }
  const addMission = (
    sourceId: string,
    conversationId: string,
    turnId: string | undefined,
    timestamp?: string
  ): SemanticTemporalNode =>
    addNode({
      id: nodeId('mission', 'derived', sourceId),
      kind: 'mission',
      label: `Mission ${hash(sourceId, 8)}`,
      timestamp,
      source: { kind: 'derived', id: sourceId, conversationId, ...(turnId ? { turnId } : {}) }
    })

  const sortedEvents = [...(input.events ?? [])]
    .filter(isTraceEvent)
    .sort(
      (left, right) =>
        left.conversationId.localeCompare(right.conversationId) ||
        left.turnId.localeCompare(right.turnId) ||
        left.sequence - right.sequence ||
        left.id.localeCompare(right.id)
    )
  const eventNodes = new Map<string, SemanticTemporalNode>()
  const eventById = new Map(sortedEvents.map((event) => [event.id, event]))
  for (const event of sortedEvents) {
    const missionKey = missionSourceId(event)
    const mission = addMission(missionKey, event.conversationId, event.turnId, event.timestamp)
    let phaseNode: SemanticTemporalNode | undefined
    if (event.execution?.phase) {
      const phaseSource = `${missionKey}:${event.execution.phase}`
      phaseNode = addNode({
        id: nodeId('phase', 'derived', phaseSource),
        kind: 'phase',
        label: `Phase ${event.execution.phase}`,
        timestamp: event.timestamp,
        source: {
          kind: 'derived',
          id: phaseSource,
          conversationId: event.conversationId,
          turnId: event.turnId
        },
        phase: event.execution.phase
      })
      addEdge(mission.id, phaseNode.id, 'contains')
    }
    const kind = eventKind(event)
    const semanticEvent = addNode({
      id: nodeId(kind, 'trace-event', event.id),
      kind,
      label: eventLabel(event),
      timestamp: event.timestamp,
      source: {
        kind: 'trace-event',
        id: event.id,
        conversationId: event.conversationId,
        turnId: event.turnId
      },
      status: event.status,
      ...(event.execution?.phase ? { phase: event.execution.phase } : {}),
      ...(event.provider?.id ? { provider: event.provider.id } : {}),
      ...(event.provider?.model ? { model: event.provider.model } : {})
    })
    eventNodes.set(event.id, semanticEvent)
    addEdge(phaseNode?.id ?? mission.id, semanticEvent.id, 'contains')
    if (kind === 'artifact') addEdge(mission.id, semanticEvent.id, 'produced')
  }

  for (const event of sortedEvents) {
    const current = eventNodes.get(event.id)
    const parent = event.parentId ? eventNodes.get(event.parentId) : undefined
    if (current && parent) addEdge(current.id, parent.id, 'caused-by')
    if (current?.kind === 'outcome') {
      const visited = new Set<string>()
      let ancestorId = event.parentId
      while (ancestorId && !visited.has(ancestorId)) {
        visited.add(ancestorId)
        const ancestorNode = eventNodes.get(ancestorId)
        if (ancestorNode?.kind === 'decision') {
          addEdge(ancestorNode.id, current.id, 'observed')
          break
        }
        ancestorId = eventById.get(ancestorId)?.parentId
      }
    }
    if (!current || current.kind !== 'decision') continue
    const visited = new Set<string>()
    let ancestorId = event.parentId
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId)
      const ancestorNode = eventNodes.get(ancestorId)
      if (ancestorNode?.kind === 'evidence' || ancestorNode?.kind === 'artifact') {
        addEdge(ancestorNode.id, current.id, 'supports')
      }
      ancestorId = eventById.get(ancestorId)?.parentId
    }
  }

  const brainTraces = [...(input.brainTraces ?? [])]
    .filter(isBrainTrace)
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) ||
        left.conversationId.localeCompare(right.conversationId) ||
        left.query.localeCompare(right.query)
    )
  for (const trace of brainTraces) {
    const traceSource = `${trace.conversationId}:${trace.turnId ?? ''}:${trace.timestamp}:${trace.kind ?? 'automatic'}:${hash(trace.query)}`
    const missionKey = `turn:${trace.conversationId}:${trace.turnId ?? trace.timestamp}`
    const mission = addMission(missionKey, trace.conversationId, trace.turnId, trace.timestamp)
    const retrieval = addNode({
      id: nodeId('evidence', 'brain-trace', traceSource),
      kind: 'evidence',
      label: `Brain ${trace.kind ?? 'automatic'} · ${trace.status ?? (trace.found ? 'found' : 'unknown')}`,
      timestamp: trace.timestamp,
      source: {
        kind: 'brain-trace',
        id: traceSource,
        conversationId: trace.conversationId,
        ...(trace.turnId ? { turnId: trace.turnId } : {})
      },
      status: trace.status
    })
    addEdge(mission.id, retrieval.id, 'contains')
    for (const candidate of trace.navigation?.candidates ?? []) {
      const sourceNode = addNode({
        id: nodeId('brain-source', 'brain-note', candidate.path),
        kind: 'brain-source',
        label: basename(candidate.path),
        source: { kind: 'brain-note', id: candidate.path }
      })
      if (candidate.retained) {
        addEdge(retrieval.id, sourceNode.id, 'consulted')
        addEdge(mission.id, sourceNode.id, 'consulted')
      }
      for (const relation of candidate.relations ?? []) {
        const typed = explicitRelation(relation.type)
        if (!typed) continue
        const target = addNode({
          id: nodeId('brain-source', 'brain-note', relation.target),
          kind: 'brain-source',
          label: basename(relation.target),
          source: { kind: 'brain-note', id: relation.target }
        })
        addEdge(sourceNode.id, target.id, typed)
      }
    }
  }

  const remembered = [...(input.remembered ?? [])].sort(
    (left, right) =>
      left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
  )
  for (const fact of remembered) {
    const missionKey = `turn:${fact.conversationId}:${fact.turnId ?? fact.timestamp}`
    const mission = addMission(missionKey, fact.conversationId, fact.turnId, fact.timestamp)
    const memory = addNode({
      id: nodeId('memory', 'remembered-fact', fact.id),
      kind: 'memory',
      label: fact.title,
      timestamp: fact.timestamp,
      source: {
        kind: 'remembered-fact',
        id: fact.source ?? fact.id,
        conversationId: fact.conversationId,
        ...(fact.turnId ? { turnId: fact.turnId } : {})
      },
      status: fact.state
    })
    addEdge(mission.id, memory.id, 'produced')
  }

  const orderedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  const orderedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id))
  const sourceDigest = semanticTemporalProjectionDigest(orderedNodes, orderedEdges)
  return {
    schema: 'autowin.semantic-temporal/v1',
    inputDigest,
    sourceDigest,
    nodes: orderedNodes,
    edges: orderedEdges
  }
}

/**
 * Contexte réutilisable par un run ultérieur : uniquement les métadonnées des liens décision→issue
 * explicitement observés. Aucun payload ni prose de décision n'est relu ou inféré.
 */
export function causalLearningContext(events: readonly TraceEventV1[], limit = 5): string {
  const projection = buildSemanticTemporalProjection({ events })
  const byId = new Map(projection.nodes.map((node) => [node.id, node]))
  const observations = projection.edges
    .filter((edge) => edge.relation === 'observed')
    .flatMap((edge) => {
      const decision = byId.get(edge.source)
      const outcome = byId.get(edge.target)
      return decision?.kind === 'decision' && outcome?.kind === 'outcome'
        ? [{ decision, outcome }]
        : []
    })
    .sort((left, right) =>
      (right.outcome.timestamp ?? '').localeCompare(left.outcome.timestamp ?? '')
    )
    .slice(0, Math.max(0, limit))
  if (observations.length === 0) return ''
  return [
    'MÉMOIRE CAUSALE OBSERVÉE (métadonnées vérifiées, aucun contenu utilisateur)',
    ...observations.map(({ decision, outcome }) => {
      const route =
        [decision.provider, decision.model].filter(Boolean).join('/') || 'route inconnue'
      return `- ${decision.phase ?? outcome.phase ?? 'phase inconnue'} · ${route} · issue ${outcome.status ?? 'inconnue'}`
    })
  ].join('\n')
}
