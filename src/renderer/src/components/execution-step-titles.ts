import type { HarnessTimelineEvent } from './harness-timeline-model'
import { texteChatExecution as t, type CleChatExecution } from '../textes-ecrans/chat-execution'

/**
 * TITRES DES BLOCS DU GRAPHE D'EXÉCUTION — ce qui s'est passé, en mots courants.
 *
 * Mesuré le 2026-10-12 sur les 13 traces encore sur disque (221 demandes, 627 blocs) : le graphe
 * n'employait que CINQ titres — « orchestrator », « Demande utilisateur », « Étape », « Outil »,
 * « Résultat ». Il montrait la forme d'une demande sans jamais dire ce qui s'y était fait, alors que
 * la trace porte le nom de chaque outil (charge `tool-call` nommée, acteur du `tool-result`).
 *
 * Seul le NOM de l'outil est lu, jamais ses arguments ni son retour : le graphe s'interdit toujours
 * d'afficher un contenu d'outil.
 */

/**
 * Libellés des commandes connues, COURTS : une perle du panneau étroit (388 px, trois enfants) n'a
 * qu'une centaine de pixels pour son titre. « Note du Brain lue ×3 » y était coupé avant son nombre
 * (capture du 2026-10-12). Une paire [un, plusieurs] donne le pluriel d'une action regroupée :
 * « Note lue », mais « Notes lues ×3 ». Un nom absent de la table s'affiche tel quel.
 */
const TOOL_TITLES: Record<
  string,
  CleChatExecution | readonly [CleChatExecution, CleChatExecution]
> = {
  ask: ['outil.ask', 'outil.ask.n'],
  orchestrate: ['outil.orchestrate', 'outil.orchestrate.n'],
  run: ['outil.run', 'outil.run.n'],
  verify: ['outil.verify', 'outil.verify.n'],
  remember: ['outil.remember', 'outil.remember.n'],
  restart_app: 'outil.restart_app',
  reload_env: 'outil.reload_env',
  get_state: 'outil.get_state',
  navigate: 'outil.navigate',
  brain_query: 'outil.brain_query',
  brain_read: ['outil.brain_read', 'outil.brain_read.n'],
  brain_graph: 'outil.brain_graph',
  skill_charger: ['outil.skill_charger', 'outil.skill_charger.n'],
  load_graph: 'outil.load_graph',
  conversation_search: 'outil.conversation_search',
  conversation_read: ['outil.conversation_read', 'outil.conversation_read.n'],
  retrospective: ['outil.retrospective', 'outil.retrospective.n'],
  create_conversation: ['outil.create_conversation', 'outil.create_conversation.n'],
  rename_conversation: ['outil.rename_conversation', 'outil.rename_conversation.n'],
  classer_conversation: ['outil.classer_conversation', 'outil.classer_conversation.n'],
  remove_conversation: ['outil.remove_conversation', 'outil.remove_conversation.n'],
  remove_conversations: 'outil.remove_conversation.n',
  chat_send: ['outil.chat_send', 'outil.chat_send.n'],
  ecrire_a_un_fil: ['outil.ecrire_a_un_fil', 'outil.ecrire_a_un_fil.n'],
  lire_mes_messages: 'outil.lire_mes_messages',
  plan_de_lots: ['outil.plan_de_lots', 'outil.plan_de_lots.n'],
  attach_run: 'outil.attach_run',
  read_file: ['outil.read_file', 'outil.read_file.n'],
  list_files: ['outil.list_files', 'outil.list_files.n'],
  find_in_files: ['outil.find_in_files', 'outil.find_in_files.n'],
  edit_file: ['outil.edit_file', 'outil.edit_file.n'],
  create_file: ['outil.create_file', 'outil.create_file.n'],
  move_file: ['outil.move_file', 'outil.move_file.n'],
  delete_file: ['outil.delete_file', 'outil.delete_file.n'],
  run_status: 'outil.run_status',
  proprietaire_fichier: ['outil.proprietaire_fichier', 'outil.proprietaire_fichier.n'],
  marquer_travail_trie: 'outil.marquer_travail_trie',
  marquer_travaux_tries: 'outil.marquer_travaux_tries',
  confirmer_verdict_juge: 'outil.confirmer_verdict_juge',
  desktop_observe: ['outil.desktop_observe', 'outil.desktop_observe.n'],
  desktop_act: ['outil.desktop_act', 'outil.desktop_act.n'],
  bureau_cache_fermer: 'outil.bureau_cache_fermer',
  bureau_cache_lancer: 'outil.bureau_cache_lancer',
  bureau_cache_observer: ['outil.bureau_cache_observer', 'outil.bureau_cache_observer.n'],
  bureau_cache_agir: ['outil.bureau_cache_agir', 'outil.bureau_cache_agir.n'],
  // Navigateur intégré du chat (conv-1286, lot 4/5).
  navigateur_ouvrir: ['outil.navigateur_ouvrir', 'outil.navigateur_ouvrir.n'],
  navigateur_lire: ['outil.navigateur_lire', 'outil.navigateur_lire.n'],
  navigateur_capture: ['outil.navigateur_capture', 'outil.navigateur_capture.n'],
  navigateur_agir: ['outil.navigateur_agir', 'outil.navigateur_agir.n'],
  navigateur_console: 'outil.navigateur_console',
  navigateur_annotations: 'outil.navigateur_annotations',
  show_video: 'outil.show_video',
  montrer_bloc: 'outil.montrer_bloc',
  sql_query: ['outil.sql_query', 'outil.sql_query.n'],
  ticket_get: ['outil.ticket_get', 'outil.ticket_get.n'],
  ticket_search: 'outil.ticket_search',
  ticket_create: ['outil.ticket_create', 'outil.ticket_create.n'],
  ticket_update: ['outil.ticket_update', 'outil.ticket_update.n'],
  task_create: ['outil.task_create', 'outil.task_create.n'],
  task_list: 'outil.task_list',
  Read: ['outil.read_file', 'outil.read_file.n'],
  Grep: ['outil.find_in_files', 'outil.find_in_files.n'],
  Glob: 'outil.Glob',
  Bash: ['outil.run', 'outil.run.n'],
  Edit: ['outil.edit_file', 'outil.edit_file.n'],
  Write: ['outil.Write', 'outil.Write.n'],
  WebSearch: ['outil.WebSearch', 'outil.WebSearch.n'],
  WebFetch: ['outil.WebFetch', 'outil.WebFetch.n']
}

