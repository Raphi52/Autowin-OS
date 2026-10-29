/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — le CONTRAT partagé entre le processus principal, le pont (preload) et
 * l'interface (conv-1286, lot 1/5, 2026-10-29).
 *
 * Pourquoi un fichier à part : quatre lots s'appuient dessus en parallèle (IPC, panneau, commandes de
 * l'agent, annotations envoyées au chat). Tout ce qu'ils échangent est décrit ICI, une seule fois ;
 * le moteur vit dans `src/main/navigateur-integre.ts`, les scripts de page dans
 * `src/main/navigateur-page-script.ts`.
 *
 * Ce fichier ne dépend de rien (ni Electron, ni Node, ni React) : il est importé des deux côtés.
 */

/** Un onglet, toujours rattaché à UN fil : chaque conversation a ses propres onglets. */
export interface OngletNavigateur {
  id: string
  conversationId: string
  url: string
  titre: string
  chargement: boolean
  peutReculer: boolean
  peutAvancer: boolean
}

/** Mode de la page active : annoter (élément ou zone + commentaire), choisir (un clic), ou aucun. */
export type ModeNavigateur = 'annoter' | 'choisir' | null

/** Une action d'écriture de l'agent attend l'accord de l'utilisateur pour ce site. */
export interface DemandeAccordNavigateur {
  /** Origine du site (`https://exemple.fr`), ou le protocole quand la page n'a pas d'origine. */
  origine: string
  /** Ce que l'agent veut faire, en mots courants (« cliquer sur bouton « Envoyer » »). */
  action: string
}

/** L'état d'UN fil, poussé à l'interface à chaque changement (`surEtat`). */
export interface EtatNavigateur {
  conversationId: string
  /** Les onglets de CE fil, dans l'ordre d'ouverture. */
  onglets: OngletNavigateur[]
  ongletActif: string | null
  /** Vrai pendant qu'une action de l'agent se joue : l'interface montre le bandeau « l'agent pilote ». */
  agentPilote: boolean
  demandeAccord?: DemandeAccordNavigateur
  /** Mode de la page active, si ce fil est celui affiché ; `null` sinon. */
  mode: ModeNavigateur
  /** Nombre d'annotations en attente d'envoi au chat pour ce fil. */
  nombreAnnotations: number
}

/** Rectangle en pixels CSS de la page (ou du rendu, pour `poserCadre`). */
export interface RectNavigateur {
  x: number
  y: number
  largeur: number
  hauteur: number
}

/** Styles calculés de l'élément annoté, ce dont on a besoin pour demander un changement visuel. */
export interface StylesElementNavigateur {
  police: string
  taille: string
  couleur: string
  /** Fond EFFECTIF : le premier fond non transparent en remontant les parents. */
  fond: string
  /** Marges extérieures et retraits intérieurs, sous la forme « marge … · retrait … ». */
  marges: string
}

/** Une annotation (mode Annoter) ou un élément choisi (mode Choisir, commentaire vide). */
export interface AnnotationNavigateur {
  id: string
  ongletId: string
  url: string
  selecteur: string
  texteElement: string
  styles: StylesElementNavigateur
  rect: RectNavigateur
  commentaire: string
  /** Capture PNG de la zone, en `data:image/png;base64,…` ; absente si la capture a échoué. */
  captureDataUrl?: string
}

/** Un élément interactif de la page, numéroté pour que l'agent puisse le viser par `ref`. */
export interface ElementInstantane {
  ref: number
  role: string
  nom: string
  /** Valeur d'un champ. JAMAIS remplie pour un champ de mot de passe ou de code à usage unique. */
  valeur?: string
}

/** Ce que l'agent lit d'une page. */
export interface InstantanePage {
  url: string
  titre: string
  texte: string
  elements: ElementInstantane[]
}

export type NiveauConsole = 'info' | 'warning' | 'error' | 'debug'

export interface LigneConsole {
  ongletId: string
  niveau: NiveauConsole
  message: string
  source: string
  ligne: number
  /** Horodatage en millisecondes (epoch). */
  horodatage: number
}

/** Une requête réseau en échec : statut HTTP ≥ 400, ou erreur réseau (sans statut). */
export interface RequeteEchouee {
  ongletId: string
  url: string
  methode: string
  statut?: number
  erreur?: string
  typeRessource: string
  horodatage: number
}

export interface ReglagesNavigateur {
  /** Garder les cookies et connexions d'un lancement à l'autre (session persistante). */
  garderCookies: boolean
  /** Un lien cliqué dans le chat s'ouvre dans ce navigateur plutôt que dans celui du système. */
  ouvrirLiensDuChatIci: boolean
}

export const REGLAGES_NAVIGATEUR_PAR_DEFAUT: ReglagesNavigateur = {
  garderCookies: true,
  ouvrirLiensDuChatIci: true
}

export type ReponseAccordNavigateur = 'une-fois' | 'toujours' | 'refuser'

/** Ce que l'agent vise : un élément numéroté par l'instantané, un sélecteur CSS, ou un point. */
export type CibleAgentNavigateur =
  { ref: number } | { selecteur: string } | { x: number; y: number }

/**
 * Une action de l'agent dans la page. `clic`, `saisir` et `touche` ÉCRIVENT (accord du site requis
 * hors poste local) ; `defiler` ne fait que lire. `saisir` sans cible tape dans le champ actif ;
 * `remplacer` sélectionne d'abord le contenu existant. `touche` accepte « Enter », « Tab »,
 * « ArrowDown », « Control+A »…
 */
