/**
 * LES INDICATEURS ANIMÉS AVANCENT PAR CRANS, TOUS SUR LA MÊME HORLOGE (conv-1075, 2026-10-22).
 *
 * Plainte : « ma carte graphique fait un bruit de fou ». Mesuré sur le poste de l'utilisateur
 * (GeForce GT 1030, fenêtre 1920×1032, par le port de débogage) : dès qu'UNE animation visible tourne
 * en continu, Chromium recompose la fenêtre ENTIÈRE 60 fois par seconde. Un témoin de 16 px qui
 * tourne coûtait 20 % de la carte, isolé ou non (`contain: strict` + `will-change` : 20 % aussi) ;
 * le point qui bat de la carte du fil, seul, 31 % ; les atomes de la liste des fils, seuls, 25 %.
 * Le coût suit le NOMBRE D'IMAGES par seconde, pas la taille de ce qui bouge.
 *
 * LE REMÈDE : ces animations avancent par crans de `CRAN_MS` (`steps()` dans leur CSS). Entre deux
 * crans rien ne change, et Chromium ne produit aucune image. Mesuré avec le même témoin : rotation
 * par crans 6 %, halo par crans 9 % (contre 20 et 33 % en fluide ; 3 % sans rien).
 *
 * POURQUOI CE MODULE : une animation CSS démarre quand son élément apparaît. Huit atomes montés à
 * huit moments différents auraient huit grilles de crans décalées, et leur réunion ramènerait la
 * fenêtre à 60 images/s. Chaque animation listée est donc recalée, à son démarrage, sur l'origine
 * de l'horloge du document (`startTime = 0`) : tous les crans tombent sur les mêmes images. Il faut
 * pour cela que leurs durées et leurs décalages soient des multiples de `CRAN_MS` — tenu par
 * animations-par-crans.test.ts.
 */

/** La durée d'un cran, en ms (10 images/s au plus pour tous les indicateurs réunis). */
export const CRAN_MS = 100

/** Les animations CSS qui avancent par crans et qu'on cale sur l'horloge commune. */
export const ANIMATIONS_PAR_CRANS: ReadonlySet<string> = new Set([
  'aw-atom-spin', // orbites de l'atome <Spinner/> (theme.css)
  'aw-atom-tw', // étoile de l'atome (theme.css)
  'carte-bat' // point « en cours » de la carte du fil (CarteDuFil.css)
])

/** Ce qu'on lit et écrit d'une animation : son nom CSS et son départ sur l'horloge du document. */
export type AnimationCalable = { animationName?: string; startTime: CSSNumberish | null }

/**
 * Recale sur l'origine de l'horloge du document les animations `nom` de la liste, si `nom` fait
 * partie des animations par crans. Rend le nombre d'animations recalées.
 */
export function calerSurLHorloge(animations: readonly AnimationCalable[], nom: string): number {
  if (!ANIMATIONS_PAR_CRANS.has(nom)) return 0
  let recalees = 0
  for (const animation of animations) {
    if (animation.animationName !== nom || animation.startTime === 0) continue
    animation.startTime = 0
    recalees++
  }
  return recalees
}

/**
 * Écoute le démarrage de toute animation CSS du document et cale celles qui avancent par crans.
 * Installé une fois, avant le premier rendu (main.tsx). Rend de quoi se désinstaller (tests).
 */
export function installerAnimationsParCrans(cible: Document = document): () => void {
  const auDemarrage = (evenement: Event): void => {
    const nom = (evenement as AnimationEvent).animationName
    if (!ANIMATIONS_PAR_CRANS.has(nom)) return
    const element = evenement.target as Element | null
    if (!element || typeof element.getAnimations !== 'function') return
    calerSurLHorloge(element.getAnimations() as unknown as AnimationCalable[], nom)
  }
  // En capture : un `stopPropagation` posé plus bas ne doit pas laisser un indicateur hors grille.
  cible.addEventListener('animationstart', auDemarrage, true)
  return () => cible.removeEventListener('animationstart', auDemarrage, true)
}
