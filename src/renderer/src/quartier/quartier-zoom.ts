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
