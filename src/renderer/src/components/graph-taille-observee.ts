/** Taille observee de la zone 3D — garde d idempotence.
 *
 * Le ResizeObserver de la zone 3D ecrivait un NOUVEL objet a CHAQUE notification, meme quand la
 * taille etait identique : chaque notification re-rendait tout le graphe et reallouait le tampon
 * de dessin WebGL, ce qui renotifiait l observateur. Boucle sans fin, declenchee par l ouverture
 * de la colonne de detail. Rendre la MEME reference quand rien n a change coupe la boucle.
 */
export interface TailleGraphe {
  w: number
  h: number
}

/** Rend la taille courante TELLE QUELLE si elle na pas change — sinon la nouvelle taille. */
export function tailleSuivante(courante: TailleGraphe, w: number, h: number): TailleGraphe {
  return courante.w === w && courante.h === h ? courante : { w, h }
}
