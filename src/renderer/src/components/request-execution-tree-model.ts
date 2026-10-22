import type {
  HarnessTimeline,
  HarnessTimelineEvent,
  HarnessTimelineTurn
} from './harness-timeline-model'
import { FRONTIERE_DEMANDE_RECUE } from '../../../shared/trace-tour-chat'
import { buildAgentGantt } from './observatory-agent-gantt'
import { roleLabel, stepTitle, toolNameOf, toolTitle } from './execution-step-titles'
import { extractHumanMessage } from './human-message'
import { causeNommee, raisonDeLaCloture, raisonDuGit } from './raison-d-echec'
import { estArretParStop } from '../../../shared/arret-par-stop'

/** Charges qu'un nœud d'étape garde pour son détail : pensée, prompt envoyé, retour. */
export const NODE_PAYLOAD_KINDS = new Set([
  'reasoning',
  'user-message',
  'system-instruction',
  'model-response',
  'error'
])

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
   * Tours sélectionnables, du plus récent au plus ancien — TOUJOURS rendus, run ou pas : une
   * conversation qui contient un run garde son sélecteur (voir `projectRunExecutions`).
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

// Les étapes des workflows livrés (`workflow-defaults.ts`) en plus des historiques (conv-1094,
// 2026-10-22 : learn dans 13 traces causales, think dans 12, salvage dans 8). C'est le nom que le
// graphe AFFICHE pour une étape, via `display.title` (voir `nomDEtape`).
const PHASE_LABELS: Record<string, string> = {
  scout: 'Scout',
  frame: 'Frame',
  terrain: 'Terrain',
  think: 'Think',
  build: 'Build',
  clean: 'Clean',
  judge: 'Judge',
  kaizen: 'Kaizen',
  learn: 'Learn',
  salvage: 'Salvage',
  remake: 'Remake',
  gel: 'Gel',
  residus: 'Résidus',
  steal: 'Steal'
}

/**
 * LE TITRE VISIBLE D'UNE ÉTAPE (conv-1094, 2026-10-22). Le graphe écrit `display.title` : il valait
 * « skill · learn », l'identifiant brut, et la table ci-dessus n'était lue par aucun affichage
 * d'étape. L'identifiant reste dans `skillName` (attribut du nœud, ligne « phase · learn » du
 * détail) ; une étape inconnue de la table garde son identifiant plutôt que d'être masquée.
 */
function nomDEtape(phase: string): string {
  return PHASE_LABELS[phase] ?? phase
}

function observationBoundary(event: HarnessTimelineEvent): string | undefined {
  return (event.raw as { observation?: { boundary?: string } } | undefined)?.observation?.boundary
}

/**
 * Le tour a commencé (demande reçue, écrite dès l'envoi) mais rien ne l'a encore clos : ni bilan du
 * superviseur, ni réponse affichée, ni annulation. C'est « en cours » — sans `running` persisté sur
 * le disque, qu'un arrêt brutal aurait laissé orphelin. Hors exécution vivante, l'écran le requalifie
 * en « interrompu » (`settleStrandedExecutionStatus`).
 */
function turnStartedNotClosed(turn: HarnessTimelineTurn): boolean {
  if (!turn.events.some((event) => observationBoundary(event) === FRONTIERE_DEMANDE_RECUE))
    return false
  return !turn.events.some(
    (event) =>
      event.kind === 'response-displayed' ||
      event.kind === 'cancellation' ||
      (event.kind === 'boundary' && rawActorId(event) === 'execution-supervisor')
  )
}

function compactLabel(value: string | undefined): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 96 ? `${normalized.slice(0, 93)}…` : normalized
}

/**
 * Racine d'une demande. Son TITRE la date (« Demande du 12/10/2026 10:38 ») au lieu du passe-partout
 * « Demande utilisateur » commun à toutes ; sa CITATION est le texte de CETTE demande, lu dans sa
 * trace. Le libellé fourni par l'écran (dernier message du fil) ne vaut que pour le tour le plus
 * récent : appliqué à un tour plus ancien choisi dans le sélecteur, il citait une autre demande.
 */
function requestRoot(
  turn: HarnessTimelineTurn,
  requestLabel: string | undefined,
  isLatest: boolean
): HarnessTimelineEvent {
  const ownText = humanRequestText(turn, 96)
  const dated = turnDateLabel(turn.ts)
  return {
    id: `request:${turn.id}`,
    kind: 'message',
    actor: 'Utilisateur',
    label: compactLabel(ownText || (isLatest ? requestLabel : undefined)),
    content: '',
    detail: `Demande ${turn.id}`,
    timestamp: turn.ts,
    status:
      turn.events.some((event) => event.status === 'running') || turnStartedNotClosed(turn)
        ? 'running'
        : 'completed',
    durationMs: 0,
    payloads: [],
    display: {
      kind: 'request',
      title: dated.charAt(0).toUpperCase() + dated.slice(1),
      observedEventIds: [],
      // LA DEMANDE SE RELIT EN ENTIER AU CLIC (demande du 2026-10-12) : ses sources sont les messages
      // du tour qui portent le marqueur `UTILISATEUR:`. Sans elles, le détail disait « Aucun prompt
      // ni retour » sous chaque demande (252 sur 252 mesurées). Deux suffisent : la demande reçue à
      // l'envoi, puis le premier appel au modèle — seul à porter le texte entier avant ce jour.
      payloadEventIds: turn.events
        .filter((event) => event.kind === 'message' && MARQUE_UTILISATEUR.test(event.content ?? ''))
        .slice(0, 2)
        .map((event) => event.id)
    }
  }
}

