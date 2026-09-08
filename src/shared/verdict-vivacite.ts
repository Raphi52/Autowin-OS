/**
 * VIVANTE OU GELEE — la distinction que mon banc de mesure ratait.
 *
 * Mesure du 2026-09-08 (conv-353) : le banc concluait « fenetre muette » des que son compteur
 * d'images ne rendait pas la main. Or `requestAnimationFrame` est SUSPENDU par le navigateur quand
 * la page est cachee (fenetre au second plan, vue non affichee). Verifie sur l'application reelle :
 * `document.visibilityState === 'hidden'`, aucune image rendue... et `Date.now()` repondait
 * instantanement. La fenetre etait donc PARFAITEMENT VIVANTE, et deux verdicts de gel etaient faux.
 *
 * D'ou deux temoins distincts, jamais confondus :
 *   - la VIE : une evaluation triviale repond — c'est le seul critere de gel ;
 *   - la FLUIDITE : des images sont rendues — mesurable uniquement si la page est visible.
 */
export interface TemoinsFenetre {
  /** L'evaluation triviale a-t-elle repondu dans le delai ? */
  repond: boolean
  /** Etat de visibilite rapporte par la page, si connu. */
  visibilite?: 'visible' | 'hidden'
  /** Images comptees, ou undefined si le compteur n'a pas rendu la main. */
  images?: number
}

export type VerdictVivacite =
  | { etat: 'gelee' }
  | { etat: 'vivante'; fluide: boolean; images: number }
  | { etat: 'vivante-non-mesurable'; motif: 'page-cachee' }

/** Nombre d'images en dessous duquel une page VISIBLE est jugee poussive plutot que fluide. */
export const SEUIL_IMAGES_FLUIDE = 30

export function verdictVivacite(temoins: TemoinsFenetre): VerdictVivacite {
  // Seule l'absence de reponse a une evaluation triviale prouve un gel.
  if (!temoins.repond) return { etat: 'gelee' }
  // Page cachee : le compteur d'images ne peut rien dire, et l'absence d'images n'est pas un gel.
  if (temoins.visibilite === 'hidden') return { etat: 'vivante-non-mesurable', motif: 'page-cachee' }
  if (temoins.images === undefined) return { etat: 'vivante-non-mesurable', motif: 'page-cachee' }
  return { etat: 'vivante', fluide: temoins.images >= SEUIL_IMAGES_FLUIDE, images: temoins.images }
}
