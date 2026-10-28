import type { Msg } from './chat-view-types'
import type {
  HarnessTimeline,
  HarnessTimelineEvent,
  HarnessTimelineTurn
} from './harness-timeline-model'
import type { GestesDuTour } from '../../../shared/gestes-agent'
import type { Langue } from '../../../shared/langue'
import { formaterDate, langueCourante } from '../langue'
import {
  auPluriel,
  traduireChatFilsEtLots,
  type CleChatFilsEtLots
} from '../textes-ecrans/chat-fils-et-lots'
import { bareToolName, toolTitle } from './execution-step-titles'
import { projectLatestRequestExecution } from './request-execution-tree-model'

/**
 * LE FIL DES DEMANDES — refonte du graphe du chat (direction « 1 + 2 », choisie le 2026-10-12).
 *
 * Le graphe montrait UNE demande à la fois, en arbre causal, et rien tant qu'elle tournait. Il ne
 * répondait pas à la question posée : « qu'est-ce qui se passe avec mes demandes ? ». Ce modèle
 * résume CHAQUE demande de la conversation (état, durée, coût, gestes par famille) et la raconte en
 * cinq chapitres fixes : Demande, Décision, Ce qu'il a fait, Résultat, Bilan.
 *
 * Il ne relit pas la trace lui-même : il part de la projection du graphe
 * (`projectLatestRequestExecution`), qui nomme déjà chaque action, fusionne appel et résultat et
 * porte les durées. Le récit et l'arbre détaillé disent donc la même chose.
 *
 * Pendant une demande, l'agent n'écrit ses étapes dans la trace qu'à la FIN de son appel : la
 * demande en cours est lue dans le message de l'assistant en train de s'écrire (`liveStoryFromMessages`).
 */

export type ActionFamily =
  'lire' | 'chercher' | 'modifier' | 'verifier' | 'lancer' | 'demander' | 'autre'

export const FAMILY_ORDER: readonly ActionFamily[] = [
  'lire',
  'chercher',
  'modifier',
  'verifier',
  'lancer',
  'demander',
  'autre'
]

/**
 * Titre du chapitre « Ce qu'il a fait » pour chaque famille : sa CLÉ de texte (« Il a lu »…), lue
 * dans la langue de l'écran par RequestThread (traduction anglaise, conv-1170).
 */
export const FAMILY_CHAPTER: Record<ActionFamily, CleChatFilsEtLots> = {
  lire: 'demandes.famille.chapitre.lire',
  chercher: 'demandes.famille.chapitre.chercher',
  modifier: 'demandes.famille.chapitre.modifier',
  verifier: 'demandes.famille.chapitre.verifier',
  lancer: 'demandes.famille.chapitre.lancer',
  demander: 'demandes.famille.chapitre.demander',
  autre: 'demandes.famille.chapitre.autre'
}

/** Libellé court de la ligne du fil (« Lu ×4 · Question ×1 ») : sa CLÉ de texte. */
export const FAMILY_SHORT: Record<ActionFamily, CleChatFilsEtLots> = {
  lire: 'demandes.famille.court.lire',
  chercher: 'demandes.famille.court.chercher',
  modifier: 'demandes.famille.court.modifier',
  verifier: 'demandes.famille.court.verifier',
  lancer: 'demandes.famille.court.lancer',
  demander: 'demandes.famille.court.demander',
  autre: 'demandes.famille.court.autre'
}

const FAMILY_BY_TOOL: Record<string, ActionFamily> = {
  read_file: 'lire',
  list_files: 'lire',
  brain_read: 'lire',
  brain_graph: 'lire',
  skill_charger: 'lire',
  load_graph: 'lire',
  conversation_read: 'lire',
  retrospective: 'lire',
  get_state: 'lire',
  run_status: 'lire',
  proprietaire_fichier: 'lire',
  lire_mes_messages: 'lire',
  task_list: 'lire',
  ticket_get: 'lire',
  sql_query: 'lire',
  desktop_observe: 'lire',
  bureau_cache_observer: 'lire',
  Read: 'lire',
  Glob: 'lire',
  WebFetch: 'lire',
  brain_query: 'chercher',
  conversation_search: 'chercher',
  find_in_files: 'chercher',
  ticket_search: 'chercher',
  Grep: 'chercher',
  WebSearch: 'chercher',
  edit_file: 'modifier',
  create_file: 'modifier',
  move_file: 'modifier',
  delete_file: 'modifier',
  remember: 'modifier',
  create_conversation: 'modifier',
  rename_conversation: 'modifier',
  classer_conversation: 'modifier',
  remove_conversation: 'modifier',
  remove_conversations: 'modifier',
  attach_run: 'modifier',
  ticket_create: 'modifier',
  ticket_update: 'modifier',
  task_create: 'modifier',
  marquer_travail_trie: 'modifier',
  marquer_travaux_tries: 'modifier',
  confirmer_verdict_juge: 'modifier',
  Edit: 'modifier',
  Write: 'modifier',
  verify: 'verifier',
  run: 'lancer',
  orchestrate: 'lancer',
  restart_app: 'lancer',
  reload_env: 'lancer',
  navigate: 'lancer',
  desktop_act: 'lancer',
  bureau_cache_fermer: 'lancer',
  bureau_cache_lancer: 'lancer',
  bureau_cache_agir: 'lancer',
  show_video: 'lancer',
  chat_send: 'lancer',
  ecrire_a_un_fil: 'modifier',
  plan_de_lots: 'lancer',
  Bash: 'lancer',
  Task: 'lancer',
  Agent: 'lancer',
  ask: 'demander'
}