const MARQUE_UTILISATEUR = /(^|\n)\s*UTILISATEUR\s*:/

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
    label: nomDEtape(phase),
    content: '',
    detail: `Phase ${phase} observée dans la trace`,
    timestamp,
    status: 'completed',
    durationMs: 0,
    payloads: [],
    execution: { phase },
    display: {
      kind: 'phase',
      title: nomDEtape(phase),
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

/** Premier ancêtre (dans la trace brute) qui satisfait `match`, en partant de `parentId`. */
function nearestAncestor(
  parentId: string | undefined,
  sourceById: Map<string, HarnessTimelineEvent>,
  match: (candidate: HarnessTimelineEvent) => boolean
): string | undefined {
  const visited = new Set<string>()
  let currentId = parentId
  while (currentId && !visited.has(currentId)) {
    const current = sourceById.get(currentId)
    if (!current) return undefined
    if (match(current)) return currentId
    visited.add(currentId)
    currentId = current.parentId
  }
  return undefined
}

function rawActorId(event: HarnessTimelineEvent): string | undefined {
  return (event.raw as { actor?: { id?: string } } | undefined)?.actor?.id
}

function auxPhaseOf(phaseNodeId: string, phaseEvents: HarnessTimelineEvent[]): string | undefined {
  return phaseEvents.find((event) => event.id === phaseNodeId)?.execution?.phase
}

function toolNameOfResult(result: HarnessTimelineEvent | undefined): string | undefined {
  return result ? toolNameOf(result) : undefined
}

/**
 * Durée d'une action : la mesure écrite si la trace en porte une, sinon l'écart entre l'appel et son
 * résultat — deux instants journalisés. Sans résultat ni mesure, aucune durée n'est inventée.
 */
function actionDuration(
  call: HarnessTimelineEvent,
  result: HarnessTimelineEvent | undefined
): number | undefined {
  if (call.durationMs != null && Number.isFinite(call.durationMs)) return call.durationMs
  if (result?.durationMs != null && Number.isFinite(result.durationMs)) return result.durationMs
  const start = Date.parse(call.timestamp ?? '')
  const end = Date.parse(result?.timestamp ?? '')
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined
}

/** Statut d'un groupe d'actions : le plus grave l'emporte, un échec ne se noie pas dans un « ×3 ». */
function groupStatus(statuses: Array<string | undefined>): string {
  for (const status of ['failed', 'running', 'cancelled', 'pending'])
    if (statuses.includes(status)) return status
  return statuses.find(Boolean) ?? 'completed'
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
    return event.execution?.agentId === 'judge:quorum'
      ? 'Agrégation locale'
      : roleLabel(event.actor)
  }
  if (event.kind === 'verdict') return 'Juge'
  if (event.kind === 'gate') return 'Décision de clôture'
  const role = roleLabel(event.actor)
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

/**
 * Genres d'événements dont une TENTATIVE de sous-agent prête ses charges au nœud. Les appels
 * d'outil (`tool-call`, `tool-result`) en sont exclus à dessein : ils portent eux aussi une charge
 * `error` (conv-139), qui se serait affichée comme le retour du sous-agent.
 */
const ATTEMPT_PAYLOAD_EVENT_KINDS = new Set<HarnessTimelineEvent['kind']>([
  'handoff',
  'verdict',
  'message',
  'injection',
  'boundary',
  'model-response',
  'error'
])

/**
 * Charges montrées par le détail d'une étape : celles de `NODE_PAYLOAD_KINDS`, sans doublon. Le
 * relais terminal d'un sous-agent recopie la réponse du modèle mot pour mot (conv-139) : sans
 * dédoublonnage, le retour s'afficherait deux fois. Sert à la projection ET aux charges relues au
 * clic (`ExecutionNodeContents`). Comparaison par genre, sans concaténer de clés : en direct, la
 * projection se rejoue chaque seconde sur des prompts de plusieurs dizaines de Ko.
 */
export function distinctNodePayloads(
  payloads: HarnessTimelineEvent['payloads']
): HarnessTimelineEvent['payloads'] {
  const seenByKind = new Map<string, string[]>()
  const kept: HarnessTimelineEvent['payloads'] = []
  for (const payload of payloads) {
    if (!NODE_PAYLOAD_KINDS.has(payload.kind)) continue
    const seen = seenByKind.get(payload.kind) ?? []
    if (seen.includes(payload.content)) continue
    seen.push(payload.content)
    seenByKind.set(payload.kind, seen)
    kept.push(payload)
  }
  return kept
}

/**
 * Cause d'un échec : la charge `error` (sinon `model-response`) du DERNIER événement en échec de la
 * tentative — conv-163 y écrit « checkpoint orchestration causalement invalide… ». Aucune charge
 * écrite → `undefined` : on n'invente pas de cause. En lecture allégée, la trace ne garde de ces
 * charges qu'un extrait borné (`EXTRAIT_CAUSE_MAX`, `trace-allegee.ts`) : assez pour la carte, le
 * texte entier reste dans le détail relu au clic.
 */
function failureCause(sources: HarnessTimelineEvent[]): string | undefined {
  for (const source of [...sources].reverse()) {
    if (source.status !== 'failed') continue
    const payloads = source.payloads ?? []
    const cause =
      payloads.find((payload) => payload.kind === 'error' && payload.content?.trim()) ??
      payloads.find((payload) => payload.kind === 'model-response' && payload.content?.trim())
    if (cause) return cause.content.trim()
  }
  return undefined
}

/**
 * L'ISSUE AFFICHÉE D'UNE ÉTAPE : son statut et, si elle a échoué, pourquoi.
 *
 * UN SOUS-AGENT ARRÊTÉ PAR LE BOUTON STOP EST « ANNULÉ », PAS « EN ÉCHEC » (conv-966). La trace
 * l'écrit `failed` — l'étape ne s'est pas terminée — mais sa cause porte le motif du Stop
 * (`estArretParStop`). Rouge, avec « INTERROMPU » en ligne d'échec, il se lisait comme une panne
 * (conv-955, sous-agent clean). Annulé, il reprend le gris déjà prévu pour un arrêt voulu
 * (conv-191) ; le texte de l'arrêt reste lisible au clic, dans son retour.
 */
function issueDeLEtape(
  statut: HarnessTimelineEvent['status'],
  sources: HarnessTimelineEvent[]
): { status: HarnessTimelineEvent['status']; failure?: string } {
  if (statut !== 'failed') return { status: statut }
  const failure = failureCause(sources)
  return estArretParStop(failure) ? { status: 'cancelled' } : { status: statut, failure }
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
 * Projection conversationnelle des nouveaux faits de run DU TOUR CHOISI. Un tour sans run (ou une
 * ancienne trace sans lifecycle) passe dans le projecteur historique situé sous cette fonction.
 *
 * Les runs retenus sont ceux que le tour TOUCHE ; leurs faits sont ensuite lus dans TOUTE la
 * conversation, car un run repris après redémarrage persiste sa suite sous un autre tour
 * (`relaunch-resumable-run.ts`, `resumeTurnId`) et doit s'afficher entier. Avant, la projection
 * prenait les runs de TOUS les tours et passait avant le choix du tour : un seul run dans la
 * conversation masquait le sélecteur et confisquait le graphe (scout du 2026-10-10).
 */
function projectRunExecutions(
  timeline: HarnessTimeline,
  turn: HarnessTimelineTurn,
  requestLabel: string | undefined,
  isLatest: boolean
): RequestExecutionProjection | undefined {
  const turnRunIds = new Set(
    turn.events
      .map((event) => event.run?.runId ?? event.execution?.runId)
      .filter((runId): runId is string => Boolean(runId))
  )
  if (turnRunIds.size === 0) return undefined
  const allEvents = timeline.turns.flatMap((item) => item.events).sort(eventOrder)
  const workspaceFacts = allEvents.filter(
    (event) => event.run?.stage === 'workspace' && turnRunIds.has(event.run.runId)
  )
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

  // LA DEMANDE ET L'ORCHESTRATEUR AU-DESSUS DU DÉPÔT (2026-10-12). Un tour qui lançait un run
  // partait de « Dépôt de travail » : ni la demande, ni l'agent qui avait lancé le run, ni la durée
  // et le coût du tour (vu en direct sur le tour ce8530d4). Mêmes racine et bilan que le chat direct.
  const requestNode = requestRoot(turn, requestLabel, isLatest)
  const orchestrator = runLauncherNode(turn, requestNode.id)
  const workspaceParentId = orchestrator?.id ?? requestNode.id

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
      parentId: workspaceParentId,
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
          title: nomDEtape(phase),
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
      // LE DÉTAIL DU SOUS-AGENT SORT DE SA TENTATIVE, PAS SEULEMENT DE SA DESCENDANCE.
      //
      // `payloads: []` jetait tout : un clic sur un sous-agent de run disait « Aucun prompt ni
      // retour enregistré » alors que la trace les portait (constaté le 2026-10-10 sur conv-139 et
      // conv-163). Le prompt d'un sous-agent n'est PAS un descendant du relais : il est relié par
      // `attemptId`. On réunit donc relais, descendants techniques et événements de la tentative,
      // puis on garde le même filtre que le chat direct (`NODE_PAYLOAD_KINDS`).
      const linked = runEvents.filter(
        (event) =>
          event.execution?.attemptId === attemptId && ATTEMPT_PAYLOAD_EVENT_KINDS.has(event.kind)
      )
      // Une source par identifiant : relais, descendant et membre de la tentative se recoupent.
      const payloadSources = [
        ...new Map([...ordered, ...grouped, ...linked].map((event) => [event.id, event])).values()
      ].sort(eventOrder)
      const { status, failure } = issueDeLEtape(terminal?.status ?? latest.status, payloadSources)
      const agent: HarnessTimelineEvent = {
        ...latest,
        id: `agent:${runId}:${attemptId}`,
        parentId: skillByPhase.get(phase ?? '')?.id ?? runWorkspaceId,
        provider: terminal?.provider ?? latest.provider,
        model: terminal?.model ?? latest.model,
        status,
        durationMs: terminal?.durationMs ?? latest.durationMs,
        costUsd: terminal?.costUsd ?? latest.costUsd,
        payloads: distinctNodePayloads(payloadSources.flatMap((source) => source.payloads ?? [])),
        execution: { ...latest.execution, runId, attemptId },
        display: {
          kind: 'agent',
          title: agentTitle(latest),
          ...(failure ? { failure } : {}),
          runId,
          attemptId,
          observedEventIds: [
            ...new Set([...ordered.map((event) => event.id), ...grouped.map((event) => event.id)])
          ],
          // Mêmes sources, même ordre que `payloads` : le détail relu au clic (lecture allégée,
          // `os:causalTrace:charges`) est identique à celui de la trace complète.
          payloadEventIds: payloadSources.map((source) => source.id),
          dependencyIds: [...(latest.execution?.dependencyIds ?? [])],
          workflow: 'autowin',
          skillName: phase
        }
      }
      projectedAgents.push(agent)
      events.push(agent)
    }

    // UNE PHASE ROUGE L'EST PARCE QU'UN DE SES SOUS-AGENTS A ÉCHOUÉ (conv-966) : le nœud « Clean »
    // ne disait que « alias de phase ». Le dernier sous-agent en échec de la phase dit pourquoi.
    for (const [phase, skill] of skillByPhase) {
      if (skill.status !== 'failed' || !skill.display) continue
      const agentsDeLaPhase = projectedAgents.filter((agent) => agent.execution?.phase === phase)
      const echec = [...agentsDeLaPhase].reverse().find((agent) => agent.status === 'failed')
      // Une phase dont le seul arrêt est un Stop n'a pas échoué : elle est annulée, comme lui.
      if (!echec && agentsDeLaPhase.some((agent) => agent.status === 'cancelled')) {
        skill.status = 'cancelled'
        continue
      }
      skill.display = {
        ...skill.display,
        failure: causeNommee(echec?.display?.title, echec?.display?.failure)
      }
    }

    const gitFact = [...runEvents].reverse().find((event) => event.run?.stage === 'git')
    let gitNode: HarnessTimelineEvent | undefined
    if (gitFact?.run?.stage === 'git' && workspace.mode === 'worktree') {
      const completedAgents = projectedAgents.filter((event) => event.status === 'completed')
      const fallbackSkill = [...skillByPhase.values()].at(-1)
      const parentId =
        completedAgents.length === 1 ? completedAgents[0].id : (fallbackSkill?.id ?? runWorkspaceId)
      const git = gitFact.run.git
      // « Cause : base-dirty » ne disait rien : le code est traduit, les fichiers nommés (conv-966).
      const failure = raisonDuGit(git)
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
          ...(failure ? { failure } : {}),
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
    // UNE CLÔTURE ROUGE DIT POURQUOI, même quand le run s'est arrêté AVANT le contrôle final : ses
    // « Raisons » restaient vides (conv-914, conv-916 : quota du sous-agent). Les traces écrites
    // depuis le 2026-10-15 portent l'erreur d'arrêt (`raisonsDArretDuRun`, orchestrator.ts) ; les
    // plus anciennes la retrouvent ici, sur la publication refusée ou l'étape en échec.
    const etapeEnEchec = [...projectedAgents].reverse().find((agent) => agent.status === 'failed')
    const etapeAnnulee = [...projectedAgents]
      .reverse()
      .find((agent) => agent.status === 'cancelled')
    const closureFailure = raisonDeLaCloture(closure, {
      ...(gitNode?.display?.failure ? { git: gitNode.display.failure } : {}),
      ...(etapeEnEchec
        ? {
            etapeEnEchec: causeNommee(etapeEnEchec.display?.title, etapeEnEchec.display?.failure)
          }
        : {}),
      ...(etapeAnnulee?.display?.title ? { etapeArreteeParStop: etapeAnnulee.display.title } : {})
    })
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
        ...(closureFailure ? { failure: closureFailure } : {}),
        runId,
        closure,
        observedEventIds: closureFacts.map((event) => event.id),
        // Le verdict RENDU (ni le démarrage du juge, ni un juge encore en cours) : c'est lui qui
        // porte les raisons de l'acceptation ou du refus dans le bilan du run.
        verdictEventIds: runEvents
          .filter(
            (event) =>
              event.kind === 'verdict' && event.status !== 'running' && event.status !== 'pending'
          )
          .map((event) => event.id),
        // « Rejouer ce run » (conv-981) : le déroulé par agent de CE run, par le calcul de la
        // Chronologie. Les événements d'agent portent `execution.runId` (mesuré sur conv-981 :
        // 211 sur 211), donc `runEvents` les contient.
        ...(() => {
          const gantt = buildAgentGantt(runEvents)
          return gantt ? { gantt } : {}
        })()
      }
    })
  }

  const head = [withRequestTotals(requestNode, turn, orchestrator ? [orchestrator] : [])]
  if (orchestrator) head.push(orchestrator)
  return {
    turnId: turn.id,
    runIds,
    events: [...head, ...events]
  }
}

