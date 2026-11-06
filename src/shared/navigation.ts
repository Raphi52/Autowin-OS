export const APP_DESTINATIONS = [
  { id: 'accueil', label: 'Accueil', icon: '🏠' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'agent-studio', label: 'Agent Studio', icon: '🤖' },
  { id: 'knowledge', label: 'Knowledge', icon: '🧠' },
  { id: 'observatory', label: 'Observatory', icon: '🔭' },
  { id: 'task-manager', label: 'Task Manager', icon: '◷' },
  { id: 'worktree', label: 'Worktrees', icon: '🌳' },
  // Les Bureaux cachés ne sont plus un écran (2026-10-31) : un panneau du chat, ouvert par
  // l'icône à côté du navigateur. Leurs noms restent des adresses : voir `BUREAUX_CACHES`.
  // Tickets n'est plus un écran (2026-10-31) : les tickets des sources externes (Azure,
  // GitHub, GitLab) sont un onglet du Board, la veille « Autowin OS » un bloc de Maintenance. Le nom
  // reste une adresse : voir `LEGACY_LOCATIONS`.
  // Carte des besoins (2026-10-22) : les demandes de tous les fils, par projet.
  // Renommée « Carte du projet » (2026-10-23) ; l'identifiant reste `besoins`, comme
  // `tests` pour Maintenance, pour qu'un agent qui navigue vers « besoins » y aboutisse toujours.
  // Renommée « Board » (2026-10-23, proposition 5 : « le mot que tu emploies, ce
  // board »). Icône 📌 (2026-10-28, proposition 5) : le tableau à post-it dessiné en
  // traits cyan-violet se fondait dans la pilule active violet-rose ; un émoji plein comme ses voisins.
  { id: 'besoins', label: 'Board', icon: '📌' },
  // Vue « Maintenance » (2026-10-22 : « la view tests est nulle, appelle-la maintenance
  // et mets des boutons pour faire toutes nos skills de maintenance »). L'identifiant reste `tests` :
  // les suites y vivent toujours, et un agent qui dit « tests » doit continuer d'y aboutir.
  { id: 'tests', label: 'Maintenance', icon: '🛠️' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
] as const

export type AppDestination = (typeof APP_DESTINATIONS)[number]['id']
/**
 * Routage n'est plus une section d'Agent Studio : il vit dans Settings depuis la demande
 * (2026-10-15, « la view Routage il faut la mettre dans Settings »). Connexion des providers, compte
 * actif, modèle par défaut : ce sont des REGLAGES de l'application, pas l'atelier des rôles.
 */
export type AgentStudioSection = 'topology' | 'workflows'
export type SettingsSection =
  // Les capacités, UNE section par registre (2026-10-23 : « sépare la partie avec 4 mots
  // en 4 views ») : elles formaient un seul écran « Skills · Hooks · Gates · Mods · Tools » à onglets
  // internes. `capabilities` garde l'identifiant historique et ouvre les SKILLS : c'est la section
  // d'arrivée de Settings (App.tsx) et l'adresse que les agents connaissent déjà.
  | 'capabilities'
  | 'hooks'
  | 'gates'
  | 'mods'
  | 'tools'
  // Routage : connexion des providers, comptes, modèle par défaut (venu d'Agent Studio).
  | 'routing'
  | 'behaviour'
  | 'providers'
  | 'preflight'
  // Serveurs MCP : section à part (2026-11-05 : « dans settings je vois pas le menu mcp »,
  // le panneau était enfoui sous trois autres dans Diagnostic).
  | 'mcp'
  // Coffre à clés : les clés API dont les agents se servent par leur nom, sans en voir la valeur.
  | 'cles'
  // Rules : les regles d'Autowin OS. La protection de production (ce qu'Autowin demande avant un
  // geste sur une base reelle) en est UNE — elle avait son propre onglet « Production » jusqu'a
  // la demande. Distincte de « capabilities » : accorder un outil n'est pas autoriser un
  // geste sur la prod.
  | 'rules'
  // Apparence de l'application (mode sombre / clair). Séparée de « behaviour » : régler ce qu'on
  // VOIT n'est pas régler ce que les agents FONT.
  | 'interface'
/**
 * Deux MÉTIERS distincts dans Task Manager, donc deux sections : surveiller des agents (alertes,
 * occurrences ratées) n'est pas éditer des tâches planifiées. Elles s'empilaient sur un seul écran.
 */
export type TaskManagerSection = 'watchdog' | 'planification'
/**
 * Worktrees empilait quatre blocs sur un seul écran — état du dépôt, santé, activité des agents,
 * plan des copies — si bien qu'il fallait défiler pour atteindre la carte, et que la vue ne pouvait
 * pas porter la même barre d'onglets que les autres (aucune section à afficher). Ce sont trois
 * QUESTIONS distinctes : où en sont mes copies (carte), qui travaille en ce moment (activité), et
 * qu'est-ce qui cloche (santé). L'état du dépôt reste hors sections : c'est le résumé qu'on lit en
 * premier, quel que soit l'onglet.
 */
export type WorktreeSection = 'carte' | 'activite' | 'sante'
/**
 * Deux onglets dans le Board (2026-10-31 : « la partie ticket azure faut trouver comment
 * la mettre dans board de manière élégante ») : les post-it des demandes, et les tickets des sources
 * externes que ces demandes rattachent (« + task », `#1234`). Le kanban reste seul dans son onglet.
 */
export type BoardSection = 'demandes' | 'tickets'

export interface AppLocation {
  destination: AppDestination
  section?:
    AgentStudioSection | SettingsSection | TaskManagerSection | WorktreeSection | BoardSection
  /** Panneau à ouvrir en arrivant : les Bureaux cachés vivent dans le chat. */
  panneau?: 'bureaux-caches'
  /**
   * FAUX quand la valeur demandee n'a ete comprise par AUCUNE regle et qu'on a repli sur `chat`.
   *
   * Le repli reste — refuser produirait des faux blocages — mais il ne doit plus SE TAIRE. Mesure du
   * 2026-08-26 : un agent a demande « worktrees », a recu `{tab: 'chat'}` sans la moindre erreur, et
   * a cru avoir navigue alors que l'app n'avait pas bouge. Un echec deguise en succes coute plus
   * cher qu'un echec.
   */
  reconnu?: boolean
}

const DESTINATION_IDS = new Set<string>(APP_DESTINATIONS.map(({ id }) => id))

const LEGACY_DESTINATIONS: Readonly<Record<string, AppDestination>> = {
  // Un agent pilote l'app par des NOMS : sans ces alias, « va sur l'accueil » en anglais ou en
  // jargon tableau-de-bord retomberait sur `chat`.
  home: 'accueil',
  accueil: 'accueil',
  dashboard: 'accueil',
  'tableau-de-bord': 'accueil',
  memory: 'knowledge',
  graph: 'knowledge',
  brain: 'knowledge',
  agents: 'agent-studio',
  roles: 'agent-studio',
  models: 'agent-studio',
  router: 'settings',
  routeur: 'settings',
  routage: 'settings',
  routing: 'settings',
  capabilities: 'settings',
  skills: 'settings',
  hooks: 'settings',
  gates: 'settings',
  mods: 'settings',
  plugins: 'settings',
  tools: 'settings',
  behaviour: 'settings',
  behavior: 'settings',
  observatoire: 'observatory',
  harness: 'observatory',
  harnais: 'observatory',
  prompt: 'observatory',
  'prompt-load': 'observatory',
  tasks: 'task-manager',
  scheduler: 'task-manager',
  planning: 'task-manager',
  planification: 'task-manager',
  watchdog: 'task-manager',
  // La carte des besoins : l'utilisateur l'a nommée « map des besoins », un agent dit aussi « demandes ».
  besoin: 'besoins',
  'carte des besoins': 'besoins',
  'carte-des-besoins': 'besoins',
  'map des besoins': 'besoins',
  // Ses anciens libellés : un agent qui a lu « Carte du projet » y aboutit.
  'carte du projet': 'besoins',
  'carte-du-projet': 'besoins',
  needs: 'besoins',
  demandes: 'besoins',
  backlog: 'besoins',
  // L'ancien écran Tickets : ses tickets externes vivent dans le Board, sa veille
  // « Autowin OS » dans Maintenance. Le Board précis (onglet Tickets) passe par `LEGACY_LOCATIONS`.
  tickets: 'besoins',
  ticket: 'besoins',
  veille: 'tests',
  // La vue Tests est multi-projets : un agent l'adresse aussi par « suite » ou « vitest ».
  test: 'tests',
  suite: 'tests',
  suites: 'tests',
  vitest: 'tests',
  jest: 'tests'
}

/**
 * LES BUREAUX CACHÉS, UN PANNEAU DU CHAT. L'utilisateur dit « Hdesk », l'interface dit
 * « Bureaux cachés », un agent dit aussi le singulier ou sans accent : sans ces entrées, ces
 * noms retomberaient en silence sur le chat, panneau fermé.
 */
const BUREAUX_CACHES: AppLocation = { destination: 'chat', panneau: 'bureaux-caches' }

const LEGACY_LOCATIONS: Readonly<Record<string, AppLocation>> = {
  hdesk: BUREAUX_CACHES,
  hdesks: BUREAUX_CACHES,
  'bureau caché': BUREAUX_CACHES,
  'bureau cache': BUREAUX_CACHES,
  'bureaux cachés': BUREAUX_CACHES,
  'bureaux caches': BUREAUX_CACHES,
  'bureau-cache': BUREAUX_CACHES,
  'bureaux-caches': BUREAUX_CACHES,
  // Les tickets externes, un onglet du Board : « va sur les tickets » ouvre CET onglet,
  // pas le kanban des demandes.
  tickets: { destination: 'besoins', section: 'tickets' },
  ticket: { destination: 'besoins', section: 'tickets' },
  'work items': { destination: 'besoins', section: 'tickets' },
  'work-items': { destination: 'besoins', section: 'tickets' },
  agents: { destination: 'agent-studio', section: 'topology' },
  roles: { destination: 'agent-studio', section: 'topology' },
  models: { destination: 'agent-studio', section: 'topology' },
  // Routage vit dans Settings : les anciens noms y aboutissent, sans quoi « va sur le
  // routeur » ouvrirait Agent Studio sur une section qui n'existe plus.
  router: { destination: 'settings', section: 'routing' },
  routeur: { destination: 'settings', section: 'routing' },
  routage: { destination: 'settings', section: 'routing' },
  routing: { destination: 'settings', section: 'routing' },
  // La vue Workflows est une SECTION d'Agent Studio, pas une destination : sans ces entrées,
  // « va sur Workflows » retombait en silence sur le chat (constaté le 2026-09-17, un agent a cru
  // avoir navigué). Les RUN.md s'y lisent, un agent les adresse aussi par « runs ».
  workflows: { destination: 'agent-studio', section: 'workflows' },
  workflow: { destination: 'agent-studio', section: 'workflows' },
  runs: { destination: 'agent-studio', section: 'workflows' },
  run: { destination: 'agent-studio', section: 'workflows' },
  capabilities: { destination: 'settings', section: 'capabilities' },
  skills: { destination: 'settings', section: 'capabilities' },
  // Chaque registre a sa section : « va sur les hooks » ouvre les hooks, plus l'écran
  // des skills.
  hooks: { destination: 'settings', section: 'hooks' },
  gates: { destination: 'settings', section: 'gates' },
  mods: { destination: 'settings', section: 'mods' },
  plugins: { destination: 'settings', section: 'mods' },
  tools: { destination: 'settings', section: 'tools' },
  interface: { destination: 'settings', section: 'interface' },
  apparence: { destination: 'settings', section: 'interface' },
  theme: { destination: 'settings', section: 'interface' },
  'theme-clair': { destination: 'settings', section: 'interface' },
  behaviour: { destination: 'settings', section: 'behaviour' },
  behavior: { destination: 'settings', section: 'behaviour' },
  // L'onglet Rules, et la regle Production qu'il porte : « production » menait a l'ancien onglet,
  // il doit continuer d'aboutir au meme reglage.
  rules: { destination: 'settings', section: 'rules' },
  règles: { destination: 'settings', section: 'rules' },
  regles: { destination: 'settings', section: 'rules' },
  production: { destination: 'settings', section: 'rules' },
  // Le Diagnostic de démarrage n'avait AUCUN nom : « diagnostic » retombait sur le chat, donc la
  // seule section qui porte une alerte n'était atteignable qu'à la souris (constat du 2026-09-10).
  diagnostic: { destination: 'settings', section: 'preflight' },
  preflight: { destination: 'settings', section: 'preflight' },
  mcp: { destination: 'settings', section: 'mcp' },
  cles: { destination: 'settings', section: 'cles' },
  clés: { destination: 'settings', section: 'cles' },
  coffre: { destination: 'settings', section: 'cles' },
  prerequis: { destination: 'settings', section: 'preflight' },
  prérequis: { destination: 'settings', section: 'preflight' },
  // Un agent pilote l'app par des NOMS : sans ces entrées, la séparation Watchdog/Planification ne
  // serait atteignable qu'à la souris, et « va sur le watchdog » atterrirait sur la mauvaise section.
  watchdog: { destination: 'task-manager', section: 'watchdog' },
  planification: { destination: 'task-manager', section: 'planification' },
  planning: { destination: 'task-manager', section: 'planification' },
  scheduler: { destination: 'task-manager', section: 'planification' }
}

function isAppDestination(value: string): value is AppDestination {
  return DESTINATION_IDS.has(value)
}

/**
 * Le nom AFFICHE est une adresse valide.
 *
 * Un agent qui pilote l'app lit la barre laterale : il connait « Worktrees » et « Agent Studio », pas
 * `worktree` ni `agent-studio`. Ces libelles retombaient sur `chat`, donc la navigation echouait en
 * silence (mesure du 2026-08-26, deux libelles sur neuf inatteignables). L'index est DERIVE de
 * `APP_DESTINATIONS` : ajouter une destination l'y inscrit sans liste a maintenir en double.
 *
 * Le pluriel est accepte parce que le libelle est au pluriel la ou l'identifiant est au singulier —
 * c'est exactement l'ecart qui a produit le defaut.
 */
const DESTINATIONS_PAR_LIBELLE: Readonly<Record<string, AppDestination>> = Object.fromEntries(
  APP_DESTINATIONS.flatMap(({ id, label }) => {
    const nom = label.toLowerCase()
    return [
      [nom, id],
      [`${nom}s`, id],
      [id.replace(/-/g, ' '), id]
    ] as Array<[string, AppDestination]>
  })
)

/** Converge les anciens noms émis par les agents et versions précédentes vers le shell courant. */
export function normalizeDestination(value: string): AppDestination {
  if (isAppDestination(value)) return value
  return LEGACY_DESTINATIONS[value.toLowerCase()] ?? 'chat'
}

export function resolveAppLocation(value: string): AppLocation {
  const normalized = value.toLowerCase().trim()
  const heritee = LEGACY_LOCATIONS[normalized]
  if (heritee) return heritee
  const parLibelle = DESTINATIONS_PAR_LIBELLE[normalized]
  if (parLibelle) return { destination: parLibelle }
  if (isAppDestination(normalized) || LEGACY_DESTINATIONS[normalized]) {
    return { destination: normalizeDestination(normalized) }
  }
  // Repli conserve, mais AVOUE : l'appelant peut distinguer « chat demande » de « rien compris ».
  return { destination: 'chat', reconnu: false }
}
