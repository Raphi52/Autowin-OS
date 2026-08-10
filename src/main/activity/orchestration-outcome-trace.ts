import { assertTraceEvent, type TraceEventV1 } from './trace-event'
import type { TraceStore } from './trace-store'

/**
 * Champs QUALITATIFS de l'issue d'orchestration. Le cout est deliberement absent : il etait deja
 * traite (`chat-usage-settlement.ts`, `prompt-observability.ts`) et le redoubler ici ferait compter
 * deux fois la meme depense.
 */
const CHAMPS = ['status', 'valid', 'gateBlocked', 'reused', 'runId'] as const

interface OutcomeTraceInput {
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  outcome: Record<string, unknown>
}

/**
 * Projette l'issue d'une orchestration en evenement causal TYPE, au lieu du seul texte libre du
 * `done`.
 *
 * Type `gate` : c'est un verdict de controle, et le typer ainsi le rend filtrable par le filtre
 * rapide « Controles » plutot que noye dans le fil. Le statut passe a `failed` quand un gate a
 * bloque — sans quoi un run bloque se lirait comme un run reussi.
 */
export function outcomeToTraceEvent(input: OutcomeTraceInput): TraceEventV1 {
  const lignes = CHAMPS.filter((champ) => input.outcome[champ] !== undefined).map(
    (champ) => `${champ} : ${String(input.outcome[champ])}`
  )
  const gateBloque = input.outcome.gateBlocked === true
  const failed = gateBloque || input.outcome.valid === false || input.outcome.status === 'red'
  const runId = typeof input.outcome.runId === 'string' ? input.outcome.runId : undefined

  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: input.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    parentId: input.parentId,
    timestamp: input.timestamp,
    sequence: input.sequence,
    type: 'gate',
    status: failed ? 'failed' : 'completed',
    actor: { id: 'autowin-orchestration', kind: 'system', label: 'Orchestration Autowin' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    channel: 'internal',
    payloads: [
      {
        kind: 'app-state',
        content: lignes.length > 0 ? lignes.join('\n') : 'issue d’orchestration sans détail'
      }
    ],
    observation: { boundary: 'Autowin orchestration outcome', fidelity: 'exact' },
    ...(runId ? { execution: { runId } } : {})
  })
}

const DECISION_TYPES = new Set<TraceEventV1['type']>([
  'decision',
  'handoff',
  'verdict',
  'gate'
])

/**
 * Persiste l'issue sous le DERNIER choix d'orchestration réellement observé pour ce run. Le lien
 * n'est jamais déduit du texte : runId, phase, provider et modèle viennent des événements natifs.
 */
export function appendObservedOrchestrationOutcome(
  traceStore: TraceStore,
  input: {
    conversationId: string
    turnId: string
    outcome: Record<string, unknown>
    timestamp?: string
  }
): TraceEventV1 {
  const runId = typeof input.outcome.runId === 'string' ? input.outcome.runId : undefined
  const candidates = traceStore
    .readConversation(input.conversationId)
    .filter(
      (event) =>
        event.turnId === input.turnId &&
        DECISION_TYPES.has(event.type) &&
        (!runId || event.execution?.runId === runId || event.run?.runId === runId) &&
        event.observation.boundary !== 'Autowin orchestration outcome'
    )
  const routed = [...candidates]
    .reverse()
    .find((event) => event.provider?.id && (event.execution?.phase || event.type === 'verdict'))
  const parent = routed ?? candidates.at(-1)
  const sequence = traceStore.nextSequence(input.conversationId)
  const event = outcomeToTraceEvent({
    id: `${input.turnId}:outcome:${runId ?? sequence}:${sequence}`,
    conversationId: input.conversationId,
    turnId: input.turnId,
    parentId: parent?.id,
    timestamp: input.timestamp ?? new Date().toISOString(),
    sequence,
    outcome: input.outcome
  })
  traceStore.append(event)
  return event
}