export function familyOf(toolName: string | undefined): ActionFamily {
  return (toolName && FAMILY_BY_TOOL[bareToolName(toolName)]) || 'autre'
}

export type StoryStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface StoryAction {
  title: string
  count: number
  status?: string
  durationMs?: number
}

export interface StoryFamily {
  family: ActionFamily
  count: number
  durationMs?: number
  actions: StoryAction[]
}

export interface RequestStory {
  turnId: string
  ts: string
  /** « 12/10/2026 09:52 » ; vide si l'horodatage manque. */
  dateLabel: string
  /** Texte de la demande ; vide quand la trace ne l'identifie pas (la date la nomme alors). */
  text: string
  status: StoryStatus
  durationMs?: number
  costUsd?: number
  /** Appels au modèle (blocs agent) et combien ont échoué. */
  calls: number
  failedCalls: number
  decision: string[]
  families: StoryFamily[]
  outcome: string[]
  failure?: string
}

const GIT_OUTCOME: Record<string, CleChatFilsEtLots> = {
  merged: 'modele.git.merged',
  nothing: 'modele.git.nothing',
  conflict: 'modele.git.conflict',
  blocked: 'modele.git.blocked',
  kept: 'modele.git.kept'
}

/*
 * Le récit est écrit dans la langue demandée AU MOMENT où il est construit : RequestThread le
 * reconstruit (useMemo) quand la langue de l'écran change. La date suit la langue courante
 * (`formaterDate`), la même pendant le rendu.
 */
function textesDe(langue: Langue): {
  texte: (cle: CleChatFilsEtLots, valeurs?: Record<string, string | number>) => string
  plural: (count: number, un: CleChatFilsEtLots, plusieurs: CleChatFilsEtLots) => string
} {
  const texte = (cle: CleChatFilsEtLots, valeurs?: Record<string, string | number>): string =>
    traduireChatFilsEtLots(cle, langue, valeurs)
  // Singulier ou pluriel selon `count` et la langue (`auPluriel`).
  const plural = (count: number, un: CleChatFilsEtLots, plusieurs: CleChatFilsEtLots): string =>
    texte(auPluriel(count, langue) ? plusieurs : un, { n: count })
  return { texte, plural }
}

function dateLabelOf(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return formaterDate(date, { dateStyle: 'short', timeStyle: 'short' })
}

function worstStatus(statuses: Array<string | undefined>): string | undefined {
  for (const status of ['failed', 'running', 'cancelled', 'pending'])
    if (statuses.includes(status)) return status
  return statuses.find(Boolean)
}

function sumKnown(values: Array<number | undefined>): number | undefined {
  return values.every((value) => value != null && Number.isFinite(value))
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : undefined
}

/** Écart entre le premier et le dernier instant journalisé de la demande. */
function observedSpan(events: HarnessTimelineEvent[]): number | undefined {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const event of events) {
    const at = Date.parse(event.timestamp ?? '')
    if (!Number.isFinite(at)) continue
    start = Math.min(start, at)
    end = Math.max(end, at + (event.durationMs ?? 0))
  }
  return Number.isFinite(start) && end > start ? end - start : undefined
}

