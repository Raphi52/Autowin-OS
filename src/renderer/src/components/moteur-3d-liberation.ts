/** Ce qu'il faut d'un `THREE.WebGLRenderer` pour le libérer : un faux suffit en test. */
export interface MoteurLiberable {
  dispose(): void
  forceContextLoss(): void
}

/**
 * Rend au processus GPU toute la mémoire d'un moteur 3D qu'on ferme.
 *
 * `dispose()` de three.js vide ses caches (programmes, listes de rendu) mais garde le contexte
 * WebGL, donc son tampon d'image : celui du décor d'accueil est plein écran et anticrénelé.
 * Chrome ne le rend qu'au passage du ramasse-miettes sur le canevas, quand il passe. La perte
 * forcée le rend tout de suite, et avec lui les géométries et textures que la scène n'aurait pas
 * libérées une à une.
 *
 * L'ordre compte : `dispose()` retire d'abord l'écoute de l'événement de perte de three.js, sinon
 * il journaliserait « Context Lost » pour une perte voulue.
 */
export function libererMoteur3d(moteur: MoteurLiberable | undefined): void {
  if (!moteur) return
  moteur.dispose()
  moteur.forceContextLoss()
}
