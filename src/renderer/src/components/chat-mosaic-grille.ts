/**
 * Colonnes de la mosaique selon le NOMBRE de fenetres ouvertes. Isole du composant : un fichier de
 * composants qui exporte aussi une fonction casse le rafraichissement a chaud (react-refresh).
 *
 * En dessous d'environ 320 px de haut un fil devient illisible — d'ou le plafond a 3 colonnes.
 */
export function colonnesPour(nombre: number): number {
  if (nombre <= 1) return 1
  if (nombre <= 4) return 2
  return 3
}