/**
 * L'orchestrateur qui a LANCÉ le run : les appels au modèle du chat dans ce tour, réunis en un bloc
 * (durée mesurée de leurs réponses, modèle, échec si tous ont échoué). Absent si la trace n'en
 * porte aucun (run repris seul) : le dépôt se pose alors directement sous la demande.
 */
function runLauncherNode(
  turn: HarnessTimelineTurn,
  parentId: string
): HarnessTimelineEvent | undefined {
  const calls = directProviderEvents(turn).filter(
    (event) => !event.run && !event.execution?.runId && !event.execution?.attemptId
  )
  if (calls.length === 0) return undefined
  const childrenByParent = new Map<string, HarnessTimelineEvent[]>()
  for (const event of turn.events) {
    if (!event.parentId) continue
    childrenByParent.set(event.parentId, [...(childrenByParent.get(event.parentId) ?? []), event])
  }
  const closings = calls.map((call) => {
    const absorbed = technicalDescendants(call, childrenByParent)
    const errors = [call, ...absorbed]
      .flatMap((event) => childrenByParent.get(event.id) ?? [])
      .filter((event) => event.kind === 'error')
    return [...absorbed, ...errors]
      .filter((event) => event.kind === 'model-response' || event.kind === 'error')
      .sort(eventOrder)
      .at(-1)
  })
  const durations = closings
    .map((event) => event?.durationMs)
    .filter((ms): ms is number => ms != null && Number.isFinite(ms))
  const first = calls[0]
  const allFailed = closings.every((event) => event?.kind === 'error' && event.status === 'failed')
  const failure = allFailed
    ? failureCause(closings.filter((event): event is HarnessTimelineEvent => Boolean(event)))
    : undefined
  return {
    ...first,
    id: `request:${turn.id}:orchestrateur`,
    parentId,
    status: allFailed ? 'failed' : 'completed',
    durationMs: durations.length > 0 ? durations.reduce((sum, ms) => sum + ms, 0) : undefined,
    payloads: [],
    display: {
      kind: 'agent',
      title: agentTitle(first),
      ...(failure ? { failure } : {}),
      observedEventIds: calls.map((event) => event.id),
      payloadEventIds: calls.map((event) => event.id),
      workflow: 'autowin'
    }
  }
}

