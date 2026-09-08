/**
 * POIGNEE DE PILOTAGE DU GRAPHE — la capacite qui manquait pour reproduire un defaut 3D.
 *
 * Constat du 2026-09-08 : reproduire « je clique un noeud du Brain » depuis l'exterieur obligeait a
 * BALAYER le canvas point par point en guettant le curseur « main » — 4 165 points sans rien
 * toucher quand la vue est etroite, et aucun moyen de viser un noeud PRECIS. Le composant 3D ne
 * publie ni la liste des noeuds ni leur position a l'ecran.
 *
 * On expose donc une poignee nommee, UNIQUEMENT en developpement : lister les noeuds, obtenir la
 * position ecran de l'un d'eux, et l'ouvrir par le meme chemin que le clic. Elle ne change aucun
 * comportement de l'application — elle rend seulement observable ce qui l'etait deja de l'interieur.
 */
export interface SondeGraphe {
  /** Les noeuds actuellement rendus, dans l'ordre du rendu. */
  noeuds(): Array<{ id: string; label?: string }>
  /** Position ECRAN d'un noeud, ou null s'il n'est pas rendu / hors champ. */
  positionEcran(id: string): { x: number; y: number } | null
  /** Ouvre la fiche par le MEME chemin que le clic 3D. Faux si le noeud est inconnu. */
  ouvrir(id: string): boolean
}

/** Nom de la poignee posee sur l'objet global. Un seul endroit le connait. */
export const CLE_SONDE_GRAPHE = '__autowinSondeGraphe'

/**
 * Pose la poignee et rend la fonction qui la retire.
 *
 * `actif` est le garde : en production la poignee n'existe pas, donc rien a exploiter depuis une
 * page. L'appelant passe `import.meta.env.DEV`.
 */
export function exposerSondeGraphe(
  sonde: SondeGraphe,
  cible: Record<string, unknown>,
  actif: boolean
): () => void {
  if (!actif) return () => {}
  cible[CLE_SONDE_GRAPHE] = sonde
  return () => {
    delete cible[CLE_SONDE_GRAPHE]
  }
}
