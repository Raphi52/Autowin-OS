/**
 * LA CARTE GRAPHIQUE (conv-1075, conv-1401) : la page de la mascotte anime tout en fluide. Sur le
 * bureau, elle a sa fenêtre ; dans le fil, chaque image ferait recomposer TOUTE la fenêtre d'Autowin
 * 60 fois par seconde, soit 20 à 33 % de la carte. `AnimationAccueilChat` arrête donc ses animations
 * et les avance elle-même : entre deux crans, rien ne bouge, et Chromium ne produit aucune image.
 *
 * `pause` sur celles qui viennent de naître : un changement d'humeur en crée de nouvelles. Rend le
 * nombre d'animations avancées.
 */
export function avancerLesAnimations(page: Pick<Document, 'getAnimations'>, pasMs: number): number {
  const animations = page.getAnimations()
  for (const animation of animations) {
    if (animation.playState === 'running') animation.pause()
    animation.currentTime = Number(animation.currentTime ?? 0) + pasMs
  }
  return animations.length
}
