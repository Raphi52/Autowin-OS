/**
 * LE ZOOM AU CLIC SUR LA FALAISE (conv-1424, « le zoom quand je clique sur un élément doit aller
 * beaucoup plus proche »). Avant, `760 / max(w, h × 1,75)` plafonné à 3 : tous les objets finissaient
 * vers ×2,3, et l'élément cliqué n'occupait qu'un quart à un tiers de l'écran quand la vue s'ouvrait.
 * Ici l'élément remplit presque la vue, dans sa dimension la plus contrainte.
 */

/** La part de la vue que l'élément cliqué occupe à la fin du zoom. */
export const REMPLISSAGE = 0.9
/** Au-delà, la peinture (deux fois la scène) serait agrandie plus de trois fois : elle deviendrait floue. */
export const ZOOM_MAX = 6
/** La vitesse du zoom : à 640 ms, quand la vue s'ouvre, il a fait 93 % du chemin. */
const VITESSE = 4.2

/** Le zoom qui fait remplir la vue (`vueL` × `vueH`, en pixels de scène) par `rect`. */
export function zoomSur(rect: { w: number; h: number }, vueL: number, vueH: number): number {
  const z = REMPLISSAGE * Math.min(vueL / Math.max(1, rect.w), vueH / Math.max(1, rect.h))
  return Math.max(1, Math.min(ZOOM_MAX, z))
}

/**
 * Un pas du zoom vers `z`. Le chemin se fait en proportion (logarithme), pas en différence : de ×1 à ×6
 * en différence, la première image ferait déjà un bond de ×1,4, le reste se traînerait.
 */
export function rapprocherZoom(zv: number, z: number, dt: number): number {
  return Math.exp(Math.log(zv) + (Math.log(z) - Math.log(zv)) * Math.min(1, dt * VITESSE))
}

/**
 * La peinture prolongée au-delà de ses bords gauche et droit (`bords.avif`), en pixels de scène. Sans elle,
 * la roue de Settings et la clé du hangar, collées au bord, restaient sur le côté de l'écran au zoom.
 */
export const MARGE_BORD = 160

/** Les pixels d'image qui séparent les deux bords dans `bords.avif` : le lissage n'y prend pas un filet de l'autre. */
export const TAMPON_BORDS = 16

/**
 * Où lire chaque bord dans `bords.avif`, en pixels de l'IMAGE, d'après sa propre taille. Son échelle ne se
 * déduit pas de la peinture : le 04/11, la peinture est repassée de ×4 à ×2 (16104dda8) et les bords sont
 * restés en ×4 ; lus à l'échelle de la peinture, ils ne donnaient que le quart haut gauche du bord gauche, le
 * ciel, étiré sur toute la hauteur : la bande bleue à gauche au zoom sur le robot (conv-1644).
 */
export function sourcesDesBords(
  largeur: number,
  hauteur: number
): { gauche: { x: number; l: number; h: number }; droite: { x: number; l: number; h: number } } {
  const l = (largeur - TAMPON_BORDS) / 2
  return { gauche: { x: 0, l, h: hauteur }, droite: { x: l + TAMPON_BORDS, l, h: hauteur } }
}

/**
 * Le début de la vue sur un axe : centrée sur `centre`, bornée à la peinture [`debut`, `fin`], avec `marge`
 * de débord permis de chaque côté. La marge suit le zoom (0 au repos) : quand le zoom se défait, la vue
 * rentre dans la peinture sans saut.
 */
export function bornerVue(
  centre: number,
  vue: number,
  debut: number,
  fin: number,
  marge: number
): number {
  return Math.max(debut - marge, Math.min(fin + marge - vue, centre - vue / 2))
}