/** Familles d'actions d'une demande : les blocs outil regroupés par famille, puis par titre. */
function familiesOf(tools: HarnessTimelineEvent[], turn: HarnessTimelineTurn): StoryFamily[] {
  const kindById = new Map(turn.events.map((event) => [event.id, event.kind]))
  const byFamily = new Map<ActionFamily, Map<string, HarnessTimelineEvent[]>>()
  const countOf = (tool: HarnessTimelineEvent): number =>
    (tool.display?.observedEventIds ?? []).filter((id) => kindById.get(id) === 'tool-call')
      .length || 1
  for (const tool of tools) {
    const family = familyOf(tool.actor)
    // Regroupé sous la forme au SINGULIER : le titre d'un bloc passe au pluriel quand il regroupe
    // plusieurs gestes (« Notes lues »), et le récit compte lui-même (« Note lue ×3 »).
    const title = toolTitle(tool.actor)
    const titles = byFamily.get(family) ?? new Map<string, HarnessTimelineEvent[]>()
    titles.set(title, [...(titles.get(title) ?? []), tool])
    byFamily.set(family, titles)
  }
  return FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => {
    const actions = [...(byFamily.get(family) as Map<string, HarnessTimelineEvent[]>)].map(
      ([title, members]) => ({
        title,
        count: members.reduce((sum, member) => sum + countOf(member), 0),
        status: worstStatus(members.map((member) => member.status)),
        durationMs: sumKnown(members.map((member) => member.durationMs))
      })
    )
    return {
      family,
      count: actions.reduce((sum, action) => sum + action.count, 0),
      durationMs: sumKnown(actions.map((action) => action.durationMs)),
      actions
    }
  })
}

