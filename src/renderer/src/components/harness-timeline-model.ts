import type {
  RunClosureObservation,
  RunExecutionQuoteObservation,
  RunGitObservation,
  RunLifecycleEvent,
  RunWorkspaceObservation
} from '../../../shared/run-execution'
import type { AgentGantt } from './observatory-agent-gantt'
import { formaterNombre } from '../langue'
import { texteChatExecution as t } from '../textes-ecrans/chat-execution'

export type HarnessTimelineEventKind =
  | 'message'
  | 'injection'
  | 'decision'
  | 'tool-call'
  | 'tool-result'
  | 'model-response'
  /** Livrable produit par le modele (fichier, image, document) — une SORTIE, pas un retour d'outil. */
  | 'artifact'
  | 'handoff'
  | 'verdict'
  | 'gate'
  | 'retry'
  | 'cancellation'
  | 'error'
  | 'boundary'
  | 'response-displayed'
export interface HarnessAuthorityReceipt {
  mode: 'plan' | 'ask' | 'auto'
  commandAuthority: 'automatic' | 'sensitive' | 'destructive'
  mutates: boolean
  decision: 'allow' | 'confirm' | 'deny'
  decisionId?: string
  resolution?: 'approve' | 'cancel'
  resolvedBy?: 'user' | 'timeout-default'
}
export interface HarnessTimelineEvent {
  id: string
  sequence?: number
  kind: HarnessTimelineEventKind
  actor: string
  label: string
  content: string
  detail: string
  parentId?: string
  provider?: string
  model?: string
  tokens?: number
  costUsd?: number
  timestamp?: string
  status?: string
  channel?: string
  injector?: string
  recipient?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  durationMs?: number
  raw?: unknown
  reasoningEffort?: string
  transport?: string
  sessionId?: string
  authority?: HarnessAuthorityReceipt
  execution?: {
    phase?: string
    agentId?: string
    taskId?: string
    groupId?: string
    dependencyIds?: string[]
    runId?: string
    attemptId?: string
  }
  display?: {
    kind:
      | 'workspace'
      | 'quote'
      | 'skill'
      | 'agent'
      | 'git'
      | 'closure'
      | 'request'
      | 'phase'
      | 'tool'
      | 'event'
    title: string
    observedEventIds?: string[]
    /**
     * Événements dont les charges composent le détail du nœud, dans l'ordre d'affichage. Le graphe
     * reçoit la trace SANS contenus : il relit ces charges-là, et elles seules, à l'ouverture.
     */
    payloadEventIds?: string[]
    /**
     * Le détail d'une brique d'OUTIL, relu au clic seulement — l'arbre n'en reçoit jamais le contenu.
     * `fait-retenu` : le fait VALIDÉ par `remember`, lu dans sa RÉPONSE, jamais ses arguments (un
     * fait refusé pour un secret y figure en clair). `appels` : ce que chaque appel a envoyé et reçu
     * (demande du 2026-10-12 : « je dois voir ce qui est fait en détail quand je déplie »).
     */
    detailOutil?: 'fait-retenu' | 'appels'
    /**
     * Nombre d'appels EN ÉCHEC d'un groupe d'outil (`count` > 1). Le groupe prend le statut le plus
     * grave : sans ce nombre, « Commandes ×10 · échec » se lisait « 10 commandes en échec » pour une
     * seule (conv-937, 2026-10-13).
     */
    echecs?: number
    dependencyIds?: string[]
    limitation?: string
    /** Cause d'échec d'un sous-agent de run, telle que la trace l'a écrite. Absente = aucune écrite. */
    failure?: string
    workflow?: 'autowin' | 'direct'
    skillName?: string
    skillIdentity?: 'phase-alias'
    /** Gestes regroupés dans ce bloc (« Notes lues » ×3). Absent = un seul. Affiché hors du titre. */
    count?: number
    runId?: string
    attemptId?: string
    workspace?: RunWorkspaceObservation & { root?: boolean }
    quote?: RunExecutionQuoteObservation
    git?: RunGitObservation
    closure?: RunClosureObservation
    /**
     * Nœud de CLÔTURE : les verdicts RENDUS par le juge de ce run, dans l'ordre (un par passage,
     * réparations comprises). Le bilan relit le dernier au clic — l'arbre n'en reçoit pas le texte.
     */
    verdictEventIds?: string[]
    /**
     * Nœud de CLÔTURE : le déroulé par agent de CE run (`buildAgentGantt`, le calcul de la
     * Chronologie), pour « Rejouer ce run » depuis son bilan (conv-981). Absent sans agent tracé.
     */
    gantt?: AgentGantt
  }
  run?: RunLifecycleEvent
  payloads: Array<{ kind: string; content: string; name?: string; mediaType?: string }>
}
export interface HarnessTimelineTurn {
  id: string
  ts: string
  events: HarnessTimelineEvent[]
  tokens: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}
export interface HarnessAnomaly {
  kind: 'duplicate-injection' | 'large-injection'
  label: string
  count: number
  characters: number
  impact: number
  eventId: string
  turnIds: string[]
  fact: string
  hypothesis: string
  recommendation: string
}
export interface HarnessTimeline {
  turns: HarnessTimelineTurn[]
  anomalies: HarnessAnomaly[]
  totalTokens: number
  totalCostUsd: number
}

export interface HarnessTraceEvent {
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  type: HarnessTimelineEventKind
  status: string
  channel: string
  actor: { id: string; kind: string; label: string }
  injector?: { id: string; kind: string; label: string }
  recipient?: { id: string; kind: string; label: string }
  payloads: Array<{ kind: string; content: string; name?: string; mediaType?: string }>
  observation: { boundary: string; fidelity: string; limitation?: string }
  execution?: {
    phase?: string
    agentId?: string
    taskId?: string
    groupId?: string
    dependencyIds?: string[]
    runId?: string
    attemptId?: string
  }
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
  authority?: HarnessAuthorityReceipt
}

