/**
 * LA CARTE GRAPHIQUE ET LE FIL PRINCIPAL (conv-1075, conv-1401) : la page de la mascotte anime tout
 * en fluide. Sur le bureau, elle a sa fenêtre ; dans le fil, chaque image ferait recomposer TOUTE la
 * fenêtre d'Autowin 60 fois par seconde, soit 20 à 33 % de la carte. `AnimationAccueilChat` arrête
 * donc ses animations et les avance elle-même : entre deux crans, rien ne bouge.
 *
 * SEULES CELLES QU'ON VOIT AVANCENT. La page en compte 580, dont 565 dans des groupes éteints, où
 * elles existent quand même (note du Brain, conv-1227 ; sondé le 2026-10-31, éveillée). Les poser
 * toutes prend 3,8 ms à chaque cran, pour aucun pixel de plus.
 */

/** Une animation visible, et l'instant où elle s'arrête d'elle-même (`Infinity` si elle boucle). */
export type Piste = { animation: Animation; fin: number }

/**
 * Arrête les animations qui viennent de naître et rend celles qu'on voit. À rappeler après chaque
 * feuille d'humeur : elle crée des animations et allume d'autres groupes. `getAnimations` prend
 * 5 ms sur cette page : jamais à chaque cran.
 */
export function prendreLaMain(page: Pick<Document, 'getAnimations'>): Piste[] {
  const pistes: Piste[] = []
  for (const animation of page.getAnimations()) {
    if (animation.playState === 'running') animation.pause()
    const effet = animation.effect as KeyframeEffect | null
    // `getClientRects` et non `checkVisibility` : celui-ci répond vrai dans un groupe SVG éteint.
    if (!effet?.target?.getClientRects().length) continue
    pistes.push({ animation, fin: Number(effet.getComputedTiming().endTime) })
  }
  return pistes
}

/**
 * Pose chaque piste au cran donné. Celles qui bouclent suivent toutes `horlogeMs` : la page les veut
 * en phase (le visage suit la baguette), or une animation restée éteinte n'a pas avancé. Celles qui
 * ne jouent qu'une fois viennent de naître avec leur humeur : elles comptent depuis leur départ.
 */
export function avancerLesPistes(pistes: readonly Piste[], horlogeMs: number, pasMs: number): void {
  for (const { animation, fin } of pistes) {
    if (fin === Infinity) {
      animation.currentTime = horlogeMs
      continue
    }
    const temps = Number(animation.currentTime ?? 0)
    if (temps < fin) animation.currentTime = temps + pasMs
  }
}
