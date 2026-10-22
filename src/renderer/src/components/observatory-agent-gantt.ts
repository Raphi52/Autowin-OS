import type { HarnessTimelineEvent } from './harness-timeline-model'

/**
 * DÉROULÉ PAR AGENT de la Chronologie Observatory — demande utilisateur du 2026-10-11 (conv-232) :
 * « j'aimerais une vue comme ça dans observatory chronology », capture à l'appui d'un diagramme en
 * barres — une ligne par agent (orchestrateur, scout-1, judge-2…), une barre par exécution posée
 * sur un axe en minutes, le refus du juge en rouge, une bulle au survol (modèle, tokens, coût,
 * durée, motif).
 *
 * Ce module ne fait que LIRE la trace causale. Forme réelle mesurée sur `causal-trace/conv-222`
 * et `conv-106` :
 *  - une exécution d'agent s'ouvre par un `handoff`/`verdict` au statut `running` (« exec
 *    démarré », « judge démarré ») portant `execution.agentId` ;
 *  - elle se ferme par un `handoff`/`verdict` `completed` (ou `failed`) qui porte `metrics.durationMs`,
 *    DOUBLÉ d'un `model-response` aux métriques identiques — d'où la fusion par durée ci-dessous,
 *    sans laquelle chaque barre serait dessinée deux fois ;
 *  - le refus d'un juge n'est PAS dans son statut (toujours `completed`) : il est dans le `gate` dont
 *    le `parentId` désigne ce verdict et dont le texte commence par « BLOQUÉ ».
 * La barre va donc de `fin − durée` à `fin`. Une ouverture sans fin tracée reste une barre « sans fin
 * tracée » : on ne devine ni une durée ni un succès.
 */

export type AgentSpanStatus = 'ok' | 'refused' | 'failed' | 'open'

export interface AgentSpan {
  /** Identifiant stable de la barre (événement de fin, ou ouverture pour une barre sans fin). */
  id: string
  /** Événement à ouvrir au clic : le verdict, sinon la délégation, sinon la réponse. */
  eventId: string
  start: number
  end: number
  durationMs: number
  status: AgentSpanStatus
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  /** Actions réelles (appels d'outil) de cet agent pendant la barre. */
  actions: number
  /** Début de ce que l'agent a rendu, ou le motif du refus / de l'échec. */
  summary: string
}

/**
 * Durée du TOUR entier vue par le superviseur d'exécution (`chat-usage-settlement.ts`) : pendant un
 * run, l'orchestrateur ne répond pas — il attend ses agents. Sans cette enveloppe, sa ligne serait
 * vide sur toute la durée du run, alors que c'est lui qui le tient.
 */
export interface AgentEnvelope {
  eventId: string
  start: number
  end: number
  durationMs: number
  status: 'ok' | 'failed' | 'cancelled' | 'open'
}

export interface AgentLane {
  key: string
  /** Phase du pipeline (`scout`, `judge`…) ou `orchestrator` : elle donne la couleur. */
  phase: string
  label: string
  /** Variante de l'agent (`dette`, `synthesis`…), absente pour `subagent`/`single`. */
  variant?: string
  model?: string
  /**
   * Sous-titre de la ligne quand ce n'est pas un modèle : une ligne d'OUTIL (`outil · 3 appels`),
   * qui n'a pas de modèle à afficher (conv-1105).
   */
  detail?: string
  /** Seulement sur la ligne de l'orchestrateur : le tour entier, sous ses propres réponses. */
  envelope?: AgentEnvelope
  spans: AgentSpan[]
}

export interface AgentGanttTick {
  at: number
  /** Position sur l'axe, de 0 à 100. */
  percent: number
  label: string
}

export interface AgentGantt {
  start: number
  end: number
  lanes: AgentLane[]
  ticks: AgentGanttTick[]
}

/** Écart toléré entre deux fins d'une même exécution (délégation + réponse : quelques ms). */
const SAME_EXECUTION_MS = 5_000
/** Une ouverture est « honorée » par une barre qui commence au plus tant après elle. */
const OPEN_MATCH_MS = 10_000

const ORCHESTRATOR = 'orchestrator'
const END_KINDS = new Set<HarnessTimelineEvent['kind']>([
  'handoff',
  'verdict',
  'model-response',
  'error'
])
const START_KINDS = new Set<HarnessTimelineEvent['kind']>(['handoff', 'verdict'])
/** Variantes qui ne disent rien de plus que la phase elle-même. */
const SILENT_VARIANTS = new Set(['subagent', 'single'])

