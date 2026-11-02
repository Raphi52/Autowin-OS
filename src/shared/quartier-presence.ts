/**
 * LA PRÉSENCE DU POSTE DANS LE VILLAGE COMMUN (plan « Village commun », conv-1429, 2026-11-02).
 *
 * Demande : voir dans l'Accueil les tanukis des collègues à côté des siens. Cadrage tranché dans
 * `grill/agent-hq-japon-town.md` : D-8 (les agents des collègues s'affichent comme les miens), D-9
 * (partage actif pour tous, filtre obligatoire avant toute écriture), D6 (un interrupteur coupe le
 * partage du poste ; un fil privé garde son animal sans titre).
 *
 * Chaque poste écrit `<dossier du Board>\<compte Windows>\presence.json`, à côté de son `board.json`
 * (`board-dossier.ts`). Le Board s'écrit au plus toutes les 30 s et pèse des mégaoctets : trop lent et
 * trop lourd pour dire qui tourne À L'INSTANT. D'où ce petit fichier à part.
 *
 * Types et bornes seuls : partagés par l'écrivain (`src/main/quartier-presence.ts`), le lecteur des
 * collègues, le pont et la vue.
 */

export const FORMAT_PRESENCE = 'autowin-presence/1'
export const FICHIER_PRESENCE = 'presence.json'

/** Le pic mesuré sur un poste : 15 personnages en même temps (`AGENTS_MAX` du registre de la scène). */
export const PRESENCE_AGENTS_MAX = 15
/** Un titre publié est coupé à 80 caractères, APRÈS le filtre (`quartier-presence-filtre.ts`). */
export const PRESENCE_TITRE_MAX = 80
/** Deux écritures sur le partage sont espacées d'au moins 5 s : une rafale d'outils n'écrit qu'une fois. */
export const PRESENCE_DELAI_ECRITURE_MS = 5_000
/** Le battement : le fichier est réécrit toutes les 60 s même sans changement, preuve que le poste vit. */
export const PRESENCE_BATTEMENT_MS = 60_000
/** Un lecteur ignore un fichier plus vieux : le poste est éteint, hors réseau, ou l'app est fermée. */
export const PRESENCE_PERIMEE_MS = 3 * 60_000
/** Le fichier tient sous 16 Ko : 15 agents bornés n'en prennent pas la moitié. */
export const PRESENCE_TAILLE_MAX = 16 * 1024

/** Les phases d'un tanuki, celles du registre de la scène (`agents-quartier.ts`). */
export const PHASES_PRESENCE = ['travail', 'reflexion', 'attente', 'plante', 'fini'] as const
export type PhasePresence = (typeof PHASES_PRESENCE)[number]

/**
 * Les métiers connus, recopiés du type `Metier` de `src/renderer/src/quartier/quartier-metiers.ts`
 * (le processus principal ne peut pas importer la vue). Le lecteur des collègues ramène un métier
 * inconnu à `null` : l'agent reste visible, au repos, au lieu d'ouvrir un poste qui n'existe pas.
 */
export const METIERS_PRESENCE = [
  'commandes',
  'runs',
  'lire',
  'chercher',
  'brain',
  'web',
  'modifier',
  'tester',
  'ecran',
  'publier',
  'tickets',
  'messages',
  'taches',
  'sql'
] as const

/** Au plus 20 collègues relus : le village reste lisible, et un partage encombré ne coûte pas plus. */
export const PRESENCE_COLLEGUES_MAX = 20
/** Deux relectures du partage sont espacées d'au moins 4 s, quel que soit le nombre d'appels. */
export const PRESENCE_DELAI_RELECTURE_MS = 4_000

/** Un agent tel qu'il est écrit sur le partage. */
export interface AgentPublie {
  /** L'identifiant du fil sur son poste (`conv-1430`) : il ne s'ouvre pas ailleurs (D10). */
  id: string
  /** Le titre du fil, filtré puis coupé ; absent pour un fil privé (D6). */
  titre?: string
  phase: PhasePresence
  /** Le poste de travail de la scène (`lire`, `modifier`…), `null` tant qu'aucun outil n'a tourné. */
  metier: string | null
  /** Depuis quand il est dans cette phase (ISO). */
  depuis: string
}

/** Le contenu de `presence.json`. */
export interface PresenceDuPoste {
  format: typeof FORMAT_PRESENCE
  /** Le sous-dossier du poste (compte Windows) : le lecteur en tire la couleur de la personne. */
  poste: string
  /** Le nom choisi pour le Board, sinon le compte Windows. */
  nom: string
  /** Quand le fichier a été écrit (ISO) : au-delà de `PRESENCE_PERIMEE_MS`, il est ignoré. */
  enregistreA: string
  /** Partage coupé sur ce poste (D6) : `agents` est alors vide. Jamais de suppression sur le partage. */
  coupe?: true
  agents: AgentPublie[]
}

/** Un collègue vu dans le village : relu de SON `presence.json`, validé champ par champ. */
export interface PresenceDUnCollegue {
  /** Le nom de son sous-dossier (compte Windows), jamais la valeur écrite dans le fichier. */
  poste: string
  nom: string
  /** Le premier mot de `nom`, affiché au survol (D9). */
  prenom: string
  agents: AgentPublie[]
}

/** Ce que le canal `os:quartier-presence:collegues` rend à la vue. */
export interface PresencesDesCollegues {
  collegues: PresenceDUnCollegue[]
  /** Partage injoignable, ou fichiers écartés (trop gros, illisibles) ; absent = tout va bien. */
  erreur?: string
}

/** Ce que la vue envoie au processus principal : l'instantané du registre, sans filtre. */
export interface AgentAPublier {
  id: string
  titre: string
  phase: PhasePresence
  metier: string | null
  /** Ms epoch. */
  depuis: number
  /** Fil marqué privé (D6) : publié sans titre. Rempli par la vue (lot 3 du plan). */
  prive?: boolean
}

/** Ce que l'écrivain dit de lui-même : pour un réglage, une preuve, un diagnostic. */
export interface EtatDeLaPresence {
  /** Le réglage du poste (`partagerPresence` du réglage du Board) : coupé = `false`. */
  partager: boolean
  /** Le fichier visé, `null` sans dossier du Board. */
  fichier: string | null
  /** La dernière écriture réussie depuis le démarrage. */
  dernier?: { a: number; agents: number; coupe: boolean }
  /** Le dernier échec (partage injoignable, droits…), effacé au prochain succès. */
  erreur?: string
}
