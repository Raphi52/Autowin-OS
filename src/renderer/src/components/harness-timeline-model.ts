export type HarnessTimelineEventKind =
  | 'message'
  | 'injection'
  | 'decision'
  | 'tool-call'
  | 'tool-result'
  | 'model-response'
  | 'handoff'
  | 'verdict'
  | 'gate'
  | 'retry'
  | 'cancellation'
  | 'error'
  | 'boundary'
  | 'response-displayed'
export interface HarnessTimelineEvent {
  id: string
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
  payloads: Array<{ kind: string; content: string; name?: string; mediaType?: string }>
}
export interface HarnessTimelineTurn {
  id: string
  ts: string
  events: HarnessTimelineEvent[]
  tokens: number
  costUsd: number
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
          `canal ${event.channel}`,
          `injecteur ${event.injector?.label ?? 'non applicable'}`,
          `destinataire ${event.recipient?.label ?? 'non exposé'}`,
          `${event.observation.fidelity} @ ${event.observation.boundary}`
        ].join(' · ')
        return {
          id: event.id,
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
          payloads: event.payloads.map((payload) => ({ ...payload })),
          raw: event
        }
      })
      return {
        id: turnId,
        ts: ordered[0]?.timestamp ?? '',
        events: mapped,
        tokens: mapped.reduce((sum, event) => sum + (event.tokens ?? 0), 0),
        costUsd: mapped.reduce((sum, event) => sum + (event.costUsd ?? 0), 0)
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
        label: 'Injection répétée',
        count: occurrences.length,
        characters,
        impact: characters * (occurrences.length - 1),
        eventId: occurrences[0].id,
        turnIds,
        fact: `${occurrences.length} occurrences identiques · ${characters.toLocaleString('fr-FR')} caractères chacune · tours : ${turnIds.join(', ')}`,
        hypothesis:
          'Cette répétition peut consommer du contexte si le provider ne la met pas en cache.',
        recommendation:
          'Vérifier si cette instruction doit réellement être renvoyée à chaque appel.'
      })
    if (characters >= 12_000)
      anomalies.push({
        kind: 'large-injection',
        label: 'Bloc d’instructions volumineux',
        count: occurrences.length,
        characters,
        impact: characters,
        eventId: occurrences[0].id,
        turnIds,
        fact: `${characters.toLocaleString('fr-FR')} caractères injectés · seuil 12 000`,
        hypothesis:
          'Ce volume peut dominer la charge d’entrée, sans prouver que son contenu est inutile.',
        recommendation:
          'Vérifier si une version plus courte conserve les contraintes indispensables.'
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
