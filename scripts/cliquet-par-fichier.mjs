/**
 * LE CLIQUET PAR FICHIER, partagé par les garde-fous qui tiennent une dette sans exiger de la vider
 * d'un coup (`couleurs-en-dur.mjs`, `appels-bloquants.mjs`) : chaque fichier a un plafond, qui peut
 * baisser et jamais monter, et un fichier absent du plancher a pour plafond zéro.
 *
 * Une mesure ou un plancher est un objet `{ chemin: compte }`.
 */

/** Fichiers au-dessus de leur plafond ; un fichier absent du plancher a pour plafond zéro. */
export function depassements(mesure, plancher) {
  return Object.entries(mesure)
    .map(([chemin, compte]) => ({ chemin, compte, plafond: plancher[chemin] ?? 0 }))
    .filter(({ compte, plafond }) => compte > plafond)
}

/**
 * Pour chaque fichier, le plus haut de deux mesures.
 *
 * Un plafond ne descend jamais sous ce que la version COMMITÉE porte encore. L'arbre est partagé : le
 * nettoyage non commité d'un autre fil y fait baisser le compte, et une copie propre tirée de cette
 * version partirait rouge sur un fichier qu'elle n'a pas touché. Vécu à la première mesure des
 * couleurs : `SuperConvMosaique.css`, 9 couleurs commitées pour un plafond de 3.
 */
export function plusHaut(a, b) {
  const haut = { ...a }
  for (const [chemin, compte] of Object.entries(b))
    haut[chemin] = Math.max(haut[chemin] ?? 0, compte)
  return haut
}

/** Le plancher après baisse : aucun plafond ne monte, les fichiers disparus s'en vont. */
export function plancherBaisse(mesure, plancher, existe) {
  const suivant = {}
  for (const [chemin, plafond] of Object.entries(plancher)) {
    if (!existe(chemin)) continue
    const compte = Math.min(mesure[chemin] ?? 0, plafond)
    if (compte > 0) suivant[chemin] = compte
  }
  return suivant
}

/** Total d'un plancher ou d'une mesure, pour la ligne « Plancher : 35 → 33 ». */
export function total(compteParFichier) {
  return Object.values(compteParFichier).reduce((somme, n) => somme + n, 0)
}
