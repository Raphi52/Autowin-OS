/**
 * LE DOSSIER DU BOARD (demande utilisateur du 2026-10-28, conv-1206).
 *
 * Demande : « dans le board il faut qu'on puisse définir un dossier [sur le partage réseau de
 * l'équipe] pour pouvoir y stocker les éléments affichés sur le board et faire le pont vers les
 * conv ». Le Board ne vivait que dans l'app ; un dossier choisi sur ce poste en reçoit désormais une
 * copie — un post-it par fil, chacun portant l'identifiant de sa conversation — à chaque calcul.
 *
 * Types seuls : partagés par le processus principal (`src/main/board-dossier.ts`), le pont et la vue.
 */

/** Les étages du Board : « à faire » (posé à la main seulement) et les états prouvés d'une demande. */
export const ETAGES_DU_BOARD = ['a-faire', 'refuse', 'en-cours', 'sans-preuve', 'prouve'] as const
export type EtageDuBoard = (typeof ETAGES_DU_BOARD)[number]

/** Un état posé à la main sur un post-it (glisser), rangé sur ce poste — même forme que la vue. */
export interface EtatManuelDuBoard {
  etage: EtageDuBoard
  /** Quand il a été posé (ms epoch) : une demande plus récente du fil le rend caduc. */
  a: number
}

/** Ce que la vue affiche du dossier : choisi ou non, où vont les fichiers, le dernier envoi. */
export interface EtatDuDossierDuBoard {
  /** Le dossier choisi, tel qu'il a été saisi ; `null` = aucun, rien n'est écrit. */
  dossier: string | null
  /** Le sous-dossier de CE poste, où les fichiers sont écrits (un par compte Windows). */
  cible: string | null
  /**
   * Les projets du Board recopiés (leur `cle` : le dossier de travail, ou la catégorie). Absent =
   * tous, y compris ceux à venir ; présent = seulement ceux-là (conv-1211, `board-projets-partages.ts`).
   */
  projets?: string[]
  /** Le dernier enregistrement réussi depuis le démarrage. */
  dernier?: { a: number; postIts: number; fichier: string }
  /** Le dernier échec (partage injoignable, droits…), effacé au prochain succès. */
  erreur?: string
  /** Un enregistrement est en cours ou attend la fin du délai entre deux écritures. */
  enCours: boolean
}

/** Rend `null` quand la valeur n'est pas un état manuel lisible : la vue n'est pas une source sûre. */
export function etatManuelLisible(valeur: unknown): EtatManuelDuBoard | null {
  if (!valeur || typeof valeur !== 'object') return null
  const v = valeur as { etage?: unknown; a?: unknown }
  if (typeof v.etage !== 'string' || !(ETAGES_DU_BOARD as readonly string[]).includes(v.etage))
    return null
  if (typeof v.a !== 'number' || !Number.isFinite(v.a)) return null
  return { etage: v.etage as EtageDuBoard, a: v.a }
}
