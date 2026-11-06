/**
 * CE QUE FAIT UN AGENT, DIT EN MÉTIER DU QUARTIER.
 *
 * Un outil appelé par un agent devient un métier, et un métier un groupe de postes sur la Falaise.
 * La table vient de la mesure de 14 jours de journaux de tours (`grill/quartier/esplanade/etages.mjs`) :
 * les noms d'outils sont ceux qui passent réellement dans les événements `command`.
 *
 * Trois règles viennent de la fiche `grill/fond-accueil-atelier-des-agents.md` :
 *  - D12 : une commande se classe d'après son CONTENU, pas d'après l'outil « Bash » ;
 *  - D17 : un outil nouveau ou inconnu va aux commandes (la Machine jusqu'au 2026-11-02 ; l'onsen l'a
 *    remplacée, et les postes des commandes sont devant le coffre gris à gauche de l'escalier A) ;
 *  - la liste de tâches de l'agent n'est pas un travail : elle ne le fait pas bouger (`null`).
 */
export type Metier =
  | 'commandes'
  | 'runs'
  | 'lire'
  | 'chercher'
  | 'brain'
  | 'web'
  | 'modifier'
  | 'tester'
  | 'ecran'
  | 'publier'
  | 'tickets'
  | 'messages'
  | 'taches'
  | 'sql'

const PAR_OUTIL: Readonly<Record<string, Metier>> = {
  Read: 'lire',
  Glob: 'lire',
  read_file: 'lire',
  list_files: 'lire',
  proprietaire_fichier: 'lire',
  Grep: 'chercher',
  find_in_files: 'chercher',
  WebSearch: 'web',
  WebFetch: 'web',
  navigateur_ouvrir: 'web',
  navigateur_lire: 'web',
  navigateur_agir: 'web',
  navigateur_capture: 'web',
  navigateur_console: 'web',
  brain_query: 'brain',
  brain_read: 'brain',
  brain_graph: 'brain',
  load_graph: 'brain',
  remember: 'brain',
  skill_charger: 'brain',
  conversation_read: 'brain',
  conversation_search: 'brain',
  retrospective: 'brain',
  Edit: 'modifier',
  Write: 'modifier',
  edit_file: 'modifier',
  create_file: 'modifier',
  move_file: 'modifier',
  delete_file: 'modifier',
  verify: 'tester',
  orchestrate: 'runs',
  plan_de_lots: 'runs',
  attach_run: 'runs',
  run_status: 'runs',
  ecrire_a_un_fil: 'messages',
  lire_mes_messages: 'messages',
  chat_send: 'messages',
  ticket_get: 'tickets',
  ticket_search: 'tickets',
  ticket_create: 'tickets',
  ticket_update: 'tickets',
  sql_query: 'sql',
  task_create: 'taches',
  task_update: 'taches',
  task_delete: 'taches',
  task_list: 'taches',
  desktop_observe: 'ecran',
  desktop_act: 'ecran',
  bureau_cache_lancer: 'ecran',
  bureau_cache_observer: 'ecran',
  bureau_cache_agir: 'ecran',
  bureau_cache_fermer: 'ecran',
  Monitor: 'commandes'
}

/** Ce qui ne déplace personne : la liste de tâches de l'agent, et la question, qui est un état. */
const SANS_METIER = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop', 'ask'])

/** D12 : ce que dit la commande, mot pour mot comme la mesure qui a dimensionné le bâtiment. */
export function metierDeLaCommande(brut: string): Metier {
  const s = brut.replace(/^\s*cd\s+("[^"]*"|\S+)\s*(;|&&)\s*/, '').trim()
  if (
    /^(npx\s+(vitest|tsc|eslint|playwright)|npm\s+(run\s+)?(test|typecheck|lint)|node\s+scripts\/(banc|couleurs|html-))/.test(
      s
    )
  )
    return 'tester'
  if (/(ui-capture|hdesk-|capture)/.test(s.slice(0, 120))) return 'ecran'
  if (/^git\b/.test(s)) return 'publier'
  if (/^(sed|cat|head|tail|ls|wc|awk|stat|file|du|cut|sort)\b/.test(s)) return 'lire'
  if (/^(grep|rg|find)\b/.test(s)) return 'chercher'
  if (/^(mv|cp|rm|mkdir|touch|tee)\b/.test(s)) return 'modifier'
  if (/^(curl|wget)\b/.test(s)) return 'web'
  return 'commandes'
}

/** Le texte d'une commande shell, quel que soit l'outil qui la porte. */
function texteDeCommande(args: unknown): string {
  if (typeof args !== 'object' || args === null) return ''
  const a = args as { command?: unknown; commande?: unknown }
  if (typeof a.command === 'string') return a.command
  return typeof a.commande === 'string' ? a.commande : ''
}

/** Le métier d'un appel d'outil, ou `null` quand cet appel ne doit déplacer personne. */
export function metierDeLOutil(nomBrut: string, args?: unknown): Metier | null {
  const nom = nomBrut.replace(/^mcp__autowin__/, '')
  if (SANS_METIER.has(nom)) return null
  if (nom === 'Bash' || nom === 'run') return metierDeLaCommande(texteDeCommande(args))
  return PAR_OUTIL[nom] ?? 'commandes'
}
