import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { loadConvActivity, type ConvActivityEntry } from './activity/conv-activity'
import { readBrainTraces, type BrainTrace } from './activity/brain-trace-spool'
import { TraceStore } from './activity/trace-store'
import { loadPromptCalls } from './activity/prompt-observability'
import { readConversationTurnJournals } from './runs/turn-journal'
import type { TraceEventV1 } from './activity/trace-event'
import type { Conversation } from './store/conversations'
import { lireSaisies, type SaisieJournalisee } from './store/journal-saisie'

const MESSAGE_LIMIT = 24
const MESSAGE_CAP = 700
const ACTIVITY_LIMIT = 50
const TRACE_LIMIT = 80
const RUN_LIMIT = 4
const RUN_CAP = 4_000
/*
  Plancher de RÉSUMÉ d'un RUN. Mesuré sur le dossier réel de conv-105 : `runs: 0` et
  `troncature.runs = 4` — les QUATRE RUN.md partaient en entier, kaizen n'en voyait AUCUN. Cause :
  l'ajustement au budget ne savait que SUPPRIMER un élément, jamais le RACCOURCIR, et un RUN de
  4 000 signes est le plus lourd du dossier, donc le premier sacrifié. On le résume jusqu'à ce
  plancher avant d'envisager de le retirer.
*/
const RUN_MIN = 1_200
const TOTAL_CAP = 28_000
const REQUEST_CAP = 2_000
const PROMPT_CALL_LIMIT = 12
const PROMPT_CALL_CAP = 600
const TURN_JOURNAL_LIMIT = 3
const TURN_EVENT_LIMIT = 40
/**
 * Plafond GLOBAL du deroule des tours reunis. Il DOIT valoir le plafond par tour multiplie par le
 * nombre de tours joints : le meme chiffre applique deux fois (une fois par tour, puis une fois sur
 * l'ensemble) rabotait les tours les plus anciens, si bien qu'un dossier annoncant 3 tours n'en
 * montrait qu'un (mesure du 2026-09-02, conv-131).
 */
const TURN_EVENT_TOTAL_LIMIT = TURN_JOURNAL_LIMIT * TURN_EVENT_LIMIT
const TURN_EVENT_CAP = 400
const SAISIE_LIMIT = 30
const SAISIE_CAP = 700
/*
  DEUX REGIMES DE LECTURE. Les plafonds ci-dessus sont taillés pour le dossier INJECTÉ dans un run
  `/kaizen`, qui doit tenir dans TOTAL_CAP (28 000 signes). L'outil `retrospective`, lui, ne part
  dans aucun prompt de sous-agent : il est rendu à l'agent qui LIT. Lui appliquer le budget d'un
  prompt le faisait mentir par omission — 80 événements causaux sur des milliers, 4 RUN.md sur
  douze, 3 tours de journal — alors que l'utilisateur demande précisément ce qui s'est passé.
  Le régime `ample` relève chaque plafond d'un ordre de grandeur ; le régime par défaut est inchangé.
*/
export interface PlafondsKaizen {
  trace: number
  runs: number
  runCap: number
  promptCalls: number
  promptCallCap: number
  turnJournals: number
  turnEvents: number
  turnEventCap: number
  saisies: number
  saisieCap: number
  tracePayloadCap: number
}

export const PLAFONDS_KAIZEN: PlafondsKaizen = {
  trace: TRACE_LIMIT,
  runs: RUN_LIMIT,
  runCap: RUN_CAP,
  promptCalls: PROMPT_CALL_LIMIT,
  promptCallCap: PROMPT_CALL_CAP,
  turnJournals: TURN_JOURNAL_LIMIT,
  turnEvents: TURN_EVENT_LIMIT,
  turnEventCap: TURN_EVENT_CAP,
  saisies: SAISIE_LIMIT,
  saisieCap: SAISIE_CAP,
  tracePayloadCap: 900
}

