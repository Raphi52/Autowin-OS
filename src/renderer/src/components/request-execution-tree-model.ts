import type {
  HarnessTimeline,
  HarnessTimelineEvent,
  HarnessTimelineTurn
} from './harness-timeline-model'
import { extractHumanMessage } from './human-message'

/** Un tour atteignable depuis le graphe : de quoi peupler un sélecteur sans relire la trace. */
export interface RequestTurnOption {
  id: string
  ts: string
  label: string
}

export interface RequestExecutionProjection {
  turnId?: string
  runIds?: string[]
  events: HarnessTimelineEvent[]
  /**
   * Tours sélectionnables, du plus récent au plus ancien. Absent quand la projection ne dépend pas
   * d'un tour (faits de run : le graphe montre alors déjà TOUS les runs de la conversation).
   */
  turns?: RequestTurnOption[]
}

interface ProjectionOptions {
  requestLabel?: string
  /** Tour à projeter. Inconnu ou absent → le plus récent, jamais du vide. */
  turnId?: string
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

function eventOrder(a: HarnessTimelineEvent, b: HarnessTimelineEvent): number {
  const byTime = (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
  if (byTime !== 0) return byTime
  const aSequence = (a.raw as { sequence?: number } | undefined)?.sequence ?? 0
  const bSequence = (b.raw as { sequence?: number } | undefined)?.sequence ?? 0
  return aSequence - bSequence
}

function workspaceId(path: string): string {
  return `workspace:base:${encodeURIComponent(path.toLowerCase())}`
}

function executionStatus(events: HarnessTimelineEvent[]): string {
  const latestByAttempt = new Map<string, HarnessTimelineEvent>()
  for (const event of [...events].sort(eventOrder)) {
    latestByAttempt.set(event.execution?.attemptId ?? event.id, event)
  }
  const latest = [...latestByAttempt.values()]
  if (latest.some((event) => event.status === 'running')) return 'running'
  if (latest.some((event) => event.status === 'completed')) return 'completed'
  if (latest.some((event) => event.status === 'failed')) return 'failed'
  return latest.at(-1)?.status ?? 'pending'
}

/**
 * Projection conversationnelle des nouveaux faits de run. Les anciennes traces sans lifecycle
 * continuent de passer dans le projecteur historique situé sous cette fonction.
 */
function projectRunExecutions(timeline: HarnessTimeline): RequestExecutionProjection | undefined {
  const allEvents = timeline.turns.flatMap((turn) => turn.events).sort(eventOrder)
  const workspaceFacts = allEvents.filter((event) => event.run?.stage === 'workspace')
  if (workspaceFacts.length === 0) return undefined

  const runIds = [
    ...new Set(workspaceFacts.map((event) => event.run?.runId).filter(Boolean))
  ] as string[]
  const events: HarnessTimelineEvent[] = []
  const baseRoots = new Map<string, HarnessTimelineEvent>()
  const terminalClosureByRun = new Map<string, HarnessTimelineEvent>()

  for (const runId of runIds) {
    const closureFacts = allEvents
      .filter((event) => event.run?.runId === runId && event.run.stage === 'closure')
      .sort(eventOrder)
    const terminal = [...closureFacts]
      .reverse()
      .find((event) => event.run?.stage === 'closure' && event.run.closure.status !== 'open')
    if (terminal) terminalClosureByRun.set(runId, terminal)
  }

  for (const fact of workspaceFacts) {
    if (fact.run?.stage !== 'workspace') continue
    const workspace = fact.run.workspace
    if (baseRoots.has(workspace.repositoryPath)) continue
    const relatedRunIds = runIds.filter((runId) =>
      workspaceFacts.some(
        (candidate) =>
          candidate.run?.runId === runId &&
          candidate.run.stage === 'workspace' &&
          candidate.run.workspace.repositoryPath === workspace.repositoryPath
      )
    )
    const running = relatedRunIds.some((runId) => !terminalClosureByRun.has(runId))
    const root: HarnessTimelineEvent = {
      id: workspaceId(workspace.repositoryPath),
      kind: 'boundary',
      actor: 'Autowin OS',
      label: workspace.repositoryPath,
      content: '',
      detail: `Dépôt commun · ${workspace.repositoryPath}`,
      timestamp: fact.timestamp,
      status: running ? 'running' : 'completed',
      durationMs: 0,
      payloads: [],
      display: {
        kind: 'workspace',
        title: 'Dépôt de travail',
        observedEventIds: relatedRunIds.flatMap((runId) =>
          workspaceFacts
            .filter((candidate) => candidate.run?.runId === runId)
            .map((candidate) => candidate.id)
        ),
        workspace: {
          mode: 'base',
          repositoryPath: workspace.repositoryPath,
          path: workspace.repositoryPath,
          root: true
        }
      }
    }
    baseRoots.set(workspace.repositoryPath, root)
    events.push(root)
  }

  for (const runId of runIds) {
    const runEvents = allEvents
      .filter((event) => event.run?.runId === runId || event.execution?.runId === runId)
      .sort(eventOrder)
    const workspaceFact = runEvents.find((event) => event.run?.stage === 'workspace')
    if (workspaceFact?.run?.stage !== 'workspace') continue
    const workspace = workspaceFact.run.workspace
    const baseRoot = baseRoots.get(workspace.repositoryPath)
    if (!baseRoot) continue

    let runWorkspaceId = baseRoot.id
    if (workspace.mode === 'worktree') {
      const isolated: HarnessTimelineEvent = {
        id: `workspace:run:${runId}`,
        parentId: baseRoot.id,
        kind: 'boundary',
        actor: 'Autowin OS',
        label: workspace.path,
        content: '',
        detail: `Copie isolée du run ${runId}`,
        timestamp: workspaceFact.timestamp,
        status: terminalClosureByRun.has(runId) ? 'completed' : 'running',
        durationMs: 0,
        payloads: [],
        execution: { runId },
        display: {
          kind: 'workspace',
          title: 'Workspace isolé',
          runId,
          observedEventIds: [workspaceFact.id],
          workspace
        }
      }
      events.push(isolated)
      runWorkspaceId = isolated.id
    }

    const quoteFact = runEvents.find((event) => event.run?.stage === 'quote')
    let quoteNode: HarnessTimelineEvent | undefined
    if (quoteFact?.run?.stage === 'quote') {
      const quote = quoteFact.run.quote
      quoteNode = {
        id: `quote:${runId}`,
        parentId: runWorkspaceId,
        kind: 'decision',
        actor: 'Autowin OS',
        label: quote.regime,
        content: '',
        detail: `Plan d’exécution compilé avant le premier appel provider`,
        timestamp: quoteFact.timestamp,
        status: 'completed',
        durationMs: 0,
        payloads: [],
        execution: { runId },
        display: {
          kind: 'quote',
          title: 'Plan d’exécution',
          runId,
          quote,
          observedEventIds: [quoteFact.id]
        }
      }
      events.push(quoteNode)
    }
    const workflowRootId = quoteNode?.id ?? runWorkspaceId

    const structural = runEvents.filter(
      (event) =>
        (event.kind === 'handoff' || event.kind === 'verdict') && Boolean(event.execution?.agentId)
    )
    const childrenByParent = new Map<string, HarnessTimelineEvent[]>()
    for (const event of runEvents) {
      if (!event.parentId) continue
      childrenByParent.set(event.parentId, [...(childrenByParent.get(event.parentId) ?? []), event])
    }
    const attempts = new Map<string, HarnessTimelineEvent[]>()
    for (const event of structural) {
      const key = event.execution?.attemptId ?? event.id
      attempts.set(key, [...(attempts.get(key) ?? []), event])
    }
    const phases = [
      ...new Set(
        [...attempts.values()].map((attempt) => attempt.at(-1)?.execution?.phase).filter(Boolean)
      )
    ] as string[]
    const skillByPhase = new Map<string, HarnessTimelineEvent>()
    for (const phase of phases) {
      const phaseAttempts = [...attempts.values()]
        .flat()
        .filter((event) => event.execution?.phase === phase)
      const skill: HarnessTimelineEvent = {
        id: `skill:${runId}:${phase}`,
        parentId: workflowRootId,
        kind: 'decision',
        actor: 'Autowin OS',
        label: phase,
        content: '',
        detail: `Phase ${phase} utilisée comme alias de skill ; le nom réel du kit n'est pas transporté.`,
        timestamp: phaseAttempts[0]?.timestamp,
        status: executionStatus(phaseAttempts),
        durationMs: 0,
        payloads: [],
        execution: { phase, runId },
        display: {
          kind: 'skill',
          title: `skill · ${phase}`,
          runId,
          skillName: phase,
          skillIdentity: 'phase-alias',
          workflow: 'autowin',
          limitation: 'Le runtime transporte la phase, pas le nom réel de la skill du kit.',
          observedEventIds: phaseAttempts.map((event) => event.id)
        }
      }
      skillByPhase.set(phase, skill)
      events.push(skill)
    }

    const projectedAgents: HarnessTimelineEvent[] = []
    for (const [attemptId, attemptEvents] of attempts) {
      const ordered = [...attemptEvents].sort(eventOrder)
      const latest = ordered.at(-1)
      if (!latest) continue
      const grouped = ordered.flatMap((event) => technicalDescendants(event, childrenByParent))
      const terminal = [...grouped]
        .reverse()
        .find((candidate) => candidate.kind === 'model-response' || candidate.kind === 'error')
      const phase = latest.execution?.phase
      const agent: HarnessTimelineEvent = {
        ...latest,
        id: `agent:${runId}:${attemptId}`,
        parentId: skillByPhase.get(phase ?? '')?.id ?? runWorkspaceId,
        provider: terminal?.provider ?? latest.provider,
        model: terminal?.model ?? latest.model,
        status: terminal?.status ?? latest.status,
        durationMs: terminal?.durationMs ?? latest.durationMs,
        costUsd: terminal?.costUsd ?? latest.costUsd,
        payloads: [],
        execution: { ...latest.execution, runId, attemptId },
        display: {
          kind: 'agent',
          title: agentTitle(latest),
          runId,
          attemptId,
          observedEventIds: [
            ...new Set([...ordered.map((event) => event.id), ...grouped.map((event) => event.id)])
          ],
          dependencyIds: [...(latest.execution?.dependencyIds ?? [])],
          workflow: 'autowin',
          skillName: phase
        }
      }
      projectedAgents.push(agent)
      events.push(agent)
    }

    const gitFact = [...runEvents].reverse().find((event) => event.run?.stage === 'git')
    let gitNode: HarnessTimelineEvent | undefined
    if (gitFact?.run?.stage === 'git' && workspace.mode === 'worktree') {
      const completedAgents = projectedAgents.filter((event) => event.status === 'completed')
      const fallbackSkill = [...skillByPhase.values()].at(-1)
      const parentId =
        completedAgents.length === 1 ? completedAgents[0].id : (fallbackSkill?.id ?? runWorkspaceId)
      const git = gitFact.run.git
      gitNode = {
        id: `git:${runId}`,
        parentId,
        kind: 'boundary',
        actor: 'Git',
        label: git.outcome,
        content: '',
        detail: git.detail ?? `Finalisation Git du run ${runId}`,
        timestamp: gitFact.timestamp,
        status: git.outcome === 'conflict' || git.outcome === 'blocked' ? 'failed' : 'completed',
        durationMs: 0,
        payloads: [],
        execution: { runId },
        display: {
          kind: 'git',
          title: 'Git du run',
          runId,
          git,
          observedEventIds: [gitFact.id],
          dependencyIds: completedAgents.map((event) => event.id)
        }
      }
      events.push(gitNode)
    }

    const closureFacts = runEvents.filter((event) => event.run?.stage === 'closure')
    const closureFact =
      [...closureFacts]
        .reverse()
        .find((event) => event.run?.stage === 'closure' && event.run.closure.status !== 'open') ??
      closureFacts.at(-1)
    const closure =
      closureFact?.run?.stage === 'closure'
        ? closureFact.run.closure
        : { status: 'open' as const, totalDurationMs: 0, totalCostUsd: 0 }
    const fallbackSkill = [...skillByPhase.values()].at(-1)
    const closureParent =
      gitNode?.id ??
      (projectedAgents.length === 1 ? projectedAgents[0].id : (fallbackSkill?.id ?? runWorkspaceId))
    events.push({
      id: `closure:${runId}`,
      parentId: closureParent,
      kind: 'gate',
      actor: 'Autowin OS',
      label: closure.status,
      content: '',
      detail: `Clôture du run ${runId}`,
      timestamp: closureFact?.timestamp ?? workspaceFact.timestamp,
      // UN RUN NON CLOS EST « EN ATTENTE », PAS « EN COURS ».
      //
      // `open` est l'état NORMAL d'un run en vol : sa clôture n'a pas commencé. La rendre `running`
      // affichait « Clôture du run — en cours » avec `0 ms · 0 $`, soit une ABSENCE présentée comme une
      // activité. Sur un graphe où tout autre « en cours » signifie un travail qui avance, ce nœud
      // signifiait l'inverse : le 2026-08-06 il a fait croire à une session arrêtée alors que les
      // phases tournaient. `pending` est déjà traduit « en attente » par `statusLabel`.
      status:
        closure.status === 'open' ? 'pending' : closure.status === 'red' ? 'failed' : 'completed',
      durationMs: closure.totalDurationMs,
      costUsd: closure.totalCostUsd,
      payloads: [],
      execution: { runId },
      display: {
        kind: 'closure',
        title: 'Clôture du run',
        runId,
        closure,
        observedEventIds: closureFacts.map((event) => event.id)
      }
    })
  }

  return {
    turnId: timeline.turns[0]?.id,
    runIds,
    events
  }
}

/**
 * Libellé d'un tour pour le sélecteur : la DEMANDE humaine, pas le contexte injecté.
 *
 * Le contenu d'un tour est composé (`ÉTAT DE L'APP:\n{json}\n\nUTILISATEUR: …`) : lu brut, chaque
 * option porterait le même JSON illisible. On réutilise l'extracteur déjà éprouvé ailleurs.
 */
function turnOption(turn: HarnessTimelineTurn): RequestTurnOption {
  const request = turn.events.find((event) => event.kind === 'message')
  const brut = request?.content ?? ''
  // Le contenu d'un message de trace est la CONCATÉNATION de charges quelconques : l'afficher tel
  // quel ferait fuiter dans le sélecteur des contenus que le graphe s'interdit de montrer. Seul un
  // marqueur `UTILISATEUR:` identifie sans ambiguïté une demande humaine ; sinon on DATE le tour.
  const humain = /(^|\n)\s*UTILISATEUR\s*:/.test(brut) ? extractHumanMessage(brut, 80) : ''
  return { id: turn.id, ts: turn.ts, label: humain || turnDateLabel(turn.ts) }
}

/** Repli honnête quand la demande n'est pas identifiable : la date du tour, jamais son contenu. */
function turnDateLabel(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return 'demande sans libellé'
  return `demande du ${new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)}`
}

export function projectLatestRequestExecution(
  timeline: HarnessTimeline,
  options: ProjectionOptions = {}
): RequestExecutionProjection {
  const runProjection = projectRunExecutions(timeline)
  if (runProjection) return runProjection
  // `timeline.turns` est déjà trié du plus récent au plus ancien par `buildHarnessTimelineFromTrace`.
  const turns = timeline.turns.map(turnOption)
  const turn =
    (options.turnId ? timeline.turns.find((item) => item.id === options.turnId) : undefined) ??
    timeline.turns[0]
  if (!turn) return { events: [], turns }

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
      ([
        'tool-call',
        'tool-result',
        'retry',
        'cancellation',
        'error',
        'response-displayed'
      ].includes(event.kind) ||
        (event.kind === 'boundary' &&
          (event.raw as { actor?: { id?: string } } | undefined)?.actor?.id ===
            'execution-supervisor'))
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
    const absorbed = technicalDescendants(event, childrenByParent)
    const grouped = structural.length > 0 ? absorbed : []
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
      // LA DÉLIBÉRATION DU SOUS-AGENT SURVIT À L'ABSORPTION.
      //
      // Le nœud agent absorbe ses événements techniques (message, injection, model-response) ;
      // `payloads: []` jetait TOUT leur contenu — dont la charge `reasoning` écrite par
      // `stepPayloads`. La descente « jusqu'à la pensée » se coupait donc exactement ici, alors
      // que la donnée était présente. Seul `reasoning` remonte : les contenus d'outils et les
      // réponses brutes restent hors du graphe, comme avant.
      payloads: [...(event.payloads ?? []), ...absorbed.flatMap((c) => c.payloads ?? [])].filter(
        (payload) => payload.kind === 'reasoning'
      ),
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
          event.kind === 'tool-call'
            ? 'Outil'
            : event.kind === 'tool-result'
              ? 'Résultat'
              : 'Étape',
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
  return { turnId: turn.id, events, turns }
}
