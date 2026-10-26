import type { HarnessTimelineEvent } from './harness-timeline-model'

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
const TOOL_TITLES: Record<string, string | readonly [string, string]> = {
  ask: ['Question posée', 'Questions posées'],
  orchestrate: ['Agent lancé', 'Agents lancés'],
  run: ['Commande', 'Commandes'],
  verify: ['Vérification', 'Vérifications'],
  remember: ['Fait retenu', 'Faits retenus'],
  restart_app: 'Redémarrage',
  reload_env: 'Réglage rechargé',
  get_state: 'État relu',
  navigate: 'Vue affichée',
  brain_query: 'Brain interrogé',
  brain_read: ['Note lue', 'Notes lues'],
  brain_graph: 'Liens suivis',
  skill_charger: ['Skill chargée', 'Skills chargées'],
  load_graph: 'Graphe chargé',
  conversation_search: ['Fils cherchés', 'Fils cherchés'],
  conversation_read: ['Fil lu', 'Fils lus'],
  retrospective: ['Fil examiné', 'Fils examinés'],
  create_conversation: ['Fil créé', 'Fils créés'],
  rename_conversation: ['Fil renommé', 'Fils renommés'],
  classer_conversation: ['Fil classé', 'Fils classés'],
  remove_conversation: ['Fil supprimé', 'Fils supprimés'],
  remove_conversations: 'Fils supprimés',
  chat_send: ['Message envoyé', 'Messages envoyés'],
  ecrire_a_un_fil: ['Message à un autre fil', 'Messages à d’autres fils'],
  lire_mes_messages: 'Messages des autres fils lus',
  attach_run: 'Workflow attaché',
  read_file: ['Fichier lu', 'Fichiers lus'],
  list_files: ['Dossier listé', 'Dossiers listés'],
  find_in_files: ['Recherche', 'Recherches'],
  edit_file: ['Fichier modifié', 'Fichiers modifiés'],
  create_file: ['Fichier créé', 'Fichiers créés'],
  move_file: ['Fichier déplacé', 'Fichiers déplacés'],
  delete_file: ['Fichier supprimé', 'Fichiers supprimés'],
  run_status: 'Copies inspectées',
  proprietaire_fichier: ['Propriétaire vérifié', 'Propriétaires vérifiés'],
  marquer_travail_trie: 'Travail trié',
  marquer_travaux_tries: 'Travaux triés',
  confirmer_verdict_juge: 'Verdict confirmé',
  desktop_observe: ['Écran capturé', 'Écrans capturés'],
  desktop_act: ['Geste à l’écran', 'Gestes à l’écran'],
  bureau_cache_fermer: 'Bureau fermé',
  bureau_cache_lancer: 'Bureau lancé',
  bureau_cache_observer: ['Bureau observé', 'Bureaux observés'],
  bureau_cache_agir: ['Geste dans le bureau', 'Gestes dans le bureau'],
  show_video: 'Vidéo montrée',
  sql_query: ['Requête SQL', 'Requêtes SQL'],
  ticket_get: ['Fiche lue', 'Fiches lues'],
  ticket_search: 'Fiches cherchées',
  ticket_create: ['Fiche créée', 'Fiches créées'],
  ticket_update: ['Fiche modifiée', 'Fiches modifiées'],
  task_create: ['Tâche créée', 'Tâches créées'],
  task_list: 'Tâches listées',
  Read: ['Fichier lu', 'Fichiers lus'],
  Grep: ['Recherche', 'Recherches'],
  Glob: 'Fichiers listés',
  Bash: ['Commande', 'Commandes'],
  Edit: ['Fichier modifié', 'Fichiers modifiés'],
  Write: ['Fichier écrit', 'Fichiers écrits'],
  WebSearch: ['Recherche web', 'Recherches web'],
  WebFetch: ['Page web lue', 'Pages web lues']
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
  if (!name) return 'Outil non nommé par la trace'
  const entree = TOOL_TITLES[name]
  if (entree === undefined) return name
  if (typeof entree === 'string') return entree
  return count > 1 ? entree[1] : entree[0]
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