function time(event: HarnessTimelineEvent): number | null {
  if (!event.timestamp) return null
  const value = Date.parse(event.timestamp)
  return Number.isFinite(value) ? value : null
}

/** Couloir d'un événement : l'agent d'exécution, ou l'orchestrateur pour ses propres réponses. */
function laneKeyOf(event: HarnessTimelineEvent): string | null {
  const agentId = event.execution?.agentId
  if (agentId) return agentId
  if (event.kind === 'model-response') return ORCHESTRATOR
  return null
}

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5` ; sinon inchangé. */
export function shortModelName(model: string | undefined): string | undefined {
  if (!model) return undefined
  const match = /^claude-([a-z]+)-(\d{1,2}(?:-\d{1,2})*)(?:-\d{8})?$/i.exec(model)
  if (!match) return model
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  return `${family} ${match[2].split('-').join('.')}`
}

function firstLine(text: string, max = 160): string {
  const line =
    text
      .split('\n')
      .map((part) => part.replace(/[#*`>]/g, '').trim())
      .find((part) => part.length > 0) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const OBJECTION = /«\s*Objection du juge\s*:\s*/g

/**
 * Motif d'un contrôle bloquant, lisible d'un coup d'œil. Deux formes réelles relevées dans les
 * traces (`stopgate.ts`) : « BLOQUÉ: Promis mais pas fait : « Objection du juge : X », « Objection
 * du juge : Y » » — on rend X, plus le nombre d'objections restantes —, et « BLOQUÉ: Promis mais pas
 * fait : 1 point(s) annoncé(s)… », rendue telle quelle sans son préfixe « BLOQUÉ: ».
 */
export function blockedReason(
  gate: Pick<HarnessTimelineEvent, 'content'> | undefined
): string | null {
  if (!gate) return null
  const text = gate.content.trim()
  if (!/^bloqu/i.test(text)) return null
  const reason = text.replace(/^bloqu[ée]+\s*:?\s*/i, '')
  const count = reason.match(OBJECTION)?.length ?? 0
  if (count === 0) return firstLine(reason, 220)
  // L'objection peut citer entre « » : elle s'arrête au » suivi d'une autre objection, ou à la fin.
  const first = /«\s*Objection du juge\s*:\s*([\s\S]+?)\s*»\s*(?:,\s*«\s*Objection du juge|$)/.exec(
    reason
  )?.[1]
  if (!first) return firstLine(reason, 220)
  const rest = count - 1
  return `${firstLine(first, 200)}${rest > 0 ? ` (+ ${rest} autre${rest > 1 ? 's' : ''} objection${rest > 1 ? 's' : ''})` : ''}`
}

const PRIORITY: Record<string, number> = { verdict: 0, handoff: 1, error: 2, 'model-response': 3 }

interface Draft {
  events: HarnessTimelineEvent[]
  end: number
  durationMs: number
}

