import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { loadConvActivity, type ConvActivityEntry } from './activity/conv-activity'
import { readBrainTraces, type BrainTrace } from './activity/brain-trace-spool'
import { TraceStore } from './activity/trace-store'
import type { TraceEventV1 } from './activity/trace-event'
import type { Conversation } from './store/conversations'
import { lireSaisies, type SaisieJournalisee } from './store/journal-saisie'

const MESSAGE_LIMIT = 24
const MESSAGE_CAP = 700
const ACTIVITY_LIMIT = 50
const TRACE_LIMIT = 80
const RUN_LIMIT = 4
const RUN_CAP = 4_000
const TOTAL_CAP = 28_000
const REQUEST_CAP = 2_000
const SAISIE_LIMIT = 30
const SAISIE_CAP = 700
/* Marge réservée au champ `troncature`, ajouté APRÈS l'ajustement au budget. */
const TRONCATURE_MARGE = 160

interface KaizenConversation {
  id: string
  title: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>
  runPaths?: string[]
}

/*
  Le lien CAUSAL était perdu : on ne gardait que timestamp/type/status/actor/payload, alors que
  `trace-event.ts` porte le tour, le rang, le parent, la phase d'exécution, les mesures et la
  fidélité de l'observation. Sans eux, impossible de reconstruire l'arbre d'un tour, de dire quelle
  PHASE a fait quoi (les lentilles « routage » et « armement du contrôle » de la skill le réclament),
  ni de savoir qu'une mesure est approchée.
*/
interface KaizenCausalEvent {
  timestamp: string
  type: string
  status: string
  actor: string
  payload: string
  turnId?: string
  sequence?: number
  parentId?: string
  execution?: {
    phase?: string
    agentId?: string
    taskId?: string
    runId?: string
  }
  metrics?: TraceEventV1['metrics']
  observation?: { fidelity?: string; limitation?: string }
}

interface KaizenSaisie {
  ts: number
  voie: string
  texte: string
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
  /** Texte tapé par l'utilisateur, y compris les orientations qui ne créent aucun tour. */
  saisies?: KaizenSaisie[]
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
    ),
    turnId: event.turnId,
    sequence: event.sequence,
    parentId: event.parentId,
    execution: event.execution
      ? {
          phase: event.execution.phase,
          agentId: event.execution.agentId,
          taskId: event.execution.taskId,
          runId: event.execution.runId
        }
      : undefined,
    metrics: event.metrics,
    observation: {
      fidelity: event.observation?.fidelity,
      limitation: event.observation?.limitation
    }
  }
}

function compactSaisie(saisie: SaisieJournalisee): KaizenSaisie {
  return { ts: saisie.ts, voie: saisie.voie, texte: clipped(saisie.texte, SAISIE_CAP) }
}

function readNativeRuns(conversationId: string, appData: string): KaizenRun[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) return []
  const root = join(appData, 'runs', conversationId)
  try {
    if (!existsSync(root)) return []
    /*
      Le tri était ALPHABÉTIQUE (`.sort()`) alors que `slice(-RUN_LIMIT)` prétend garder les
      derniers : les dossiers de run sont nommés d'après le prompt (`frame-…`, `scout-…`), donc
      leur ordre alphabétique n'a aucun rapport avec leur ordre chronologique. Sur conv-105, le
      run le plus ancien (`scout-…`) sortait DERNIER et le plus récent pouvait être jeté, en
      silence. On trie donc sur la date de dernière écriture du RUN.md, puis on rend du plus
      ancien au plus récent pour garder l'ordre de lecture.
    */
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'RUN.md'))
      .filter(existsSync)
      .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
      .slice(-RUN_LIMIT)
      .map(({ path }) => ({ path, content: clipped(readFileSync(path, 'utf8'), RUN_CAP) }))
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
    /*
      Lecture BEST-EFFORT : `readConversation` est la lecture stricte, elle jette sur la première
      ligne abîmée (`trace-store.ts:331`) et le `catch` ci-dessous vidait alors TOUTE la trace
      causale, sans le dire. Kaizen est une vue dérivée : `readConversationBestEffort` ignore la
      seule ligne fautive et garde les autres.
    */
    causalEvents = new TraceStore(
      join(appData, 'causal-trace')
    ).readConversationBestEffort(conversation.id)
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
    runs: readNativeRuns(conversation.id, appData),
    saisies: lireSaisies(conversation.id, appData, SAISIE_LIMIT).map(compactSaisie)
  }
}

