import type {
  HarnessTimeline,
  HarnessTimelineEvent,
  HarnessTimelineTurn
} from './harness-timeline-model'

export interface RequestExecutionProjection {
  turnId?: string
  events: HarnessTimelineEvent[]
}

interface ProjectionOptions {
  requestLabel?: string
}

const TECHNICAL_PROVIDER_KINDS = new Set<HarnessTimelineEvent['kind']>([
  'injection',
  'boundary',
  'model-response'
])

const PHASE_LABELS: Record<string, string> = {
  scout: 'Scout',
  frame: 'Frame',
  terrain: 'Terrain',
  build: 'Build',
  clean: 'Clean',
  judge: 'Judge',
  kaizen: 'Kaizen'
}

function compactLabel(value: string | undefined): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return 'Demande utilisateur'
  return normalized.length > 96 ? `${normalized.slice(0, 93)}…` : normalized
}

function requestRoot(turn: HarnessTimelineTurn, requestLabel?: string): HarnessTimelineEvent {
  return {
    id: `request:${turn.id}`,
    kind: 'message',
    actor: 'Utilisateur',
    label: compactLabel(requestLabel),
    content: '',
    detail: `Demande ${turn.id}`,
    timestamp: turn.ts,
    status: turn.events.some((event) => event.status === 'running') ? 'running' : 'completed',
    durationMs: 0,
    payloads: [],
    display: {
      kind: 'request',
      title: 'Demande utilisateur',
      observedEventIds: []
    }
  }
}

function phaseRoot(
  turn: HarnessTimelineTurn,
  phase: string,
  parentId: string,
  timestamp: string | undefined
): HarnessTimelineEvent {
  return {
    id: `request:${turn.id}:phase:${phase}`,
    parentId,
    kind: 'decision',
    actor: 'Autowin OS',
    label: PHASE_LABELS[phase] ?? phase,
    content: '',
    detail: `Phase ${phase} observée dans la trace`,
    timestamp,
    status: 'completed',
    durationMs: 0,
    payloads: [],
    execution: { phase },
    display: {
      kind: 'phase',
      title: `skill · ${phase}`,
      observedEventIds: [],
      workflow: 'autowin',
      skillName: phase
    }
  }
}

function nearestProjectedParent(
  parentId: string | undefined,
  sourceById: Map<string, HarnessTimelineEvent>,
  projectedIds: Set<string>,
  fallback: string
): string {
  const visited = new Set<string>()
  let currentId = parentId
  while (currentId && !visited.has(currentId)) {
    if (projectedIds.has(currentId)) return currentId
    visited.add(currentId)
    currentId = sourceById.get(currentId)?.parentId
  }
  return fallback
}

function technicalDescendants(
  event: HarnessTimelineEvent,
  childrenByParent: Map<string, HarnessTimelineEvent[]>
): HarnessTimelineEvent[] {
  const collected: HarnessTimelineEvent[] = []
  const queue = [...(childrenByParent.get(event.id) ?? [])]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || collected.some((item) => item.id === current.id)) continue
    if (current.kind === 'message' || TECHNICAL_PROVIDER_KINDS.has(current.kind)) {
      collected.push(current)
      queue.push(...(childrenByParent.get(current.id) ?? []))
    }
  }
  return collected
}

function directProviderEvents(turn: HarnessTimelineTurn): HarnessTimelineEvent[] {
  return turn.events.filter((event) => event.kind === 'message' && Boolean(event.provider))
}

function agentTitle(event: HarnessTimelineEvent): string {
  const rawActorKind = (event.raw as { actor?: { kind?: string } } | undefined)?.actor?.kind
  if (rawActorKind === 'system') {
    return event.execution?.agentId === 'judge:quorum' ? 'Agrégation locale' : event.actor
  }
  if (event.kind === 'verdict') return 'Juge'
  if (event.kind === 'gate') return 'Décision de clôture'
  const role = event.actor.toLowerCase() === 'subagent' ? 'Sous-agent' : event.actor
  const agentId = event.execution?.agentId
  return agentId && agentId.toLowerCase() !== event.actor.toLowerCase()
    ? `${role} · ${agentId}`
    : role
}