/**
 * La demande porte le bilan du tour : durée et coût du superviseur, et son issue. Un tour arrêté par
 * Stop est « annulé » ; un tour dont TOUS les appels au modèle ont échoué est « en échec » (conv-879).
 */
function withRequestTotals(
  root: HarnessTimelineEvent,
  turn: HarnessTimelineTurn,
  agentBlocks: HarnessTimelineEvent[]
): HarnessTimelineEvent {
  const supervisor = [...turn.events]
    .reverse()
    .find((event) => event.kind === 'boundary' && rawActorId(event) === 'execution-supervisor')
  const status =
    root.status === 'running'
      ? 'running'
      : supervisor?.status === 'cancelled'
        ? 'cancelled'
        : agentBlocks.length > 0 && agentBlocks.every((event) => event.status === 'failed')
          ? 'failed'
          : root.status
  // La demande échoue parce que ses appels au modèle ont échoué : le DERNIER dit pourquoi.
  const dernierEchec = [...agentBlocks].reverse().find((event) => event.status === 'failed')
  const failure =
    status === 'failed'
      ? causeNommee(dernierEchec?.display?.title, dernierEchec?.display?.failure)
      : undefined
  return {
    ...root,
    status,
    ...(supervisor?.durationMs != null && Number.isFinite(supervisor.durationMs)
      ? { durationMs: supervisor.durationMs }
      : {}),
    ...(supervisor?.costUsd != null ? { costUsd: supervisor.costUsd } : {}),
    display: {
      ...(root.display as NonNullable<HarnessTimelineEvent['display']>),
      ...(failure ? { failure } : {}),
      observedEventIds: supervisor ? [supervisor.id] : []
    }
  }
}

