/**
 * TERMINAL INTÉGRÉ DU CHAT — le CONTRAT partagé entre le processus principal, le pont (preload) et
 * l'interface (conv-1362, lot 3/3, 2026-10-31).
 *
 * Pourquoi un fichier à part : le moteur (`src/main/terminal-integre.ts`) et le panneau, écrit dans un
 * lot suivant, doivent parler la même langue sans se voir. Tout ce qu'ils échangent est décrit ICI,
 * une seule fois.
 *
 * Ce fichier ne dépend de rien (ni Electron, ni Node, ni React) : il est importé des deux côtés.
 */

/**
 * Ce qu'on garde de la sortie de chaque terminal : 200 Ko, repassés au panneau quand il se rouvre.
 * Compté en caractères de la chaîne (UTF-16), pas en octets UTF-8 : c'est ce que le moteur tient en
 * mémoire et ce que le panneau rejoue.
 */
export const TAMPON_TERMINAL_MAX = 200 * 1024

/** Taille en cases : `lignes` est la hauteur du terminal, à ne pas confondre avec sa sortie. */
export interface TailleTerminal {
  colonnes: number
  lignes: number
}

/** Un terminal, toujours rattaché à UN fil : chaque conversation a les siens. */
export interface TerminalIntegre {
  /** Identifiant opaque, celui des appels de l'interface. */
  id: string
  conversationId: string
  /**
   * Rang dans le fil (1, 2…), jamais réutilisé tant que le fil vit. C'est ce que voit l'utilisateur
   * et ce que `terminal_lire` accepte : un numéro n'a de sens que dans son fil, donc l'outil ne peut
   * même pas désigner le terminal d'un autre.
   */
  numero: number
  /** Dossier d'ouverture : le dossier de travail du fil. */
  dossier: string
  colonnes: number
  lignes: number
  /** Vrai tant que le shell tourne ; faux après un `exit`. Le terminal reste lisible jusqu'à sa fermeture. */
  enCours: boolean
  /** Code de sortie du shell, une fois qu'il s'est arrêté de lui-même. */
  codeSortie?: number
}

/** L'état d'UN fil, poussé à l'interface à chaque ouverture, fermeture ou fin de shell (`surEtat`). */
export interface EtatTerminal {
  conversationId: string
  /** Les terminaux de CE fil, dans l'ordre d'ouverture. */
  terminaux: TerminalIntegre[]
  /**
   * La raison exacte pour laquelle le module natif n'a pas pu être chargé. Absente tant qu'aucun échec
   * n'est connu : le module ne se charge qu'à la première ouverture.
   */
  indisponible?: string
}

/** Un morceau de sortie. `sequence` croît de 1 à chaque morceau, par terminal. */
export interface DonneesTerminal {
  terminalId: string
  conversationId: string
  donnees: string
  sequence: number
}

/**
 * Le tampon à rejouer à la réouverture du panneau, brut (séquences de contrôle comprises), et la
 * `sequence` du dernier morceau qu'il contient. Le panneau s'abonne d'abord, lit ensuite, et ignore
 * tout `DonneesTerminal` de `sequence` inférieure ou égale : sinon le morceau arrivé entre les deux
 * s'afficherait deux fois.
 */
export interface TamponTerminal {
  terminalId: string
  donnees: string
  sequence: number
}

/** L'ouverture peut échouer sans exception : le panneau affiche `raison` telle quelle. */
export type ResultatOuvertureTerminal =
  { ok: true; terminal: TerminalIntegre } | { ok: false; raison: string }

/**
 * Noms des canaux IPC. `evenementDonnees` et `evenementEtat` sont les seuls canaux du principal VERS
 * le rendu ; personne ne réécrit ces noms à la main ailleurs.
 */
export const CANAUX_TERMINAL = {
  etat: 'terminal:etat',
  ouvrir: 'terminal:ouvrir',
  ecrire: 'terminal:ecrire',
  redimensionner: 'terminal:redimensionner',
  fermer: 'terminal:fermer',
  tampon: 'terminal:tampon',
  evenementDonnees: 'terminal:evenement-donnees',
  evenementEtat: 'terminal:evenement-etat'
} as const

export type CanalTerminal = (typeof CANAUX_TERMINAL)[keyof typeof CANAUX_TERMINAL]

/** L'API exposée par le preload à l'interface : `window.api.terminal`. */
export interface ApiTerminal {
  etat(conversationId: string): Promise<EtatTerminal>
  /** Ouvre un terminal de plus dans le fil. Le dossier vient du fil, jamais de l'interface. */
  ouvrir(conversationId: string, taille: TailleTerminal): Promise<ResultatOuvertureTerminal>
  /** Envoie ce que l'utilisateur tape. Sans effet sur un terminal fermé ou dont le shell est fini. */
  ecrire(terminalId: string, donnees: string): Promise<void>
  redimensionner(terminalId: string, taille: TailleTerminal): Promise<void>
  /** Arrête le shell de CE terminal, par son processus, et l'oublie. */
  fermer(terminalId: string): Promise<void>
  /** Le tampon à rejouer, ou `null` si ce terminal n'existe plus. */
  tampon(terminalId: string): Promise<TamponTerminal | null>
  /** S'abonne à la sortie (tous fils confondus) ; rend la fonction de désabonnement. */
  surDonnees(rappel: (donnees: DonneesTerminal) => void): () => void
  /** S'abonne aux changements d'état (tous fils confondus) ; rend la fonction de désabonnement. */
  surEtat(rappel: (etat: EtatTerminal) => void): () => void
}