export const PLAFONDS_AMPLES: PlafondsKaizen = {
  trace: 2_000,
  runs: 20,
  runCap: 60_000,
  promptCalls: 200,
  promptCallCap: 6_000,
  turnJournals: 30,
  turnEvents: 400,
  turnEventCap: 4_000,
  saisies: 300,
  saisieCap: 4_000,
  tracePayloadCap: 6_000
}

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

/*
  Ce qui est REELLEMENT parti au modele. La skill le declare source de premiere main, mais il
  n'etait jamais joint : c'est le seul journal qui porte la phase reelle, le modele resolu, l'etat
  d'echec et le message d'erreur d'un appel.
*/
interface KaizenPromptCall {
  ts: string
  turnId: string
  iteration: number
  actor: string
  phase?: string
  provider: string
  model?: string
  resolvedModel?: string
  status?: string
  error?: string
  durationMs?: number
  boundary: string
  limitation: string
  response: string
}

/** Le deroule brut d'un tour (deltas, commandes, resultats) — la survie niveau 2 du chat. */
interface KaizenTurnEvent {
  turnId: string
  kind: string
  payload: string
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
  promptCalls?: KaizenPromptCall[]
  turnEvents?: KaizenTurnEvent[]
  /** Texte tapé par l'utilisateur, y compris les orientations qui ne créent aucun tour. */
  saisies?: KaizenSaisie[]
}

const SUFFIXE_TRONQUE = '…[tronqué]'.length

function clipped(value: string, cap: number): string {
  return value.length <= cap ? value : `${value.slice(0, cap)}…[tronqué]`
}