/** `mcp__autowin__ask` → `ask` : le préfixe du serveur ne dit rien à l'utilisateur. */
export function bareToolName(name: string): string {
  return name.replace(/^mcp__.+?__/, '')
}

/**
 * Nom de l'outil d'un appel ou d'un résultat : la charge nommée d'abord (l'appel est écrit par
 * l'agent, son acteur est l'agent), puis l'acteur du résultat (c'est l'outil lui-même).
 */
export function toolNameOf(event: HarnessTimelineEvent): string | undefined {
  const named = event.payloads.find(
    (payload) => (payload.kind === 'tool-call' || payload.kind === 'tool-result') && payload.name
  )?.name
  if (named?.trim()) return bareToolName(named.trim())
  if (event.kind === 'tool-result' && event.actor?.trim()) return bareToolName(event.actor.trim())
  return undefined
}

/**
 * Titre d'une action : son libellé courant (au pluriel si elle compte plusieurs gestes), sinon son
 * nom brut, sinon l'aveu qu'elle n'en a pas. Le nombre lui-même n'est PAS dans le titre : il
 * s'affiche à part, pour qu'une coupure du titre ne l'emporte jamais.
 */
export function toolTitle(name: string | undefined, count = 1): string {
  if (!name) return t('outil.sans-nom')
  // Propriété PROPRE seulement : « constructor » ou « toString » restent des noms bruts.
  const entree = Object.prototype.hasOwnProperty.call(TOOL_TITLES, name)
    ? TOOL_TITLES[name]
    : undefined
  if (entree === undefined) return name
  // Dans la langue de l'interface (conv-1170) : la table garde des clés, traduites à la lecture.
  if (typeof entree === 'string') return t(entree)
  return t(count > 1 ? entree[1] : entree[0])
}

/**
 * Titre d'un événement qui n'est ni un agent ni un outil. Le bilan du superviseur porte la durée et
 * le coût TOTAUX du tour (charge `provider-options`, métriques du tour entier) : ce n'est pas un
 * réglage technique, c'est le chiffre qu'on cherche.
 */
export function stepTitle(event: HarnessTimelineEvent): string {
  switch (event.kind) {
    case 'response-displayed':
      return 'Response displayed'
    case 'retry':
      return 'Retry'
    case 'cancellation':
      return 'Cancellation'
    case 'error':
      return 'Error'
    case 'boundary':
      return 'Turn summary'
    case 'artifact':
      return 'File produced'
    case 'decision':
      return 'Decision'
    case 'injection':
      return 'Injected instructions'
    case 'model-response':
      return 'Model response'
    case 'handoff':
      return 'Handoff'
    case 'verdict':
      return 'Verdict'
    case 'gate':
      return 'Closure decision'
    case 'message':
      return 'Message'
    default:
      return 'Trace event'
  }
}

/** Rôle lisible d'un agent : l'identifiant interne « orchestrator » ne dit rien à l'utilisateur. */
export function roleLabel(actor: string): string {
  const lower = actor.trim().toLowerCase()
  // Noms du graphe EN ANGLAIS (demande du 2026-10-22, conv-1094) : les étapes s'y appelaient déjà
  // « Judge », « Learn » ; leurs agents restaient « Juge », « Sous-agent ». La table des actions
  // (`TOOL_TITLES`) reste en français : le fil de conversation la partage.
  if (lower === 'orchestrator' || lower === 'orchestrateur') return 'Orchestrator'
  if (lower === 'subagent') return 'Subagent'
  return actor
}