function buildLaneSpans(
  laneEvents: HarnessTimelineEvent[],
  gatesByParent: Map<string, HarnessTimelineEvent>,
  turnEnd: number
): AgentSpan[] {
  const drafts: Draft[] = []
  for (const event of laneEvents) {
    const end = time(event)
    if (end == null || event.durationMs == null || !END_KINDS.has(event.kind)) continue
    if (event.status === 'running') continue
    const twin = drafts.find(
      (draft) =>
        Math.abs(draft.durationMs - event.durationMs!) < 1 &&
        Math.abs(draft.end - end) <= SAME_EXECUTION_MS
    )
    if (twin) {
      twin.events.push(event)
      twin.end = Math.max(twin.end, end)
    } else drafts.push({ events: [event], end, durationMs: event.durationMs })
  }

  const spans: AgentSpan[] = drafts.map((draft) => {
    const ordered = [...draft.events].sort(
      (a, b) => (PRIORITY[a.kind] ?? 9) - (PRIORITY[b.kind] ?? 9)
    )
    const main = ordered[0]
    const withMetrics = ordered.find((event) => event.outputTokens != null) ?? main
    const failed = ordered.find((event) => event.kind === 'error' || event.status === 'failed')
    const refusal = ordered
      .map((event) => blockedReason(gatesByParent.get(event.id)))
      .find((reason): reason is string => Boolean(reason))
    const response =
      ordered.find((event) => event.kind === 'model-response' || event.kind === 'verdict') ?? main
    const start = draft.end - draft.durationMs
    return {
      id: main.id,
      eventId: main.id,
      start,
      end: draft.end,
      durationMs: draft.durationMs,
      status: failed ? 'failed' : refusal ? 'refused' : 'ok',
      model: ordered.find((event) => event.model)?.model,
      inputTokens: withMetrics.inputTokens,
      outputTokens: withMetrics.outputTokens,
      costUsd: withMetrics.costUsd,
      actions: 0,
      summary: failed ? firstLine(failed.content, 220) : (refusal ?? firstLine(response.content))
    }
  })

  // Ouvertures sans fin : un agent démarré dont aucune barre ne prend la suite.
  const starts = laneEvents
    .filter((event) => START_KINDS.has(event.kind) && event.status === 'running')
    .map((event) => ({ event, at: time(event) }))
    .filter((item): item is { event: HarnessTimelineEvent; at: number } => item.at != null)
    .sort((a, b) => a.at - b.at)
  const used = new Set<AgentSpan>()
  for (const [index, { event, at }] of starts.entries()) {
    // Entre deux départs du même agent, une seule fin : la barre qui commence AVANT le départ
    // suivant appartient à celui-ci. Sinon, ce départ n'a jamais rendu.
    const nextStart = starts[index + 1]?.at ?? Number.POSITIVE_INFINITY
    const honoured = spans
      .filter((span) => !used.has(span) && span.start >= at - OPEN_MATCH_MS)
      .sort((a, b) => a.start - b.start)[0]
    // Marge d'une seconde : la barre du départ SUIVANT commence à quelques ms de lui, parfois avant.
    if (honoured && honoured.start < nextStart - 1_000) {
      used.add(honoured)
      continue
    }
    const end = Math.max(at, turnEnd)
    spans.push({
      id: event.id,
      eventId: event.id,
      start: at,
      end,
      durationMs: end - at,
      status: 'open',
      model: event.model,
      actions: 0,
      summary: 'Aucune fin tracée : en cours, ou interrompu avant de rendre.'
    })
  }

  // Actions réelles : les appels d'outil du même agent qui tombent dans la barre. Ils sont écrits
  // dans la trace À LA FIN de l'agent, quelques ms APRÈS sa délégation terminée (mesuré sur
  // conv-222 : fin 21:35:00.148, outils 21:35:00.150 → .160) — d'où la tolérance après la fin.
  const toolTimes = laneEvents
    .filter((event) => event.kind === 'tool-call')
    .map(time)
    .filter((at): at is number => at != null)
  for (const span of spans)
    span.actions = toolTimes.filter(
      (at) => at >= span.start && at <= span.end + SAME_EXECUTION_MS
    ).length

  return spans.sort((a, b) => a.start - b.start)
}

/**
 * LIGNES D'OUTILS (conv-1105) : « observatory doit ressembler au graph timeline des bilans de runs ».
 * Un tour de chat n'a qu'un agent, l'orchestrateur ; ce sont ses OUTILS qui font le déroulé. Seuls
 * ses propres appels ont une ligne : ceux d'un agent de run restent comptés dans SA barre (actions).
 */
const OUTIL = 'outil'
const OUTIL_PREFIXE = `${OUTIL}:`

function nomDOutil(event: HarnessTimelineEvent): string | null {
  if (event.kind !== 'tool-call' || event.execution?.agentId) return null
  const nom =
    event.recipient ?? event.payloads.find((payload) => payload.kind === 'tool-call')?.name
  return nom?.trim() || null
}

/** Champs d'entrée qui disent ce que l'appel FAIT, du plus parlant au moins parlant. */
const CHAMPS_PARLANTS = [
  'description',
  'command',
  'file_path',
  'pattern',
  'query',
  'question',
  'path',
  'url'
] as const

function resumeDAppel(event: HarnessTimelineEvent): string {
  const brut =
    event.payloads.find((payload) => payload.kind === 'tool-call')?.content ?? event.content
  try {
    const entree: unknown = JSON.parse(brut)
    if (entree && typeof entree === 'object')
      for (const champ of CHAMPS_PARLANTS) {
        const valeur = (entree as Record<string, unknown>)[champ]
        if (typeof valeur === 'string' && valeur.trim()) return firstLine(valeur)
      }
  } catch {
    // Pas du JSON (geste nu, texte libre) : sa première ligne dit déjà ce qu'il fait.
  }
  return firstLine(brut)
}

/**
 * Une barre par appel. La trace horodate un geste à son DÉBUT (`chat-turn-trace.ts`,
 * `evenementGesteAgent`) : la barre va donc de l'horodatage à horodatage + durée — l'inverse d'un
 * agent, écrit à sa fin.
 */