export function projectLatestRequestExecution(
  timeline: HarnessTimeline,
  options: ProjectionOptions = {}
): RequestExecutionProjection {
  const turn = timeline.turns[0]
  if (!turn) return { events: [] }

  const root = requestRoot(turn, options.requestLabel)
  const sourceById = new Map(turn.events.map((event) => [event.id, event]))
  const childrenByParent = new Map<string, HarnessTimelineEvent[]>()
  for (const event of turn.events) {
    if (!event.parentId) continue
    childrenByParent.set(event.parentId, [...(childrenByParent.get(event.parentId) ?? []), event])
  }

  const structural = turn.events.filter((event) =>
    ['handoff', 'verdict', 'gate'].includes(event.kind)
  )
  const agentSources = structural.length > 0 ? structural : directProviderEvents(turn)
  const agentSourceIds = new Set(agentSources.map((event) => event.id))
  const keptAuxiliary = turn.events.filter(
    (event) =>
      !agentSourceIds.has(event.id) &&
      ['tool-call', 'tool-result', 'retry', 'cancellation', 'error', 'response-displayed'].includes(
        event.kind
      )
  )

  const phases: string[] = []
  for (const event of agentSources) {
    const phase = event.execution?.phase
    if (phase && !phases.includes(phase)) phases.push(phase)
  }

  const phaseEvents: HarnessTimelineEvent[] = []
  for (const phase of phases) {
    const first = agentSources.find((event) => event.execution?.phase === phase)
    const phaseEvent = phaseRoot(turn, phase, root.id, first?.timestamp)
    phaseEvents.push(phaseEvent)
  }
  const phaseId = new Map(phaseEvents.map((event) => [event.execution?.phase ?? '', event.id]))

  const projectedAgents = agentSources.map<HarnessTimelineEvent>((event) => {
    const grouped = structural.length > 0 ? technicalDescendants(event, childrenByParent) : []
    const terminal = [...grouped]
      .reverse()
      .find((candidate) => candidate.kind === 'model-response' || candidate.kind === 'error')
    const rawActorKind = (event.raw as { actor?: { kind?: string } } | undefined)?.actor?.kind
    return {
      ...event,
      provider: terminal?.provider ?? event.provider,
      model: terminal?.model ?? event.model,
      status: terminal?.status ?? event.status,
      durationMs: terminal?.durationMs ?? event.durationMs,
      payloads: [],
      display: {
        kind: event.kind === 'gate' || rawActorKind === 'system' ? 'event' : 'agent',
        title: agentTitle(event),
        observedEventIds: [event.id, ...grouped.map((candidate) => candidate.id)],
        dependencyIds: [...(event.execution?.dependencyIds ?? [])],
        workflow: structural.length > 0 ? 'autowin' : 'direct',
        skillName: event.execution?.phase,
        limitation:
          structural.length === 0
            ? 'Chat direct : le pipeline Autowin n’a pas été déclenché.'
            : event.execution?.phase
              ? undefined
              : 'Trace historique : phase Autowin non exposée.'
      }
    }
  })

  const projectedIds = new Set([
    root.id,
    ...phaseEvents.map((event) => event.id),
    ...projectedAgents.map((event) => event.id),
    ...keptAuxiliary.map((event) => event.id)
  ])
  const agentByTaskId = new Map(
    projectedAgents
      .filter((event) => event.execution?.taskId)
      .map((event) => [event.execution?.taskId ?? '', event.id])
  )

  const normalizedAgents = projectedAgents.map((event) => {
    const dependencies = event.execution?.dependencyIds ?? []
    const dependencyParent =
      dependencies.length === 1 ? agentByTaskId.get(dependencies[0]) : undefined
    const observedParent = event.parentId
      ? nearestProjectedParent(event.parentId, sourceById, projectedIds, '')
      : undefined
    const fallback = phaseId.get(event.execution?.phase ?? '') ?? root.id
    return {
      ...event,
      parentId:
        observedParent ||
        dependencyParent ||
        (event.execution?.phase
          ? fallback
          : nearestProjectedParent(event.parentId, sourceById, projectedIds, root.id))
    }
  })

  const workflowContextById = new Map(
    [...phaseEvents, ...normalizedAgents]
      .filter((event) => event.display?.workflow)
      .map((event) => [
        event.id,
        {
          workflow: event.display?.workflow,
          skillName: event.display?.skillName
        }
      ])
  )
  const normalizedAuxiliary = keptAuxiliary.map<HarnessTimelineEvent>((event) => {
    const parentId = nearestProjectedParent(event.parentId, sourceById, projectedIds, root.id)
    const parentContext = workflowContextById.get(parentId)
    const phase = event.execution?.phase
    const workflow =
      parentContext?.workflow ?? (phase || structural.length > 0 ? 'autowin' : 'direct')
    const skillName = phase ?? parentContext?.skillName
    const normalized: HarnessTimelineEvent = {
      ...event,
      parentId,
      payloads: [],
      display: {
        kind: event.kind.startsWith('tool-') ? 'tool' : 'event',
        title:
          event.kind === 'tool-call' ? 'Outil' : event.kind === 'tool-result' ? 'Résultat' : 'Étape',
        observedEventIds: [event.id],
        workflow,
        skillName
      }
    }
    workflowContextById.set(event.id, { workflow, skillName })
    return normalized
  })

  const events = [root, ...phaseEvents, ...normalizedAgents, ...normalizedAuxiliary]
  events.sort((a, b) => {
    if (a.id === root.id) return -1
    if (b.id === root.id) return 1
    return (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
  })
  return { turnId: turn.id, events }
}
