/**
 * UN WORKER QUI TRAVAILLE N'EST PAS UN WORKER MORT.
 *
 * Mesure du 2026-09-08 (conv-353) : la vue Memory n'affichait plus AUCUN noeud et repetait
 * « Impossible de charger le graphe de connaissances ». Cause reelle : le Brain vit sur un partage
 * RESEAU (\ged2\...), et sa premiere lecture depasse le delai fixe de 30 s — mesure : 17 220 ms
 * rien que pour les themes, puis 40 ms au rappel suivant grace au cache du worker.
 *
 * Le defaut n'est donc pas la lenteur : c'est que le delai TUE le worker au lieu de l'attendre. Le
 * travail deja fait est perdu, le cache avec, et l'essai suivant repart de zero — donc il echoue
 * pareil. Un echec garanti, indefiniment.
 *
 * On remplace le delai « duree totale du traitement » par un delai « SILENCE » : tant que le worker
 * donne signe de vie, on l'attend. Il n'est declare mort que s'il cesse de repondre.
 */

export interface EtatAttente {
  /** Instant du dernier signe de vie recu du worker. */
  dernierSigneDeVie: number
  /** Instant courant. */
  maintenant: number
}

/** Silence toléré avant de déclarer le worker mort. */
export const SILENCE_WORKER_AVANT_ABANDON_MS = 30_000

/**
 * Faut-il abandonner cet appel ? Uniquement si le worker est MUET depuis trop longtemps — la duree
 * du traitement, elle, n'est plus un motif.
 */
export function workerAbandonne(
  etat: EtatAttente,
  silenceToleredMs: number = SILENCE_WORKER_AVANT_ABANDON_MS
): boolean {
  return etat.maintenant - etat.dernierSigneDeVie >= silenceToleredMs
}
