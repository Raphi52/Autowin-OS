/**
 * Un canevas 2D pour dessiner une texture du décor — dans la page COMME dans un Worker.
 *
 * Depuis le 2026-10-18 (conv-323), le fond avenue se dessine dans un Worker (decor-avenue.worker.ts) :
 * il n'y a là ni `document` ni `HTMLCanvasElement`, mais un `OffscreenCanvas`, qui a la même surface
 * de dessin 2D (getContext('2d'), width, height) et que three accepte comme image de CanvasTexture.
 * Le type rendu reste `HTMLCanvasElement` pour ne pas réécrire chaque appelant : seules ces trois
 * propriétés et `getContext('2d')` sont utilisées par le décor.
 */
export function nouvelleToile(largeur = 1, hauteur = 1): HTMLCanvasElement {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = largeur
    c.height = hauteur
    return c
  }
  return new OffscreenCanvas(largeur, hauteur) as unknown as HTMLCanvasElement
}
