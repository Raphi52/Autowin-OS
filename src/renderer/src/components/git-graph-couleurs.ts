/**
 * LA COULEUR D'UNE BRANCHE — « au pif », mais toujours la même.
 *
 * Demande de l'utilisateur (2026-09-15) : « j'aime que les couleurs des branches pop un peu au pif ».
 * Le piège est de lire « au pif » comme « tirée au sort » : un tirage à chaque rendu repeindrait le
 * graphe à chaque rafraîchissement, et suivre une branche des yeux d'une ligne à l'autre deviendrait
 * impossible. Ici la couleur est une FONCTION PURE du nom — imprévisible à l'œil, identique à chaque
 * affichage, identique entre deux écrans, sans état à stocker nulle part.
 *
 * Hachage FNV-1a 32 bits, et pas une somme de codes de caractères : `feat/a` et `feat/b` diffèrent
 * d'UN caractère et sont le cas le plus fréquent dans ce dépôt (branches sœurs). Une somme les
 * placerait à une teinte d'écart, donc indiscernables. FNV-1a les éloigne.
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** Hachage FNV-1a 32 bits, non signé. Sur les unités UTF-16 : suffisant, et stable. */
function hacher(texte: string): number {
  let hash = FNV_OFFSET
  for (let i = 0; i < texte.length; i += 1) {
    hash ^= texte.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/** La teinte (0-359) d'une branche. Exposée à part pour pouvoir la MESURER dans les tests. */
export function teinteDeBranche(nom: string): number {
  return hacher(nom) % 360
}

/**
 * Saturation et luminosité FIXES : sur le fond sombre de l'app, laisser le hachage décider de la
 * luminosité produit une branche sur cinq illisible. Seule la teinte varie.
 */
export function couleurDeBranche(nom: string): string {
  return `hsl(${teinteDeBranche(nom)} 72% 62%)`
}

/**
 * La couleur d'une VOIE du graphe. Une voie porte une branche quand on connaît son nom ; sinon elle
 * reste une voie numérotée, et son numéro fait la clé. Le préfixe évite qu'une voie 3 et une branche
 * nommée « 3 » partagent la même couleur par accident.
 */
export function couleurDeVoie(lane: number, brancheConnue?: string): string {
  return couleurDeBranche(
    brancheConnue && brancheConnue.length > 0 ? brancheConnue : `voie#${lane}`
  )
}