interface KaizenSnapshot {
  source: string
  conversation: {
    id: string
    title: string
    messages: Array<{ ts: string; role: string; content: string }>
  }
  activity: Array<Record<string, unknown>>
  brainTraces: BrainTrace[]
  causalEvents: KaizenCausalEvent[]
  runs: KaizenRun[]
  saisies: KaizenSaisie[]
  troncature?: Record<string, number>
}

/*
  Ajuste le dossier AVANT sa mise en JSON. La version précédente coupait le texte final
  (`clipped(body, TOTAL_CAP)`) : la coupe tombait au milieu du JSON, le dossier devenait
  impossible à relire et les deux phrases de consigne, placées en dernier, disparaissaient les
  premières. On retire donc des ÉLÉMENTS entiers, dans la section la plus lourde, jusqu'à tenir.
*/
function ajusterAuBudget(snapshot: KaizenSnapshot, budget: number): Record<string, number> {
  const sections: Array<{ nom: string; liste: unknown[]; retirerEnTete: boolean }> = [
    { nom: 'messages', liste: snapshot.conversation.messages, retirerEnTete: true },
    { nom: 'activity', liste: snapshot.activity, retirerEnTete: true },
    { nom: 'causalEvents', liste: snapshot.causalEvents, retirerEnTete: true },
    { nom: 'runs', liste: snapshot.runs, retirerEnTete: true },
    { nom: 'saisies', liste: snapshot.saisies, retirerEnTete: true },
    // `readBrainTraces` trie du plus récent au plus ancien : ici le plus vieux est en QUEUE.
    { nom: 'brainTraces', liste: snapshot.brainTraces, retirerEnTete: false }
  ]
  const retires: Record<string, number> = {}
  while (JSON.stringify(snapshot).length > budget) {
    const candidates = sections.filter((section) => section.liste.length > 0)
    if (candidates.length === 0) break
    const cible = candidates.reduce((plusLourde, section) =>
      JSON.stringify(section.liste).length > JSON.stringify(plusLourde.liste).length
        ? section
        : plusLourde
    )
    if (cible.retirerEnTete) cible.liste.shift()
    else cible.liste.pop()
    retires[cible.nom] = (retires[cible.nom] ?? 0) + 1
  }
  return retires
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
    text: entry.text,
    /*
      Ces quatre champs étaient ÉCRITS par `conv-activity.ts` puis jetés ici : kaizen ne pouvait
      juger ni le TEMPS d'une phase (`durationMs`, ajouté le 2026-07-29 pour cette question), ni
      l'efficacité du cache, ni recouper un appel compté deux fois (`usageCallId`), ni retrouver la
      preuve visuelle citée (`screenshots`).
    */
    durationMs: entry.durationMs,
    cacheReadTokens: entry.cacheReadTokens,
    usageCallId: entry.usageCallId,
    screenshots: entry.screenshots,
    turnId: entry.turnId,
    phase: entry.phase
  }))
  const snapshot: KaizenSnapshot = {
    source: 'autowin-os',
    conversation: {
      id: evidence.conversation.id,
      title: clipped(evidence.conversation.title, 200),
      messages
    },
    activity,
    brainTraces: evidence.brainTraces.slice(0, 30),
    causalEvents: evidence.causalEvents.slice(-TRACE_LIMIT),
    runs: evidence.runs.slice(-RUN_LIMIT),
    saisies: (evidence.saisies ?? []).slice(-SAISIE_LIMIT)
  }

  const entete = `${clipped(request.trim(), REQUEST_CAP) || '/kaizen'}

=== DOSSIER DE PREUVE AUTOWIN OS ===
`
  const pied =
    `
=== FIN DU DOSSIER ===
` +
    `Audite cette conversation et les mécanismes Autowin qui l'ont produite. ` +
    /*
      Cette phrase ordonnait l'inverse de la phase kaizen elle-même (`phase-briefs.ts` : « les
      éditions elles-mêmes, APPLIQUÉES… kaizen n'attend aucun accord humain »). Lue en DERNIER, elle
      gagnait : l'utilisateur recevait une liste de propositions au lieu de corrections.
    */
    `Applique ensuite toi-même les corrections que les preuves justifient : un commit par édition, ` +
    `annoncé et vérifié par un signal hors-modèle, pour que chacune reste annulable d'un seul revert.`
  const budget = TOTAL_CAP - entete.length - pied.length - TRONCATURE_MARGE
  const retires = ajusterAuBudget(snapshot, budget)
  // Ce qui a été retiré est DIT : un dossier amputé en silence se lit comme un dossier complet.
  if (Object.keys(retires).length > 0) snapshot.troncature = retires

  return `${entete}${JSON.stringify(snapshot)}${pied}`
}