function storyOf(
  timeline: HarnessTimeline,
  turn: HarnessTimelineTurn,
  live: boolean,
  langue: Langue
): RequestStory {
  const { texte, plural } = textesDe(langue)
  const projection = projectLatestRequestExecution(timeline, { turnId: turn.id })
  const events = projection.events
  const root = events.find((event) => event.display?.kind === 'request')
  const option = projection.turns?.find((item) => item.id === turn.id)
  const text =
    root?.label || (option && !/^demande (du|sans)/.test(option.label) ? option.label : '')
  const agents = events.filter((event) => event.display?.kind === 'agent')
  const tools = events.filter((event) => event.display?.kind === 'tool')
  // Le bilan du superviseur n'est plus un bloc : la demande (racine) porte sa durée, son coût et son
  // issue « annulée » (request-execution-tree-model.ts, 2026-10-12).
  const bilan = root?.display?.observedEventIds?.length ? root : undefined
  const closure = events.find((event) => event.display?.kind === 'closure')
  const git = events.find((event) => event.display?.kind === 'git')
  const failedCalls = agents.filter((agent) => agent.status === 'failed').length
  const shown = events.some((event) => event.kind === 'response-displayed')
  const cancelled =
    bilan?.status === 'cancelled' ||
    (turn.events.some((event) => event.kind === 'cancellation') &&
      !agents.some((agent) => agent.status === 'completed'))

  let status: StoryStatus
  if (events.some((event) => event.status === 'running')) status = live ? 'running' : 'interrupted'
  else if (closure?.display?.closure)
    status =
      closure.display.closure.status === 'red'
        ? 'failed'
        : closure.display.closure.status === 'open'
          ? live
            ? 'running'
            : 'interrupted'
          : 'completed'
  else if (cancelled) status = 'cancelled'
  else if (agents.length > 0 && failedCalls === agents.length) status = 'failed'
  else if (agents.length === 0 && tools.length === 0 && !bilan && !shown)
    status = live ? 'running' : 'interrupted'
  else status = 'completed'

  const failure =
    agents.find((agent) => agent.display?.failure)?.display?.failure ??
    turn.events
      .find((event) => event.kind === 'error' && event.status === 'failed')
      ?.payloads.find((payload) => payload.kind === 'error' && payload.content.trim())
      ?.content.trim()

  const closureTotals = closure?.display?.closure
  const durationMs =
    bilan?.durationMs ??
    (closureTotals?.totalDurationMs ? closureTotals.totalDurationMs : undefined) ??
    observedSpan(events.filter((event) => event !== root))
  const costUsd =
    bilan?.costUsd ??
    (closureTotals?.totalCostUsd ? closureTotals.totalCostUsd : undefined) ??
    (turn.costUsd > 0 ? turn.costUsd : undefined)

  // DÉCISION : comment la demande a été traitée.
  const decision: string[] = []
  if (projection.runIds?.length) {
    decision.push(
      plural(
        projection.runIds.length,
        'modele.decision.confie.un',
        'modele.decision.confie.plusieurs'
      )
    )
    const skills = events
      .filter((event) => event.display?.kind === 'skill')
      .map((event) => event.display?.skillName)
      .filter(Boolean)
    if (skills.length > 0)
      decision.push(texte('modele.decision.etapes', { etapes: skills.join(' → ') }))
    if (events.some((event) => event.display?.workspace?.mode === 'worktree'))
      decision.push(texte('modele.decision.copie'))
    if (agents.length > 0)
      decision.push(
        plural(
          agents.length,
          'modele.decision.sousAgents.un',
          'modele.decision.sousAgents.plusieurs'
        )
      )
  } else {
    const phases = events
      .filter((event) => event.display?.kind === 'phase')
      .map((event) => event.display?.skillName)
      .filter(Boolean)
    decision.push(
      phases.length > 0
        ? texte('modele.decision.pipeline', { etapes: phases.join(' → ') })
        : texte('modele.decision.chatDirect')
    )
    const roles = [...new Set(agents.map((agent) => agent.display?.title ?? agent.actor))]
    if (roles.length > 0) decision.push(roles.join(', '))
    const model = agents.find((agent) => agent.model)?.model
    if (model) decision.push(model)
    if (agents.length > 1)
      decision.push(texte('modele.decision.appelsModele', { n: agents.length }))
  }

  // RÉSULTAT : ce sur quoi la demande s'est terminée.
  const families = familiesOf(tools, turn)
  const outcome: string[] = []
  if (status === 'failed')
    outcome.push(
      failure ? texte('modele.issue.echecRaison', { raison: failure }) : texte('modele.issue.echec')
    )
  if (status === 'cancelled') outcome.push(texte('modele.issue.arretee'))
  if (status === 'interrupted') outcome.push(texte('modele.issue.interrompue'))
  if (status === 'running') outcome.push(texte('modele.issue.enCours'))
  if (status === 'completed' && failedCalls > 0)
    outcome.push(
      plural(failedCalls, 'modele.issue.appelsEchec.un', 'modele.issue.appelsEchec.plusieurs')
    )
  if (closureTotals)
    outcome.push(
      closureTotals.status === 'green'
        ? texte('modele.issue.clotureVerte')
        : closureTotals.status === 'red'
          ? texte('modele.issue.clotureRouge')
          : texte('modele.issue.clotureAttente')
    )
  if (git?.display?.git) {
    const issue = git.display.git.outcome
    const cle = GIT_OUTCOME[issue] as CleChatFilsEtLots | undefined
    outcome.push(texte('modele.issue.git', { issue: cle ? texte(cle) : issue }))
  }
  const modified = families.find((family) => family.family === 'modifier')
  if (modified)
    outcome.push(modified.actions.map((action) => `${action.title} ×${action.count}`).join(', '))
  const lastTool = [...tools]
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
    .at(-1)
  if (lastTool && familyOf(lastTool.actor) === 'demander')
    outcome.push(texte('modele.issue.question'))
  else if (shown) outcome.push(texte('modele.issue.affichee'))
  // Les tours sans « réponse affichée » (tâches programmées, veille des mails, traces plus
  // anciennes) ont pourtant RÉPONDU : un appel au modèle terminé le prouve.
  else if (status === 'completed' && agents.some((agent) => agent.status === 'completed'))
    outcome.push(texte('modele.issue.rendue'))
  if (outcome.length === 0) outcome.push(texte('modele.issue.aucune'))

  return {
    turnId: turn.id,
    ts: turn.ts,
    dateLabel: dateLabelOf(turn.ts),
    text,
    status,
    ...(durationMs != null ? { durationMs } : {}),
    ...(costUsd != null ? { costUsd } : {}),
    calls: agents.length,
    failedCalls,
    decision,
    families,
    outcome,
    ...(failure && status !== 'completed' ? { failure } : {})
  }
}

/**
 * Toutes les demandes de la conversation, la plus récente en tête. `live` ne vaut que pour la plus
 * récente : hors exécution vivante, une étape restée « en cours » est un reste d'interruption.
 */
export function buildRequestThread(
  timeline: HarnessTimeline,
  options: { live?: boolean; langue?: Langue } = {}
): RequestStory[] {
  const langue = options.langue ?? langueCourante()
  return timeline.turns.map((turn, index) =>
    storyOf(timeline, turn, Boolean(options.live) && index === 0, langue)
  )
}

/**
 * LES GESTES PROPRES DE L'AGENT — lecture, commande, édition. Ni la trace causale ni les messages
 * enregistrés ne les gardent (seulement les commandes d'Autowin) : l'app les résume depuis les
 * journaux des demandes (`window.api.turnJournalGestes`, un appel par conversation, voir
 * `shared/gestes-agent.ts`). Les commandes d'Autowin (`mcp__…`) en sont exclues : la trace les
 * compte déjà, rien n'est donc compté deux fois.
 */