export function buildHarnessTimelineFromTrace(events: HarnessTraceEvent[]): HarnessTimeline {
  const byTurn = new Map<string, HarnessTraceEvent[]>()
  for (const event of events) byTurn.set(event.turnId, [...(byTurn.get(event.turnId) ?? []), event])

  const turns = [...byTurn.entries()]
    .map<HarnessTimelineTurn>(([turnId, turnEvents]) => {
      const ordered = [...turnEvents].sort((a, b) => a.sequence - b.sequence)
      const mapped = ordered.map<HarnessTimelineEvent>((event) => {
        const metrics = event.metrics ?? {}
        // Le cache lu est une ventilation de l'entrée provider, pas un volume additionnel.
        const tokens = (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0)
        const provenance = [
          t('frise.canal', { canal: event.channel }),
          t('frise.injecteur', { injecteur: event.injector?.label ?? t('frise.non-applicable') }),
          t('frise.destinataire', {
            destinataire: event.recipient?.label ?? t('frise.non-expose')
          }),
          `${event.observation.fidelity} @ ${event.observation.boundary}`
        ].join(' · ')
        return {
          id: event.id,
          sequence: event.sequence,
          parentId: event.parentId,
          kind: event.type,
          actor: event.actor.label,
          label: event.payloads.map((payload) => payload.kind).join(' + '),
          content: event.payloads.map((payload) => payload.content).join('\n\n'),
          detail: event.observation.limitation
            ? `${provenance} · ${event.observation.limitation}`
            : provenance,
          provider: event.provider?.id,
          model: event.provider?.model,
          tokens: tokens || undefined,
          costUsd: metrics.costUsd,
          timestamp: event.timestamp,
          status: event.status,
          channel: event.channel,
          injector: event.injector?.label,
          recipient: event.recipient?.label,
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          cacheReadTokens: metrics.cacheReadTokens,
          durationMs: metrics.durationMs,
          reasoningEffort: event.provider?.reasoningEffort,
          transport: event.provider?.transport,
          sessionId: event.provider?.sessionId,
          authority: event.authority ? { ...event.authority } : undefined,
          execution: event.execution
            ? {
                ...event.execution,
                dependencyIds: [...(event.execution.dependencyIds ?? [])]
              }
            : undefined,
          run: event.run,
          payloads: event.payloads.map((payload) => ({ ...payload })),
          raw: event
        }
      })
      // Une trace porte aussi des evenements structurels (handoff, gate, closure) qui referencent
      // le meme appel. Seule la reponse provider est une unite de consommation atomique.
      const atomicUsage = mapped.filter(
        (_event, index) => ordered[index]?.type === 'model-response'
      )
      return {
        id: turnId,
        ts: ordered[0]?.timestamp ?? '',
        events: mapped,
        tokens: atomicUsage.reduce((sum, event) => sum + (event.tokens ?? 0), 0),
        costUsd: atomicUsage.reduce((sum, event) => sum + (event.costUsd ?? 0), 0),
        inputTokens: atomicUsage.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
        outputTokens: atomicUsage.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0)
      }
    })
    .sort((a, b) => b.ts.localeCompare(a.ts))

  const injections = new Map<string, { content: string; occurrences: HarnessTraceEvent[] }>()
  for (const event of events.filter((item) => item.type === 'injection')) {
    const content = event.payloads.map((payload) => payload.content).join('\n\n')
    const identity = JSON.stringify({
      payloads: event.payloads.map(({ kind, content: payloadContent, name, mediaType }) => ({
        kind,
        content: payloadContent,
        name,
        mediaType
      })),
      channel: event.channel,
      injector: event.injector?.id,
      recipient: event.recipient?.id,
      provider: event.provider?.id,
      model: event.provider?.model
    })
    if (content) {
      const group = injections.get(identity) ?? { content, occurrences: [] }
      group.occurrences.push(event)
      injections.set(identity, group)
    }
  }
  const anomalies: HarnessAnomaly[] = []
  for (const { content, occurrences } of injections.values()) {
    const characters = content.length
    const turnIds = [...new Set(occurrences.map((event) => event.turnId))]
    if (occurrences.length > 1)
      anomalies.push({
        kind: 'duplicate-injection',
        label: t('frise.repetee'),
        count: occurrences.length,
        characters,
        impact: characters * (occurrences.length - 1),
        eventId: occurrences[0].id,
        turnIds,
        fact: t('frise.repetee.fait', {
          n: occurrences.length,
          caracteres: formaterNombre(characters),
          tours: turnIds.join(', ')
        }),
        hypothesis: t('frise.repetee.hypothese'),
        recommendation: t('frise.repetee.recommandation')
      })
    if (characters >= 12_000)
      anomalies.push({
        kind: 'large-injection',
        label: t('frise.volumineux'),
        count: occurrences.length,
        characters,
        impact: characters,
        eventId: occurrences[0].id,
        turnIds,
        fact: t('frise.volumineux.fait', { caracteres: formaterNombre(characters) }),
        hypothesis: t('frise.volumineux.hypothese'),
        recommendation: t('frise.volumineux.recommandation')
      })
  }
  anomalies.sort((a, b) => b.impact - a.impact || a.eventId.localeCompare(b.eventId))
  return {
    turns,
    anomalies: anomalies.slice(0, 5),
    totalTokens: turns.reduce((sum, turn) => sum + turn.tokens, 0),
    totalCostUsd: turns.reduce((sum, turn) => sum + turn.costUsd, 0)
  }
}