function compactCausalEvent(event: TraceEventV1, cap = 900): KaizenCausalEvent {
  return {
    timestamp: event.timestamp,
    type: event.type,
    status: event.status,
    actor: event.actor.label,
    payload: clipped(
      event.payloads.map((payload) => `${payload.kind}: ${payload.content}`).join(' | '),
      cap
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

function compactSaisie(saisie: SaisieJournalisee, cap = SAISIE_CAP): KaizenSaisie {
  return { ts: saisie.ts, voie: saisie.voie, texte: clipped(saisie.texte, cap) }
}

function readNativeRuns(
  conversationId: string,
  appData: string,
  plafonds: PlafondsKaizen = PLAFONDS_KAIZEN
): KaizenRun[] {
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
      .slice(-plafonds.runs)
      .map(({ path }) => ({ path, content: clipped(readFileSync(path, 'utf8'), plafonds.runCap) }))
  } catch {
    return []
  }
}

/*
  SELECTION des appels modele retenus dans le dossier. Mesure sur les appels REELS de conv-105
  (`prompt-observability/conv-105.jsonl`, 2026-09-02) : 30 appels enregistres, dont DEUX echoues en
  position 6 et 7 — `subagent/build` coupe sur « You've hit your session limit », puis
  l'orchestrateur sur `error_during_execution`. La fenetre purement chronologique (les 12 derniers,
  index 18 a 29) n'en contenait AUCUN : kaizen recevait un dossier ou tout s'etait bien passe,
  alors que la panne a expliquer est precisement la. On reserve donc la place aux appels NON
  aboutis — les plus recents d'abord s'ils depassent la limite — puis on complete avec les appels
  les plus recents, et on rend le tout en ordre chronologique.
*/
function appelModeleEchoue(call: { status?: string; error?: string }): boolean {
  return (
    (typeof call.status === 'string' && call.status !== 'completed') ||
    (typeof call.error === 'string' && call.error.trim().length > 0)
  )
}

export function selectionnerAppelsModele<T extends { status?: string; error?: string }>(
  calls: T[],
  limite = PROMPT_CALL_LIMIT
): T[] {
  if (limite <= 0) return []
  if (calls.length <= limite) return [...calls]
  const echoue = appelModeleEchoue
  const index = calls.map((_, position) => position)
  const retenus = new Set(index.filter((position) => echoue(calls[position])).slice(-limite))
  for (const position of [...index].reverse()) {
    if (retenus.size >= limite) break
    retenus.add(position)
  }
  return index.filter((position) => retenus.has(position)).map((position) => calls[position])
}

function readPromptCalls(
  conversationId: string,
  appData: string,
  plafonds: PlafondsKaizen = PLAFONDS_KAIZEN
): KaizenPromptCall[] {
  try {
    return selectionnerAppelsModele(
      loadPromptCalls(conversationId, join(appData, 'prompt-observability')),
      plafonds.promptCalls
    ).map((call) => ({
      ts: call.ts,
      turnId: call.turnId,
      iteration: call.iteration,
      actor: call.actor,
      phase: call.phase,
      provider: call.provider,
      model: call.model,
      resolvedModel: call.resolvedModel,
      status: call.status,
      error: call.error ? clipped(call.error, plafonds.promptCallCap) : undefined,
      durationMs: call.durationMs,
      boundary: call.boundary,
      limitation: call.limitation,
      response: clipped(call.response ?? '', plafonds.promptCallCap)
    }))
  } catch {
    return []
  }
}

function readTurnEvents(
  conversationId: string,
  appData: string,
  plafonds: PlafondsKaizen = PLAFONDS_KAIZEN
): KaizenTurnEvent[] {
  try {
    return readConversationTurnJournals(
      join(appData, 'turn-journals'),
      conversationId,
      plafonds.turnJournals
    )
      .flatMap(({ turnId, events }) =>
        events.slice(-plafonds.turnEvents).map((event) => {
          const { kind, ...reste } = event
          return {
            turnId,
            kind: String(kind),
            payload: clipped(JSON.stringify(reste), plafonds.turnEventCap)
          }
        })
      )
      .slice(-(plafonds.turnJournals * plafonds.turnEvents))
  } catch {
    return []
  }
}

/** Collecte uniquement les preuves persistées par Autowin OS pour la conversation ciblée. */
export function collectAutowinKaizenEvidence(
  conversation: Conversation,
  appData = ensureAutowinAppData(),
  plafonds: PlafondsKaizen = PLAFONDS_KAIZEN
): AutowinKaizenEvidence {
  let causalEvents: TraceEventV1[] = []
  try {
    /*
      Lecture BEST-EFFORT : `readConversation` est la lecture stricte, elle jette sur la première
      ligne abîmée (`trace-store.ts:331`) et le `catch` ci-dessous vidait alors TOUTE la trace
      causale, sans le dire. Kaizen est une vue dérivée : `readConversationBestEffort` ignore la
      seule ligne fautive et garde les autres.
    */
    causalEvents = new TraceStore(join(appData, 'causal-trace')).readConversationBestEffort(
      conversation.id
    )
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
    causalEvents: causalEvents
      .slice(-plafonds.trace)
      .map((event) => compactCausalEvent(event, plafonds.tracePayloadCap)),
    // `conversation.runPaths` contient des pièces externes attachées manuellement (historiquement
    // des RUN Claude). Kaizen les ignore intégralement et ne lit que les RUN natifs d'Autowin.
    runs: readNativeRuns(conversation.id, appData, plafonds),
    promptCalls: readPromptCalls(conversation.id, appData, plafonds),
    turnEvents: readTurnEvents(conversation.id, appData, plafonds),
    saisies: lireSaisies(conversation.id, appData, plafonds.saisies).map((saisie) =>
      compactSaisie(saisie, plafonds.saisieCap)
    )
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
  promptCalls: KaizenPromptCall[]
  turnEvents: KaizenTurnEvent[]
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
  /*
    `protege` = element sacrifie EN DERNIER dans sa section. Mesure sur le dossier reel de conv-105 :
    les deux appels modele ECHOUES (`subagent/build` coupe sur « session limit », puis
    l'orchestrateur) etaient les plus ANCIENS des 12 retenus, et le budget retire par la tete — 9
    des 12 partaient, dont les deux echecs. Kaizen recevait donc un dossier sans aucune panne,
    alors que la panne est ce qu'il doit expliquer. Un appel non abouti ne cede sa place qu'apres
    tous les appels reussis de la meme section.
  */
  const sections: Array<{
    nom: string
    liste: unknown[]
    retirerEnTete: boolean
    protege?: (element: unknown) => boolean
  }> = [
    { nom: 'messages', liste: snapshot.conversation.messages, retirerEnTete: true },
    { nom: 'activity', liste: snapshot.activity, retirerEnTete: true },
    { nom: 'causalEvents', liste: snapshot.causalEvents, retirerEnTete: true },
    { nom: 'runs', liste: snapshot.runs, retirerEnTete: true },
    { nom: 'saisies', liste: snapshot.saisies, retirerEnTete: true },
    { nom: 'turnEvents', liste: snapshot.turnEvents, retirerEnTete: true },
    {
      nom: 'promptCalls',
      liste: snapshot.promptCalls,
      retirerEnTete: true,
      protege: (element) => appelModeleEchoue(element as KaizenPromptCall)
    },
    // `readBrainTraces` trie du plus récent au plus ancien : ici le plus vieux est en QUEUE.
    { nom: 'brainTraces', liste: snapshot.brainTraces, retirerEnTete: false }
  ]
  const retires: Record<string, number> = {}
  /* Rang du prochain sacrifie : le premier (ou dernier) NON protege, sinon le bord habituel. */
  const rangProchain = (section: (typeof sections)[number]): number => {
    if (section.liste.length === 0) return -1
    const ordre = section.retirerEnTete
      ? section.liste.map((_, rang) => rang)
      : section.liste.map((_, rang) => section.liste.length - 1 - rang)
    const libre = ordre.find((rang) => !section.protege?.(section.liste[rang]))
    return libre ?? ordre[0]
  }
  const prochainElement = (section: (typeof sections)[number]): unknown =>
    section.liste[rangProchain(section)]
  const poidsElement = (section: (typeof sections)[number]): number =>
    JSON.stringify(prochainElement(section) ?? null).length + 1
  /*
    Un RUN se RÉSUME avant de se perdre : on raccourcit le plus long jusqu'au plancher `RUN_MIN`
    tant que ça suffit à rentrer dans le budget. Sans cette passe, les 4 RUN de conv-105 étaient
    tous supprimés.
  */
  for (;;) {
    const depassement = JSON.stringify(snapshot).length - budget
    if (depassement <= 0) break
    const plusLong = snapshot.runs
      .filter((run) => run.content.length > RUN_MIN)
      .reduce<KaizenRun | undefined>(
        (max, run) => (!max || run.content.length > max.content.length ? run : max),
        undefined
      )
    if (!plusLong) break
    /*
      `clipped` AJOUTE un suffixe « …[tronqué] ». Couper à `longueur - dépassement` avec un
      dépassement plus petit que ce suffixe RALLONGEAIT le RUN : la boucle ne terminait jamais
      (vitest bloqué à 120 s, mesuré). On retranche donc le suffixe, et on ne coupe que si la
      coupe raccourcit vraiment.
    */
    const cible = Math.max(RUN_MIN, plusLong.content.length - depassement - SUFFIXE_TRONQUE)
    if (cible + SUFFIXE_TRONQUE >= plusLong.content.length) break
    plusLong.content = clipped(plusLong.content, cible)
  }

  for (;;) {
    const depassement = JSON.stringify(snapshot).length - budget
    if (depassement <= 0) break
    const nonVides = sections.filter((section) => section.liste.length > 0)
    if (nonVides.length === 0) break
    /*
      Un RUN déjà résumé au plancher se retire en DERNIER : c'est la trace la plus dense d'un run
      précédent, et un élément RUN (1 210 signes) devenait « le plus léger qui suffit » dès que le
      dépassement dépassait le poids d'une ligne d'activité — on perdait un RUN pour 300 signes.
      Les autres sections sont bien plus redondantes entre elles.
    */
    const sansRuns = nonVides.filter((section) => section.nom !== 'runs')
    const candidates = sansRuns.length > 0 ? sansRuns : nonVides
    /*
      Mesure sur conv-105 : 23 870 signes retenus sur 28 000, un RUN entier jeté pour un
      dépassement de quelques signes — un RUN pèse jusqu'à 4 000 signes, donc viser la section la
      plus LOURDE emportait 4 000 signes de budget avec lui. Dès qu'un SEUL retrait suffit à
      rentrer dans le budget, on prend le MOINS lourd de ceux-là ; sinon on continue d'alléger la
      section la plus lourde, qui est le seul moyen de progresser vite.
    */
    const suffisants = candidates.filter((section) => poidsElement(section) >= depassement)
    const cible = suffisants.length
      ? suffisants.reduce((plusLeger, section) =>
          poidsElement(section) < poidsElement(plusLeger) ? section : plusLeger
        )
      : candidates.reduce((plusLourde, section) =>
          JSON.stringify(section.liste).length > JSON.stringify(plusLourde.liste).length
            ? section
            : plusLourde
        )
    cible.liste.splice(rangProchain(cible), 1)
    retires[cible.nom] = (retires[cible.nom] ?? 0) + 1
  }
  return retires
}

const MARQUEUR_DEBUT = '=== DOSSIER DE PREUVE AUTOWIN OS ==='
const MARQUEUR_FIN = '=== FIN DU DOSSIER ==='

export interface AppuiSourcesNeuves {
  /** Le contrôle a-t-il un sens ici : tâche kaizen AVEC un dossier qui porte au moins une des 3 sources. */
  applicable: boolean
  /** Les identifiants réellement présents dans le dossier, donc citables. */
  identifiants: string[]
  /** Ceux que le rendu cite. */
  cites: string[]
  /** Applicable et aucune citation → le rendu ne s'appuie sur aucune source neuve. */
  manque: boolean
  motif?: string
}

/*
  Le dossier joint peut CONTENIR le marqueur de fin (un message de la conversation qui le recopie —
  cas reel : la conversation qui parle de ce dossier). Prendre la PREMIERE occurrence cassait alors
  la lecture, et le controle se desactivait sans le dire. On essaie donc les occurrences de la plus
  tardive vers la plus precoce, jusqu'a une lecture valide.
*/
function lireDossierJoint(task: string): Partial<KaizenSnapshot> | undefined {
  const debut = task.indexOf(MARQUEUR_DEBUT)
  if (debut < 0) return undefined
  const corps = debut + MARQUEUR_DEBUT.length
  for (
    let fin = task.lastIndexOf(MARQUEUR_FIN);
    fin > corps;
    fin = task.lastIndexOf(MARQUEUR_FIN, fin - 1)
  ) {
    try {
      return JSON.parse(task.slice(corps, fin).trim()) as KaizenSnapshot
    } catch {
      continue
    }
  }
  return undefined
}

/*
  Un identifiant de tour se cite ABREGE, comme un commit : le controle final a refuse un rapport qui
  citait `9e9b58cc` pour le tour `9e9b58cc-0a65-499a-8fdf-7613ca85a0d1`. On compare donc sur les 8
  premiers signes des identifiants en forme d'UUID — assez pour designer un tour, trop long pour
  matcher par hasard. Les horodatages de saisie, eux, restent compares en entier.
*/
function abreger(identifiant: string): string {
  return /^[0-9a-f]{8}-/i.test(identifiant) ? identifiant.slice(0, 8) : identifiant
}

/*
  CONTRÔLE HORS MODÈLE de l'exigence écrite dans le pied du dossier. Pur : la tâche porte le dossier
  (JSON entre les deux marqueurs), le rendu est le texte produit. On ne juge PAS la pertinence de la
  correction — seulement qu'un identifiant RÉEL des trois sources neuves est cité. Non applicable
  hors kaizen, et non applicable si le dossier ne contient aucune de ces trois sources (rien à
  citer : bloquer serait un faux refus).
*/
export function exigenceAppuiSourcesNeuves(task: string, sortie: string): AppuiSourcesNeuves {
  const vide: AppuiSourcesNeuves = { applicable: false, identifiants: [], cites: [], manque: false }
  const snapshot = lireDossierJoint(task)
  if (!snapshot) return vide
  const identifiants = [
    ...(snapshot.promptCalls ?? []).map((call) => call.turnId),
    ...(snapshot.turnEvents ?? []).map((event) => event.turnId),
    ...(snapshot.saisies ?? []).map((saisie) => String(saisie.ts))
  ].filter((valeur): valeur is string => typeof valeur === 'string' && valeur.trim().length > 0)
  const uniques = [...new Set(identifiants)]
  if (uniques.length === 0) return vide
  const cites = uniques.filter((identifiant) => sortie.includes(abreger(identifiant)))
  return {
    applicable: true,
    identifiants: uniques,
    cites,
    manque: cites.length === 0,
    motif:
      cites.length === 0
        ? `aucune correction ne cite un appel modèle, un tour ou une saisie du dossier (${uniques.length} identifiant(s) citable(s), ex. ${uniques[0]})`
        : undefined
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
    promptCalls: (evidence.promptCalls ?? []).slice(-PROMPT_CALL_LIMIT),
    turnEvents: (evidence.turnEvents ?? []).slice(-TURN_EVENT_TOTAL_LIMIT),
    saisies: (evidence.saisies ?? []).slice(-SAISIE_LIMIT)
  }

  const entete = `${clipped(request.trim(), REQUEST_CAP) || '/kaizen'}

${MARQUEUR_DEBUT}
`
  const pied =
    `
${MARQUEUR_FIN}
` +
    `Audite cette conversation et les mécanismes Autowin qui l'ont produite. ` +
    /*
      Cette phrase ordonnait l'inverse de la phase kaizen elle-même (`phase-briefs.ts` : « les
      éditions elles-mêmes, APPLIQUÉES… kaizen n'attend aucun accord humain »). Lue en DERNIER, elle
      gagnait : l'utilisateur recevait une liste de propositions au lieu de corrections.
    */
    `Applique ensuite toi-même les corrections que les preuves justifient : un commit par édition, ` +
    `annoncé et vérifié par un signal hors-modèle, pour que chacune reste annulable d'un seul revert.` +
    /*
      Cette phrase était ABSENTE, et le défaut a été mesuré sur conv-105 : le dossier joignait bien
      les appels modèle, le journal des tours et les saisies, mais les corrections rendues portaient
      toutes sur le mécanisme qui FABRIQUE le dossier — aucune sur un fait lu dedans. L'exigence est
      posée ici (l'en-tête et le pied sont déduits du budget AVANT l'ajustement : ils ne sont jamais
      rognés) et elle est CONTRÔLÉE hors modèle par `exigenceAppuiSourcesNeuves`, parce qu'une
      exigence seulement écrite avait déjà été écrite, puis non tenue.
    */
    ` AU MOINS UNE de ces corrections doit s'appuyer sur les appels modèle (promptCalls), le ` +
    `journal des tours (turnEvents) ou les saisies (saisies) de ce dossier, et CITER l'identifiant ` +
    `exact qui l'établit : le \`turnId\` de l'appel ou du tour, ou l'horodatage \`ts\` de la saisie. ` +
    `Sans cette citation, un contrôle hors modèle refuse le rendu.`
  const budget = TOTAL_CAP - entete.length - pied.length - TRONCATURE_MARGE
  const retires = ajusterAuBudget(snapshot, budget)
  // Ce qui a été retiré est DIT : un dossier amputé en silence se lit comme un dossier complet.
  if (Object.keys(retires).length > 0) snapshot.troncature = retires

  return `${entete}${JSON.stringify(snapshot)}${pied}`
}
