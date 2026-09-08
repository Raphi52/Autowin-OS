/**
 * REDIMENSIONNEMENT DU DECOR — ne payer que les VRAIS changements de taille.
 *
 * `scene.resize()` reconstruit la chaine de post-traitement : `renderer.setSize`, `composer.setSize`
 * (plusieurs cibles de rendu plein ecran realloueees) et le replacement de toutes les etoiles dans
 * leur tableau. C'est lourd, et c'etait rejoue a CHAQUE notification de l'observateur de taille,
 * meme quand la taille etait rigoureusement identique.
 *
 * Or le decor est derriere TOUTES les vues : la moindre secousse de mise en page (un message qui
 * arrive, un panneau qui s'ouvre) notifie l'observateur. Mesure du 2026-09-08 : deux gels de
 * fenetre de 5,6 s et 6,3 s, sans aucune tache longue JavaScript associee — signature d'un travail
 * graphique, pas d'une boucle de code.
 */
export interface TailleDecor {
  w: number
  h: number
}

/** Vrai seulement si la taille est utilisable ET differente de la derniere appliquee. */
export function doitRedimensionner(derniere: TailleDecor | null, w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false
  return derniere === null || derniere.w !== w || derniere.h !== h
}