/**
 * Libellé d'un tour pour le sélecteur : la DEMANDE humaine, pas le contexte injecté.
 *
 * Le contenu d'un tour est composé (`ÉTAT DE L'APP:\n{json}\n\nUTILISATEUR: …`) : lu brut, chaque
 * option porterait le même JSON illisible. On réutilise l'extracteur déjà éprouvé ailleurs.
 */
function turnOption(turn: HarnessTimelineTurn): RequestTurnOption {
  return { id: turn.id, ts: turn.ts, label: humanRequestText(turn, 80) || turnDateLabel(turn.ts) }
}

/** Texte humain d'un tour, borné ; vide quand la trace ne l'identifie pas sans ambiguïté. */
function humanRequestText(turn: HarnessTimelineTurn, max: number): string {
  const request = turn.events.find((event) => event.kind === 'message')
  const brut = request?.content ?? ''
  // Le contenu d'un message de trace est la CONCATÉNATION de charges quelconques : l'afficher tel
  // quel ferait fuiter dans le sélecteur des contenus que le graphe s'interdit de montrer. Seul un
  // marqueur `UTILISATEUR:` identifie sans ambiguïté une demande humaine ; sinon on DATE le tour.
  return /(^|\n)\s*UTILISATEUR\s*:/.test(brut) ? extractHumanMessage(brut, max) : ''
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
  // `timeline.turns` est déjà trié du plus récent au plus ancien par `buildHarnessTimelineFromTrace`.
  const turns = timeline.turns.map(turnOption)
  const turn =
    (options.turnId ? timeline.turns.find((item) => item.id === options.turnId) : undefined) ??
    timeline.turns[0]
  if (!turn) return { events: [], turns }
  const runProjection = projectRunExecutions(
    timeline,
    turn,
    options.requestLabel,
    turn === timeline.turns[0]
  )
  if (runProjection) return { ...runProjection, turns }

  const root = requestRoot(turn, options.requestLabel, turn === timeline.turns[0])
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
  // LE BILAN DU SUPERVISEUR N'EST PLUS UN BLOC (demande du 2026-10-12 : « bilan du tour c'est
  // bizarre »). Il portait la durée et le coût du tour ENTIER, à côté de l'agent qui avait la même
  // durée : un doublon. Ses chiffres et son issue passent sur la demande (`withRequestTotals`).
  const keptAuxiliary = turn.events.filter(
    (event) =>
      !agentSourceIds.has(event.id) &&
      ['tool-call', 'tool-result', 'retry', 'cancellation', 'error', 'response-displayed'].includes(
        event.kind
      )
  )
  // Une skill invoquée par une commande (« /draft … ») est le vrai sujet de l'orchestrateur : on la
  // nomme au lieu d'écrire « aucune skill ».
  const slashSkill = /^\/([a-z][\w-]*)\b/i.exec(root.label ?? '')?.[1]

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
    // LA DURÉE DE L'AGENT EST CELLE DE SA RÉPONSE. En chat direct, `grouped` reste vide : la
    // réponse du modèle, absorbée sous le prompt, ne prêtait pas sa durée mesurée au bloc. Mesuré le
    // 2026-10-12 : 273 blocs « Agent principal » sur 273 sans durée, dont 272 avec une réponse chiffrée.
    // Un appel en échec se clôt par une `error` chiffrée au lieu d'une réponse (conv-770, conv-879).
    // L'erreur n'est pas absorbée (elle garde son propre bloc « Erreur ») : on la cherche parmi les
    // enfants du prompt et de ses événements techniques.
    const ownIds = new Set([event.id, ...absorbed.map((candidate) => candidate.id)])
    const closingErrors = (childrenByParent.get(event.id) ?? [])
      .concat(absorbed.flatMap((candidate) => childrenByParent.get(candidate.id) ?? []))
      .filter((candidate) => candidate.kind === 'error' && !ownIds.has(candidate.id))
    const closings = [...absorbed, ...closingErrors]
      .filter((candidate) => candidate.kind === 'model-response' || candidate.kind === 'error')
      .sort(eventOrder)
      .reverse()
    const measuredResponse = closings.find(
      (candidate) => candidate.durationMs != null && Number.isFinite(candidate.durationMs)
    )
    // L'ISSUE DE L'APPEL DONNE LE STATUT, PAS LE MESSAGE ENVOYÉ. Le prompt est écrit « completed »
    // dès son envoi : un appel clos par une erreur s'affichait « terminé » au-dessus de son propre
    // bloc « Erreur » (conv-770, conv-879). C'est la DERNIÈRE fin qui compte : une erreur suivie
    // d'une réponse n'est pas un échec.
    const lastClosing = closings[0]
    const callFailed = lastClosing?.kind === 'error' && lastClosing.status === 'failed'
    // POURQUOI L'APPEL A ÉCHOUÉ (conv-966) : la cause vit dans l'« Erreur » qui le clôt, un bloc à
    // part ; le bloc rouge « Orchestrateur » ne la disait pas. `closings` va du plus récent au plus
    // ancien, `failureCause` attend l'ordre du temps. Un arrêt par Stop y devient « annulé ».
    const { status, failure } = issueDeLEtape(
      terminal?.status ?? (callFailed ? 'failed' : event.status),
      [event, ...[...closings].reverse()]
    )
    return {
      ...event,
      provider: terminal?.provider ?? event.provider,
      model: terminal?.model ?? event.model,
      status,
      durationMs: terminal?.durationMs ?? event.durationMs ?? measuredResponse?.durationMs,
      // LA DÉLIBÉRATION DU SOUS-AGENT SURVIT À L'ABSORPTION.
      //
      // Le nœud agent absorbe ses événements techniques (message, injection, model-response) ;
      // `payloads: []` jetait TOUT leur contenu — dont la charge `reasoning` écrite par
      // `stepPayloads`. La descente « jusqu'à la pensée » se coupait donc exactement ici, alors
      // que la donnée était présente. Seul `reasoning` remonte : les contenus d'outils et les
      // réponses brutes restent hors du graphe, comme avant.
      // Le PROMPT envoyé et le RETOUR de l'étape remontent aussi (demande du 2026-09-23) : ils sont
      // le détail d'une étape, y compris pour une demande simple qui n'écrit aucun RUN.md. Les
      // contenus d'OUTILS restent hors du graphe.
      payloads: [...(event.payloads ?? []), ...absorbed.flatMap((c) => c.payloads ?? [])].filter(
        (payload) => NODE_PAYLOAD_KINDS.has(payload.kind)
      ),
      display: {
        kind: event.kind === 'gate' || rawActorKind === 'system' ? 'event' : 'agent',
        title: agentTitle(event),
        ...(failure ? { failure } : {}),
        observedEventIds: [event.id, ...grouped.map((candidate) => candidate.id)],
        // Mêmes sources, même ordre que `payloads` ci-dessus : le détail relu au clic est identique.
        payloadEventIds: [event.id, ...absorbed.map((candidate) => candidate.id)],
        dependencyIds: [...(event.execution?.dependencyIds ?? [])],
        workflow: structural.length > 0 ? 'autowin' : 'direct',
        skillName: event.execution?.phase ?? (structural.length === 0 ? slashSkill : undefined),
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

  // UN APPEL D'OUTIL ET SON RÉSULTAT FORMENT UNE SEULE ACTION. La trace les écrit en deux
  // événements ; le graphe en faisait deux blocs, « Outil » puis « Résultat », pour un seul geste.
  const auxById = new Map(keptAuxiliary.map((event) => [event.id, event]))
  const resultOfCall = new Map<string, HarnessTimelineEvent>()
  const callOfResult = new Map<string, string>()
  for (const event of [...keptAuxiliary].sort(eventOrder)) {
    if (event.kind !== 'tool-result') continue
    const callId = nearestAncestor(
      event.parentId,
      sourceById,
      (candidate) => candidate.kind === 'tool-call' && auxById.has(candidate.id)
    )
    if (!callId || resultOfCall.has(callId)) continue
    resultOfCall.set(callId, event)
    callOfResult.set(event.id, callId)
  }
  const auxRawParent = (event: HarnessTimelineEvent): string => {
    const parent = nearestProjectedParent(event.parentId, sourceById, projectedIds, root.id)
    return callOfResult.get(parent) ?? parent
  }
  // PAS D'ESCALIER. La trace relie chaque action à celle qui la PRÉCÈDE (« juste après ») ; le
  // graphe le lisait comme « à l'intérieur de » : 6 actions successives faisaient 14 niveaux
  // (conv-904, /draft). On remonte donc jusqu'au premier ancêtre qui n'est pas une étape annexe —
  // l'agent, la phase ou la demande — et les actions deviennent sœurs, dans l'ordre.
  const anchorOf = (id: string): string => {
    const visited = new Set<string>()
    let current = callOfResult.get(id) ?? id
    while (auxById.has(current) && !visited.has(current)) {
      visited.add(current)
      current = auxRawParent(auxById.get(current) as HarnessTimelineEvent)
    }
    return auxById.has(current) ? root.id : current
  }

  const normalizedAgents = projectedAgents.map((event) => {
    const dependencies = event.execution?.dependencyIds ?? []
    const dependencyParent =
      dependencies.length === 1 ? agentByTaskId.get(dependencies[0]) : undefined
    const observedParent = event.parentId
      ? nearestProjectedParent(event.parentId, sourceById, projectedIds, '')
      : undefined
    const fallback = phaseId.get(event.execution?.phase ?? '') ?? root.id
    const resolved =
      observedParent ||
      dependencyParent ||
      (event.execution?.phase
        ? fallback
        : nearestProjectedParent(event.parentId, sourceById, projectedIds, root.id))
    const anchored = anchorOf(resolved)
    return {
      ...event,
      parentId: anchored === root.id && event.execution?.phase ? fallback : anchored
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
  // UNE ACTION SANS AGENT VISIBLE SE RANGE SOUS L'AGENT QUI L'A FAITE. Le prompt d'un appel direct
  // est écrit à la FIN de l'appel : les outils appelés pendant le travail le précèdent dans la trace
  // et n'ont pas de parent. Même acteur, et l'appel en cours est le premier qui se termine après
  // l'action (sinon le dernier) : l'action rejoint son agent au lieu de flotter sous la demande.
  const phaseIds = new Set(phaseEvents.map((event) => event.id))
  const agentsByActor = new Map<string, HarnessTimelineEvent[]>()
  for (const agent of normalizedAgents) {
    const actorId = rawActorId(agent)
    if (agent.display?.kind !== 'agent' || !actorId) continue
    agentsByActor.set(actorId, [...(agentsByActor.get(actorId) ?? []), agent])
  }
  for (const list of agentsByActor.values()) list.sort(eventOrder)
  const agentOfAction = (
    action: HarnessTimelineEvent,
    anchor: string
  ): HarnessTimelineEvent | undefined => {
    const phase = phaseIds.has(anchor) ? auxPhaseOf(anchor, phaseEvents) : undefined
    const candidates = (agentsByActor.get(rawActorId(action) ?? '') ?? []).filter(
      (agent) => phase === undefined || agent.execution?.phase === phase
    )
    return candidates.find((agent) => eventOrder(agent, action) >= 0) ?? candidates.at(-1)
  }

  // LES GESTES D'UN MÊME OUTIL SE REGROUPENT SOUS LEUR AGENT, même entrecoupés : « Notes lues ×3 ».
  // Seuls les gestes CONSÉCUTIFS se regroupaient. Depuis que le chat écrit aussi les gestes propres
  // de l'agent (2026-10-12), un tour en enchaîne des dizaines en alternance (lecture, commande,
  // lecture…) : le regroupement par voisinage aurait fait des dizaines de perles. Un geste en échec
  // reste visible : le groupe prend le statut le plus grave (`groupStatus`).
  interface StepGroup {
    head: HarnessTimelineEvent
    parentId: string
    members: HarnessTimelineEvent[]
    toolName?: string
    isTool: boolean
  }
  const groups: StepGroup[] = []
  const groupByTool = new Map<string, StepGroup>()
  for (const event of [...keptAuxiliary].sort(eventOrder)) {
    if (callOfResult.has(event.id)) continue
    const isTool = event.kind.startsWith('tool-')
    const anchor = anchorOf(event.id)
    const parentId =
      isTool && (anchor === root.id || phaseIds.has(anchor))
        ? (agentOfAction(event, anchor)?.id ?? anchor)
        : anchor
    const toolName = isTool
      ? (toolNameOf(event) ?? toolNameOfResult(resultOfCall.get(event.id)))
      : undefined
    const key = isTool && toolName ? `${parentId} ${toolName}` : undefined
    const existing = key ? groupByTool.get(key) : undefined
    if (existing) {
      existing.members.push(event)
      continue
    }
    const group: StepGroup = { head: event, parentId, members: [event], toolName, isTool }
    groups.push(group)
    if (key) groupByTool.set(key, group)
  }

  const normalizedAuxiliary = groups.map<HarnessTimelineEvent>((group) => {
    const { head, parentId } = group
    const parentContext = workflowContextById.get(parentId)
    const phase = head.execution?.phase
    const workflow =
      parentContext?.workflow ?? (phase || structural.length > 0 ? 'autowin' : 'direct')
    const skillName = phase ?? parentContext?.skillName
    if (!group.isTool) {
      return {
        ...head,
        parentId,
        payloads: [],
        display: {
          kind: 'event',
          title: stepTitle(head),
          observedEventIds: [head.id],
          // Relu au clic : le texte d'une « Réponse affichée », la cause d'une erreur.
          payloadEventIds: [head.id],
          workflow,
          skillName
        }
      }
    }
    const pairs = group.members.map((call) => ({ call, result: resultOfCall.get(call.id) }))
    const durations = pairs.map(({ call, result }) => actionDuration(call, result))
    const count = pairs.length
    const echecs = pairs.filter(({ call, result }) => (result ?? call).status === 'failed').length
    return {
      ...head,
      parentId,
      actor: group.toolName ?? head.actor,
      status: groupStatus(pairs.map(({ call, result }) => (result ?? call).status)),
      durationMs: durations.every((ms) => ms != null)
        ? durations.reduce<number>((sum, ms) => sum + (ms ?? 0), 0)
        : undefined,
      payloads: [],
      display: {
        kind: 'tool',
        // Le nombre vit dans `count`, hors du titre : la carte coupe un titre trop long, jamais
        // le « ×3 » qui le suit (capture du 2026-10-12, panneau de 388 px).
        title: toolTitle(group.toolName, count),
        ...(count > 1 ? { count } : {}),
        ...(count > 1 && echecs > 0 ? { echecs } : {}),
        observedEventIds: pairs.flatMap(({ call, result }) =>
          result ? [call.id, result.id] : [call.id]
        ),
        // LE DÉTAIL DE CHAQUE APPEL, RELU AU CLIC (demande du 2026-10-12). « Fait retenu » montre
        // QUEL fait : la réponse de `remember` porte le fait validé (`fact.title`, `fact.body`) ou le
        // motif du refus — ses arguments ne sont jamais relus, un fait refusé pour un secret y figure
        // en clair. Tout autre outil montre ce que chaque appel a envoyé et reçu.
        ...(group.toolName === 'remember'
          ? {
              detailOutil: 'fait-retenu' as const,
              payloadEventIds: pairs.flatMap(({ result }) => (result ? [result.id] : []))
            }
          : {
              detailOutil: 'appels' as const,
              payloadEventIds: pairs.flatMap(({ call, result }) =>
                result ? [call.id, result.id] : [call.id]
              )
            }),
        workflow,
        skillName
      }
    }
  })

  // LA DEMANDE PORTE LE BILAN : durée et coût du tour entier, et son issue (`withRequestTotals`).
  const rootWithTotals = withRequestTotals(
    root,
    turn,
    normalizedAgents.filter((event) => event.display?.kind === 'agent')
  )

  const events = [rootWithTotals, ...phaseEvents, ...normalizedAgents, ...normalizedAuxiliary]
  events.sort((a, b) => {
    if (a.id === root.id) return -1
    if (b.id === root.id) return 1
    return (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
  })
  return { turnId: turn.id, events, turns }
}