export type ActionAgentNavigateur =
  | { type: 'clic'; cible: CibleAgentNavigateur; double?: boolean }
  | { type: 'saisir'; texte: string; cible?: CibleAgentNavigateur; remplacer?: boolean }
  | { type: 'touche'; touche: string; cible?: CibleAgentNavigateur }
  | { type: 'defiler'; dy: number; dx?: number; cible?: CibleAgentNavigateur }

export type RefusActionNavigateur =
  | 'aucun-onglet'
  | 'cible-introuvable'
  | 'mot-de-passe'
  | 'cadre-integre'
  | 'accord-refuse'
  | 'page-indisponible'
  /** La page a changé de site entre l'accord et l'action : rien n'est envoyé, l'agent relit. */
  | 'page-changee'

/** Le compte rendu d'une action, prêt à être rendu à l'agent. */
export interface ResultatActionNavigateur {
  ok: boolean
  message: string
  refus?: RefusActionNavigateur
}

/**
 * Noms des canaux IPC. Le lot IPC les branche ; personne ne les réécrit à la main ailleurs.
 * `evenementEtat` est le seul canal du principal VERS le rendu (pousse un `EtatNavigateur`).
 */
export const CANAUX_NAVIGATEUR = {
  etat: 'navigateur:etat',
  afficherFil: 'navigateur:afficher-fil',
  ouvrir: 'navigateur:ouvrir',
  naviguer: 'navigateur:naviguer',
  reculer: 'navigateur:reculer',
  avancer: 'navigateur:avancer',
  recharger: 'navigateur:recharger',
  arreter: 'navigateur:arreter',
  activerOnglet: 'navigateur:activer-onglet',
  fermerOnglet: 'navigateur:fermer-onglet',
  poserCadre: 'navigateur:poser-cadre',
  basculerMode: 'navigateur:basculer-mode',
  annotations: 'navigateur:annotations',
  supprimerAnnotation: 'navigateur:supprimer-annotation',
  viderAnnotations: 'navigateur:vider-annotations',
  repondreAccord: 'navigateur:repondre-accord',
  reglagesLire: 'navigateur:reglages-lire',
  reglagesEcrire: 'navigateur:reglages-ecrire',
  effacerDonnees: 'navigateur:effacer-donnees',
  ouvrirDansNavigateurParDefaut: 'navigateur:ouvrir-dans-navigateur-par-defaut',
  evenementEtat: 'navigateur:evenement-etat'
} as const

export type CanalNavigateur = (typeof CANAUX_NAVIGATEUR)[keyof typeof CANAUX_NAVIGATEUR]

/**
 * L'API exposée par le preload à l'interface (`window.api.navigateur`, au choix du lot IPC).
 *
 * `afficherFil` s'ajoute à la liste demandée : `poserCadre(rect, zoom)` ne dit pas QUEL fil est à
 * l'écran, or seul l'onglet actif du fil affiché doit être visible. L'interface l'appelle quand le
 * fil affiché change (et avec `null` quand le panneau se ferme).
 */
export interface ApiNavigateur {
  etat(conversationId: string): Promise<EtatNavigateur>
  afficherFil(conversationId: string | null): Promise<void>
  /** Ouvre l'adresse dans un NOUVEL onglet du fil, qui devient actif. Rend l'id de l'onglet. */
  ouvrir(conversationId: string, url: string): Promise<string>
  /** Charge l'adresse dans cet onglet. */
  naviguer(ongletId: string, url: string): Promise<void>
  reculer(ongletId: string): Promise<void>
  avancer(ongletId: string): Promise<void>
  recharger(ongletId: string): Promise<void>
  arreter(ongletId: string): Promise<void>
  activerOnglet(ongletId: string): Promise<void>
  fermerOnglet(ongletId: string): Promise<void>
  /** Cadre du panneau en pixels CSS du rendu, et le zoom de la fenêtre ; `null` cache la page. */
  poserCadre(rect: RectNavigateur | null, zoom: number): Promise<void>
  basculerMode(mode: ModeNavigateur): Promise<void>
  annotations(conversationId: string): Promise<AnnotationNavigateur[]>
  supprimerAnnotation(id: string): Promise<void>
  viderAnnotations(conversationId: string): Promise<void>
  repondreAccord(origine: string, reponse: ReponseAccordNavigateur): Promise<void>
  reglages: {
    lire(): Promise<ReglagesNavigateur>
    ecrire(reglages: Partial<ReglagesNavigateur>): Promise<ReglagesNavigateur>
  }
  /** Efface cookies, stockage et cache des deux sessions du navigateur. */
  effacerDonnees(): Promise<void>
  ouvrirDansNavigateurParDefaut(url: string): Promise<void>
  /** S'abonne aux changements d'état (tous fils confondus) ; rend la fonction de désabonnement. */
  surEtat(rappel: (etat: EtatNavigateur) => void): () => void
}

/** Protocoles qu'un onglet accepte de charger. `javascript:`, `data:` et le reste sont refusés. */
const PROTOCOLES_ACCEPTES = new Set(['http:', 'https:', 'file:'])

/**
 * Transforme ce que l'utilisateur ou l'agent tape en adresse chargeable, ou `null` si elle est
 * refusée. « exemple.fr » → https ; « localhost:5173 » → http (un serveur de dev n'a pas de TLS).
 */
export function normaliserUrlNavigateur(saisie: string): string | null {
  const brut = saisie.trim()
  if (!brut) return null
  if (brut === 'about:blank') return brut
  const avecProtocole = /^[a-z][a-z0-9+.-]*:/i.test(brut) && !/^[^/:]+:\d+(\/|$)/.test(brut)
  let candidat = brut
  if (!avecProtocole) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(brut)
    candidat = `${local ? 'http' : 'https'}://${brut}`
  }
  try {
    const url = new URL(candidat)
    return PROTOCOLES_ACCEPTES.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
