/**
 * LES BOARDS DES COLLÈGUES (demande utilisateur du 2026-10-28, conv-1210).
 *
 * Demande : « fais afficher dans mon Board les post-it des collègues qui écrivent dans le même
 * dossier de la GED, avec leur nom sur chaque post-it et en lecture seule ». Chaque poste recopie
 * son Board dans SON sous-dossier du dossier du Board (`board-dossier.ts`, conv-1206) ; ce fichier
 * décrit ce que `board.json` contient, pour que le processus principal relise ceux des AUTRES postes
 * et que la vue les pose à côté des siens.
 *
 * Types seuls (la forme du fichier) : partagés par l'écriture, la relecture et la vue.
 */

/** Les étages du Board, tels qu'ils sont écrits dans `board.json`. */
export type EtageDuFichier = 'a-faire' | StatutDuFichier

/** Les états prouvés d'une demande — mêmes valeurs que `StatutDemande` de la carte des besoins. */
export type StatutDuFichier = 'prouve' | 'refuse' | 'en-cours' | 'sans-preuve'

/** Une demande d'un post-it de `board.json`. */
export interface DemandeDuFichier {
  rang: number
  messageId?: string
  titre: string
  /** Le message entier (conv-1278) ; absent d'un fichier écrit avant, ou quand `titre` suffit. */
  texte?: string
  statut: StatutDuFichier
  constat: string
  date?: string
  demandeur?: { nom: string; email?: string }
  workItems?: { sourceId: string; id: string; titre?: string }[]
}

/** Un post-it de `board.json` : un fil, à l'étage affiché sur le Board du poste qui l'a écrit. */
export interface PostItDuFichier {
  /** Le pont vers le fil : l'identifiant de la conversation dans l'Autowin de ce poste. */
  conversationId: string
  titre: string
  projet: { cle: string; libelle: string }
  /** L'étage affiché sur le Board : l'état posé à la main s'il tient encore, sinon `etatPreuve`. */
  etage: EtageDuFichier
  /** L'état de la dernière demande du fil, tel que les preuves le donnent. */
  etatPreuve: StatutDuFichier
  manuel?: { etage: EtageDuFichier; a: string }
  derniereDemande: string
  demandeur?: { nom: string; email?: string }
  demandes: DemandeDuFichier[]
}

/** Le Board qu'un AUTRE poste a écrit dans son sous-dossier, relu et contrôlé. */
export interface BoardDUnCollegue {
  /** Le sous-dossier du collègue : son compte Windows. */
  poste: string
  /** Le nom écrit sur ses post-it : celui que son poste a écrit (`nom`), sinon `poste` (conv-1230). */
  nom: string
  /** Quand son poste a écrit ce fichier (ISO), s'il le dit. */
  enregistreA?: string
  postIts: PostItDuFichier[]
}

/** Ce que la vue reçoit : les Boards lisibles des collègues, et ce qui n'a pas pu être lu. */
export interface BoardsDesCollegues {
  collegues: BoardDUnCollegue[]
  /** Dossier injoignable, ou fichier illisible : dit en clair, jamais bloquant. */
  erreur?: string
}
