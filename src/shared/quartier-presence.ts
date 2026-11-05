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

/**
 * L'animal qui représente les agents d'un poste (demande utilisateur du 2026-11-04, conv-1537) :
 * « choisir dans les settings de l'accueil quel animal on veut pour représenter nos agents ; notre
 * setting doit affecter ce que les autres voient ». Choisi dans les réglages de l'Accueil, rangé dans
 * le réglage du Board du poste, écrit dans `presence.json` : chaque collègue dessine ce même animal.
 * Un par atlas de la scène (`src/renderer/src/assets/quartier/atlas*.avif`), de même grille.
 */
export const ANIMAUX_AGENTS = ['tanuki', 'renard', 'panda', 'panda-roux'] as const
export type AnimalAgent = (typeof ANIMAUX_AGENTS)[number]
/** Sans choix, les agents restent des tanukis : ce que l'Accueil dessinait avant le réglage. */
export const ANIMAL_PAR_DEFAUT: AnimalAgent = 'tanuki'

/** Un animal connu, ou `null` : la valeur vient d'un fichier ou de la vue, jamais d'une source sûre. */
export function animalLisible(v: unknown): AnimalAgent | null {
  return typeof v === 'string' && (ANIMAUX_AGENTS as readonly string[]).includes(v)
    ? (v as AnimalAgent)
    : null
}

/**
 * « Afficher mes agents à » (demande utilisateur du 2026-11-05, conv-1599) : les postes à qui CE poste
 * masque ses agents, écrits dans `presence.json`. L'Autowin d'un poste nommé n'affiche alors pas ces
 * agents. C'est un réglage d'AFFICHAGE, pas une protection : le fichier reste lisible sur le partage.
 * 50 postes au plus : la liste ne doit pas manger la place des agents sous `PRESENCE_TAILLE_MAX`.
 */
export const PRESENCE_MASQUES_MAX = 50
/** Un nom de poste (sous-dossier, compte Windows) plus long n'en est pas un. */
export const PRESENCE_POSTE_MAX = 64

const HORS_NOM_DE_POSTE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>:"/\\|?*]/

/**
 * Une liste de postes lisible : chaînes non vides, sans caractère interdit dans un nom de dossier,
 * en minuscules (Windows ne distingue pas la casse), sans doublon, `PRESENCE_MASQUES_MAX` au plus.
 * Tout le reste est écarté : la valeur vient d'un fichier ou de la vue, jamais d'une source sûre.
 */
export function postesLisibles(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const sortie: string[] = []
  for (const brut of v) {
    if (sortie.length >= PRESENCE_MASQUES_MAX) break
    if (typeof brut !== 'string') continue
    const poste = brut.trim().toLowerCase()
    if (!poste || poste.length > PRESENCE_POSTE_MAX || HORS_NOM_DE_POSTE.test(poste)) continue
    if (!sortie.includes(poste)) sortie.push(poste)
  }
  return sortie
}

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
  /**
   * L'animal choisi sur ce poste (conv-1537). Absent dans un fichier écrit par une version d'avant
   * le réglage : le lecteur garde alors l'animal tiré du nom du poste (`animalDuPoste`).
   */
  animal?: AnimalAgent
  /**
   * Les postes (en minuscules) à qui ce poste masque ses agents (conv-1599). Absent = visibles pour
   * tous ; un lecteur nommé ici ne les affiche pas.
   */
  masquesPour?: string[]
  agents: AgentPublie[]
}

/**
 * Une personne trouvée sur le partage (conv-1599) : tout `presence.json` lisible, en ligne ou non,
 * pour que les réglages de l'Accueil puissent la nommer dans « afficher les agents de » et
 * « afficher mes agents à ».
 */
export interface PersonneDuPartage {
  /** Le nom de son sous-dossier (compte Windows), jamais la valeur écrite dans le fichier. */
  poste: string
  prenom: string
  /** Ses agents peuvent apparaître ici maintenant : fichier récent, partage ouvert, pas masqué pour moi. */
  enLigne: boolean
}

/** Un collègue vu dans le village : relu de SON `presence.json`, validé champ par champ. */
export interface PresenceDUnCollegue {
  /** Le nom de son sous-dossier (compte Windows), jamais la valeur écrite dans le fichier. */
  poste: string
  nom: string
  /** Le premier mot de `nom`, affiché au survol (D9). */
  prenom: string
  /** L'animal qu'il a choisi (conv-1537) ; absent = fichier d'une version d'avant le réglage. */
  animal?: AnimalAgent
  agents: AgentPublie[]
}

/** Ce que le canal `os:quartier-presence:collegues` rend à la vue. */
export interface PresencesDesCollegues {
  collegues: PresenceDUnCollegue[]
  /**
   * Toutes les personnes du partage, en ligne ou non (conv-1599) ; absent = processus principal d'avant
   * le réglage : la vue retombe sur `collegues`.
   */
  personnes?: PersonneDuPartage[]
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