export function withNativeActions(
  families: readonly StoryFamily[],
  gestes: GestesDuTour | undefined
): StoryFamily[] {
  if (!gestes || Object.keys(gestes).length === 0) return [...families]
  const byFamily = new Map<ActionFamily, StoryAction[]>(
    families.map((family) => [family.family, family.actions.map((action) => ({ ...action }))])
  )
  for (const [name, compte] of Object.entries(gestes)) {
    if (compte.nombre <= 0) continue
    const family = familyOf(name)
    const title = toolTitle(name)
    const actions = byFamily.get(family) ?? []
    const existing = actions.find((action) => action.title === title)
    if (existing) {
      existing.count += compte.nombre
      existing.durationMs =
        existing.durationMs != null ? existing.durationMs + compte.dureeMs : undefined
      if (compte.echecs > 0) existing.status = 'failed'
    } else {
      actions.push({
        title,
        count: compte.nombre,
        durationMs: compte.dureeMs,
        status: compte.echecs > 0 ? 'failed' : 'completed'
      })
    }
    byFamily.set(family, actions)
  }
  return FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => {
    const actions = byFamily.get(family) as StoryAction[]
    return {
      family,
      count: actions.reduce((sum, action) => sum + action.count, 0),
      durationMs: sumKnown(actions.map((action) => action.durationMs)),
      actions
    }
  })
}

/** Nombre de gestes propres de l'agent dans une demande (toutes familles confondues). */
export function nativeGestureCount(gestes: GestesDuTour | undefined): number {
  return Object.values(gestes ?? {}).reduce((sum, compte) => sum + compte.nombre, 0)
}

export interface LiveAction {
  title: string
  family: ActionFamily
  state: 'running' | 'done' | 'failed' | 'interrupted'
}

export interface LiveStory {
  text: string
  /** Demande du message en train de s'écrire : sert à relire son journal pendant le travail. */
  turnId?: string
  startedAt?: number
  elapsedMs?: number
  /** Battement de l'action encore en vol (« Bash en cours — 2 min 30 s »), sinon absent. */
  heartbeat?: string
  actions: LiveAction[]
  families: Array<{ family: ActionFamily; count: number }>
}

/**
 * LA DEMANDE EN COURS, LUE DANS LE FLUX DU CHAT. Le dernier message de l'utilisateur et, s'il existe,
 * le message de l'assistant qui le suit : ses parties `action` arrivent en direct (nom de l'outil,
 * `ok` absent tant qu'il tourne, `progress` pour le battement). Rien d'inventé : sans message de
 * l'utilisateur, pas de demande en cours.
 */
export function liveStoryFromMessages(
  messages: readonly Msg[],
  now: number
): LiveStory | undefined {
  let userIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return undefined
  const user = messages[userIndex] as Extract<Msg, { role: 'user' }>
  const reply = messages.slice(userIndex + 1).find((message) => message.role === 'assistant') as
    Extract<Msg, { role: 'assistant' }> | undefined
  const actions: LiveAction[] = (reply?.parts ?? [])
    .filter((part): part is Extract<typeof part, { kind: 'action' }> => part.kind === 'action')
    .map((part) => ({
      title: toolTitle(bareToolName(part.name)),
      family: familyOf(part.name),
      state: part.interrupted
        ? 'interrupted'
        : part.ok === undefined
          ? 'running'
          : part.ok
            ? 'done'
            : 'failed'
    }))
  // Battement d'une commande d'Autowin en vol, sinon la ligne d'état du modèle : c'est elle qui dit
  // « Bash · npm test » ou « Read terminé - 3 s » pour les gestes propres de l'agent.
  const heartbeat =
    [...(reply?.parts ?? [])]
      .reverse()
      .find(
        (part): part is Extract<typeof part, { kind: 'action' }> =>
          part.kind === 'action' &&
          part.ok === undefined &&
          !part.interrupted &&
          Boolean(part.progress)
      )?.progress ??
    (reply?.providerStatus?.trim() || undefined)
  const counts = new Map<ActionFamily, number>()
  for (const action of actions) counts.set(action.family, (counts.get(action.family) ?? 0) + 1)
  const text = user.content.replace(/\s+/g, ' ').trim()
  return {
    text: text.length > 96 ? `${text.slice(0, 93)}…` : text,
    ...(reply?.turnId ? { turnId: reply.turnId } : {}),
    ...(user.ts ? { startedAt: user.ts, elapsedMs: Math.max(0, now - user.ts) } : {}),
    ...(heartbeat ? { heartbeat } : {}),
    actions,
    families: FAMILY_ORDER.filter((family) => counts.has(family)).map((family) => ({
      family,
      count: counts.get(family) ?? 0
    }))
  }
}
