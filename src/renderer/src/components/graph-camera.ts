/**
 * Mémoriser la vue avant de s'approcher d'un nœud, et la rendre en refermant.
 *
 * Le graphe rapproche la caméra du nœud consulté. Sans mémoire de la vue précédente, refermer la
 * fiche laisse la caméra braquée sur ce nœud : il paraît « figé au centre de l'écran », seul, tout le
 * reste hors champ. Ce n'est pas le nœud qui est bloqué, c'est le point de vue.
 *
 * Logique isolée du composant à dessein : une caméra three.js ne se vérifie pas dans un test de rendu,
 * alors que la règle — capturer une fois, restaurer une fois — se prouve en millisecondes.
 */

export interface Coords {
  x: number
  y: number
  z: number
}

/** Le strict nécessaire du graphe 3D : de quoi lire et poser un point de vue. */
export interface CameraHandle {
  cameraPosition: ((position: Coords, lookAt?: Coords, ms?: number) => unknown) & (() => Coords)
  controls: () => { target?: { x: number; y: number; z: number } } | undefined
}

export interface CameraView {
  position: Coords
  /** Ce que la caméra regardait : sans lui, on rendrait la position mais pas l'orientation. */
  target: Coords
}

const RESTORE_MS = 700

/**
 * La vue courante, ou `undefined` si le graphe n'est pas prêt. Ne jette jamais : une caméra
 * illisible ne doit pas empêcher d'ouvrir une fiche.
 */
export function readCameraView(handle: CameraHandle | null | undefined): CameraView | undefined {
  if (!handle) return undefined
  try {
    const position = handle.cameraPosition()
    if (!position || [position.x, position.y, position.z].some((v) => typeof v !== 'number')) {
      return undefined
    }
    const cible = handle.controls()?.target
    return {
      position: { x: position.x, y: position.y, z: position.z },
      target:
        cible && typeof cible.x === 'number'
          ? { x: cible.x, y: cible.y, z: cible.z }
          : { x: 0, y: 0, z: 0 }
    }
  } catch {
    return undefined
  }
}

/**
 * Mémorise la vue AVANT le premier rapprochement, et une seule fois.
 *
 * Le « une seule fois » est le cœur de la règle : en enchaînant deux nœuds sans refermer, écraser la
 * mémoire rendrait la vue du nœud intermédiaire — c'est-à-dire un autre gros plan — au lieu de celle
 * d'où l'utilisateur est parti.
 */
export function rememberViewBeforeFocus(
  memoire: CameraView | undefined,
  handle: CameraHandle | null | undefined
): CameraView | undefined {
  if (memoire) return memoire
  return readCameraView(handle)
}

/**
 * Rend la vue mémorisée. Retourne la nouvelle mémoire (vide), pour que l'appelant ne puisse pas
 * oublier de la libérer et rejouer une vue périmée au clic suivant.
 */
export function restoreView(
  memoire: CameraView | undefined,
  handle: CameraHandle | null | undefined,
  ms = RESTORE_MS
): CameraView | undefined {
  if (!memoire || !handle) return undefined
  try {
    handle.cameraPosition(memoire.position, memoire.target, ms)
  } catch {
    /* la vue ne se rend pas : mieux vaut un cadrage figé qu'une fiche qui refuse de se fermer */
  }
  return undefined
}