function buildToolSpans(appels: HarnessTimelineEvent[], turnEnd: number): AgentSpan[] {
  const spans: AgentSpan[] = []
  for (const appel of appels) {
    const start = time(appel)
    if (start == null) continue
    const enCours = appel.status === 'running' && appel.durationMs == null
    const end = enCours ? Math.max(start, turnEnd) : start + Math.max(0, appel.durationMs ?? 0)
    spans.push({
      id: appel.id,
      eventId: appel.id,
      start,
      end,
      durationMs: end - start,
      status: enCours ? 'open' : appel.status === 'failed' ? 'failed' : 'ok',
      actions: 0,
      summary: resumeDAppel(appel)
    })
  }
  return spans.sort((a, b) => a.start - b.start)
}

const TICK_STEPS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000
]

function tickLabel(offsetMs: number, stepMs: number): string {
  if (stepMs < 60_000) return `${Math.round(offsetMs / 1000)} s`
  const minutes = Math.round(offsetMs / 60_000)
  // « 0 h » sur un axe gradué en heures ; « 90 min » se lit mieux « 1 h 30 ».
  if (minutes < 60 && (stepMs < 3_600_000 || minutes > 0)) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`
}

/** Graduations régulières depuis le début de l'axe : au plus cinq intervalles. */
export function buildGanttTicks(start: number, end: number): AgentGanttTick[] {
  const range = Math.max(1, end - start)
  const step = TICK_STEPS_MS.find((candidate) => range / candidate <= 5) ?? TICK_STEPS_MS.at(-1)!
  const ticks: AgentGanttTick[] = []
  for (let offset = 0; offset <= range + 1; offset += step)
    ticks.push({
      at: start + offset,
      percent: (offset / range) * 100,
      label: tickLabel(offset, step)
    })
  return ticks
}

/**
 * Déroulé par agent d'un tour, ou null s'il n'y a rien à mettre en barres. Un tour de simple
 * conversation n'a qu'un couloir (l'orchestrateur) : `minLanes` permet de ne montrer le diagramme
 * que quand il apprend quelque chose que la liste ne dit pas déjà. `outils` ajoute une ligne par outil
 * de l'orchestrateur (conv-1105) : l'Observatory s'en sert pour donner aux tours de chat le même
 * graphe que le bilan d'un run ; le bilan, lui, garde ses seuls agents.
 */
export function buildAgentGantt(
  events: ReadonlyArray<HarnessTimelineEvent>,
  { minLanes = 1, outils = false }: { minLanes?: number; outils?: boolean } = {}
): AgentGantt | null {
  const gatesByParent = new Map<string, HarnessTimelineEvent>()
  for (const event of events)
    if (event.kind === 'gate' && event.parentId) gatesByParent.set(event.parentId, event)
  const times = events.map(time).filter((at): at is number => at != null)
  const turnEnd = times.length ? Math.max(...times) : 0

  const byLane = new Map<string, HarnessTimelineEvent[]>()
  for (const event of events) {
    const key = laneKeyOf(event)
    if (!key) continue
    byLane.set(key, [...(byLane.get(key) ?? []), event])
  }

  const envelope = buildEnvelope(events)
  if (envelope && !byLane.has(ORCHESTRATOR)) byLane.set(ORCHESTRATOR, [])

  const lanes: AgentLane[] = []
  for (const [key, laneEvents] of byLane) {
    const spans = buildLaneSpans(laneEvents, gatesByParent, turnEnd)
    const laneEnvelope = key === ORCHESTRATOR ? envelope : undefined
    if (!spans.length && !laneEnvelope) continue
    const phase =
      key === ORCHESTRATOR
        ? ORCHESTRATOR
        : (laneEvents.find((event) => event.execution?.phase)?.execution?.phase ??
          key.split(':')[0])
    const variant = key === ORCHESTRATOR ? undefined : key.split(':').slice(1).join(':')
    lanes.push({
      key,
      phase,
      label: key === ORCHESTRATOR ? 'Orchestrateur' : key.split(':')[0],
      variant: variant && !SILENT_VARIANTS.has(variant) ? variant : undefined,
      model: shortModelName(
        spans.find((span) => span.model)?.model ??
          (laneEnvelope
            ? events.find((event) => event.id === laneEnvelope.eventId)?.model
            : undefined)
      ),
      ...(laneEnvelope ? { envelope: laneEnvelope } : {}),
      spans
    })
  }

  if (outils) {
    const parOutil = new Map<string, HarnessTimelineEvent[]>()
    for (const event of events) {
      const nom = nomDOutil(event)
      if (nom) parOutil.set(nom, [...(parOutil.get(nom) ?? []), event])
    }
    for (const [nom, appels] of parOutil) {
      const spans = buildToolSpans(appels, turnEnd)
      if (!spans.length) continue
      lanes.push({
        key: `${OUTIL_PREFIXE}${nom}`,
        phase: OUTIL,
        label: nom,
        detail: `${OUTIL} · ${spans.length} appel${spans.length > 1 ? 's' : ''}`,
        spans
      })
    }
  }
  if (lanes.length < Math.max(1, minLanes)) return null

  const firstStart = (lane: AgentLane): number =>
    Math.min(lane.envelope?.start ?? Infinity, ...lane.spans.map((span) => span.start))
  // L'orchestrateur en tête, puis ses agents, puis ses outils : chacun par ordre de départ.
  const rang = (lane: AgentLane): number =>
    lane.key === ORCHESTRATOR ? 0 : lane.phase === OUTIL ? 2 : 1
  lanes.sort(
    (a, b) => rang(a) - rang(b) || firstStart(a) - firstStart(b) || a.key.localeCompare(b.key)
  )
  const bounds = lanes.flatMap((lane) => [
    ...lane.spans.flatMap((span) => [span.start, span.end]),
    ...(lane.envelope ? [lane.envelope.start, lane.envelope.end] : [])
  ])
  const start = Math.min(...bounds)
  const end = Math.max(...bounds)
  return { start, end, lanes, ticks: buildGanttTicks(start, end) }
}

function isSupervisor(event: HarnessTimelineEvent): boolean {
  const raw = event.raw as { actor?: { id?: string } } | undefined
  return (
    event.kind === 'boundary' &&
    (raw?.actor?.id === 'execution-supervisor' || event.actor === 'Execution supervisor')
  )
}

/**
 * Enveloppe du tour : le superviseur écrit plusieurs bilans par tour, chacun avec la durée écoulée
 * DEPUIS LE DÉBUT du tour (mesuré sur conv-106 : 20 364 089, puis 20 390 088, puis 21 602 780 ms).
 * Ils se recouvrent donc : on garde le début le plus tôt et la fin la plus tardive, et l'issue du
 * DERNIER bilan.
 */
function buildEnvelope(events: ReadonlyArray<HarnessTimelineEvent>): AgentEnvelope | undefined {
  const settled = events
    .filter(isSupervisor)
    .map((event) => ({ event, end: time(event) }))
    .filter(
      (item): item is { event: HarnessTimelineEvent; end: number } =>
        item.end != null && item.event.durationMs != null
    )
    .sort((a, b) => a.end - b.end)
  if (!settled.length) return undefined
  const last = settled.at(-1)!
  const start = Math.min(...settled.map((item) => item.end - item.event.durationMs!))
  const status: AgentEnvelope['status'] =
    last.event.status === 'running'
      ? 'open'
      : last.event.status === 'failed'
        ? 'failed'
        : last.event.status === 'cancelled'
          ? 'cancelled'
          : 'ok'
  return { eventId: last.event.id, start, end: last.end, durationMs: last.end - start, status }
}

/** Position d'une barre sur l'axe, en pourcentages (largeur jamais négative). */
export function spanGeometry(
  gantt: Pick<AgentGantt, 'start' | 'end'>,
  span: Pick<AgentSpan, 'start' | 'end'>
): { left: number; width: number } {
  const range = Math.max(1, gantt.end - gantt.start)
  const left = ((span.start - gantt.start) / range) * 100
  const width = (Math.max(0, span.end - span.start) / range) * 100
  return { left: Math.max(0, left), width: Math.min(100 - Math.max(0, left), width) }
}

/** Duree du rejeu d'un run depuis son bilan (conv-981) : 10 s, quel que soit le nombre d'etapes. */
export const DUREE_REJEU_MS = 10_000
/** Une barre tres courte reste visible pendant le rejeu. */
const DUREE_MIN_REJEU_MS = 160

/**
 * Minutage d'une barre pendant « Rejouer ce run » (conv-981) : elle s'allume a son heure, a
 * l'echelle du run ramene a 10 s. Deduit de `spanGeometry` (gauche et largeur en %) — aucun second
 * modele. Une barre tres courte dure au moins 160 ms, sans jamais depasser la fin du rejeu.
 */
export function rejeuDeLaBarre(
  geometrie: { left: number; width: number },
  dureeTotaleMs = DUREE_REJEU_MS
): { delaiMs: number; dureeMs: number } {
  const delaiMs = Math.round((geometrie.left / 100) * dureeTotaleMs)
  const largeurMs = Math.round((geometrie.width / 100) * dureeTotaleMs)
  return {
    delaiMs,
    dureeMs: Math.max(0, Math.min(Math.max(DUREE_MIN_REJEU_MS, largeurMs), dureeTotaleMs - delaiMs))
  }
}
