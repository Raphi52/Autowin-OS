import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { loadConvActivity, type ConvActivityEntry } from './activity/conv-activity'
import { readBrainTraces, type BrainTrace } from './activity/brain-trace-spool'
import { TraceStore } from './activity/trace-store'
import type { TraceEventV1 } from './activity/trace-event'
import type { Conversation } from './store/conversations'

const MESSAGE_LIMIT = 24
const MESSAGE_CAP = 700
const ACTIVITY_LIMIT = 50
const TRACE_LIMIT = 80
const RUN_LIMIT = 4
const RUN_CAP = 4_000
const TOTAL_CAP = 28_000

interface KaizenConversation {
  id: string
  title: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>
  runPaths?: string[]
}

interface KaizenCausalEvent {
  timestamp: string
  type: string
  status: string
  actor: string
  payload: string
}

interface KaizenRun {
  path: string
  content: string
}

export interface AutowinKaizenEvidence {
  conversation: KaizenConversation
  activity: ConvActivityEntry[]
  brainTraces: BrainTrace[]
  causalEvents: KaizenCausalEvent[]
  runs: KaizenRun[]
}

function clipped(value: string, cap: number): string {
  return value.length <= cap ? value : `${value.slice(0, cap)}…[tronqué]`
}

function compactCausalEvent(event: TraceEventV1): KaizenCausalEvent {
  return {
    timestamp: event.timestamp,
    type: event.type,
    status: event.status,
    actor: event.actor.label,
    payload: clipped(
      event.payloads.map((payload) => `${payload.kind}: ${payload.content}`).join(' | '),
      900
    )
  }
}

function readNativeRuns(conversationId: string, appData: string): KaizenRun[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) return []
  const root = join(appData, 'runs', conversationId)
  try {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'RUN.md'))
      .filter(existsSync)
      .sort()
      .slice(-RUN_LIMIT)
      .map((path) => ({ path, content: clipped(readFileSync(path, 'utf8'), RUN_CAP) }))
  } catch {
    return []
  }
}

/** Collecte uniquement les preuves persistées par Autowin OS pour la conversation ciblée. */
export function collectAutowinKaizenEvidence(
  conversation: Conversation,
  appData = ensureAutowinAppData()
): AutowinKaizenEvidence {
  let causalEvents: TraceEventV1[] = []
  try {
    causalEvents = new TraceStore(join(appData, 'causal-trace')).readConversation(conversation.id)
  } catch {
    causalEvents = []
  }

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      messages: conversation.messages.map(({ role, content, ts }) => ({ role, content, ts })),
      runPaths: conversation.runPaths
    },
    activity: loadConvActivity(conversation.id, join(appData, 'activity')),
    brainTraces: readBrainTraces(conversation.id, appData),
    causalEvents: causalEvents.slice(-TRACE_LIMIT).map(compactCausalEvent),
    // `conversation.runPaths` contient des pièces externes attachées manuellement (historiquement
    // des RUN Claude). Kaizen les ignore intégralement et ne lit que les RUN natifs d'Autowin.
    runs: readNativeRuns(conversation.id, appData)
  }
}

/** Transforme /kaizen en dossier de preuve borné, sans source ni instruction Claude. */
export function buildAutowinKaizenTask(request: string, evidence: AutowinKaizenEvidence): string {
  const messages = evidence.conversation.messages.slice(-MESSAGE_LIMIT).map((message) => ({
    ts: new Date(message.ts).toISOString(),
    role: message.role,
    content: clipped(message.content, MESSAGE_CAP)
  }))
  const activity = evidence.activity.slice(-ACTIVITY_LIMIT).map((entry) => ({
    ts: entry.ts,
    kind: entry.kind,
    label: entry.label,
    provider: entry.provider,
    model: entry.model,
    reasoningEffort: entry.reasoningEffort,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    costUsd: entry.costUsd,
    text: entry.text
  }))
  const snapshot = {
    source: 'autowin-os',
    conversation: {
      id: evidence.conversation.id,
      title: evidence.conversation.title,
      messages
    },
    activity,
    brainTraces: evidence.brainTraces.slice(0, 30),
    causalEvents: evidence.causalEvents.slice(-TRACE_LIMIT),
    runs: evidence.runs.slice(-RUN_LIMIT)
  }
  const body =
    `${request.trim() || '/kaizen'}\n\n` +
    `=== DOSSIER DE PREUVE AUTOWIN OS ===\n${JSON.stringify(snapshot)}\n` +
    `=== FIN DU DOSSIER ===\n` +
    `Audite cette conversation et les mécanismes Autowin qui l'ont produite. ` +
    `Reste strictement en lecture seule et rends uniquement des propositions vérifiables à faire approuver.`
  return clipped(body, TOTAL_CAP)
}
