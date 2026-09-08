/**
 * CADENCE DES ETIQUETTES DE THEMES — le garde-fou qui manquait devant la boucle par image.
 *
 * Mesure du 2026-09-08 (`gels.jsonl`, sondes d'entree posees dans `mesurerBlocGraphe`) : quand la
 * fenetre de Memory meurt, la DERNIERE operation entree est toujours `graph:etiquettes`, et elle
 * avait deja ete rejouee 2 894 fois. La boucle `followCamera` rappelle en effet la synchro a
 * CHAQUE image, meme camera immobile : elle ecrit dans `dataset` (invalidation de style), relit
 * `offsetWidth`/`offsetHeight` etiquette par etiquette (recalcul de mise en page FORCE), puis
 * reecrit `transform`. Le cout d'un passage n'est pas borne par les etiquettes : il depend de TOUT
 * le document — d'ou la fenetre morte des qu'une fiche volumineuse est ouverte a cote.
 *
 * Le remede est ici : une SIGNATURE de pose. Tant que la camera et la surface d'affichage n'ont pas
 * bouge, il n'y a rien a replacer, donc rien a lire ni a ecrire.
 */
export interface PoseCamera {
  x: number
  y: number
  z: number
}

/** Signature stable d'une pose : camera arrondie au centieme + surface + nombre d'ancres. */
export function signatureCamera(
  camera: PoseCamera | null | undefined,
  largeur: number,
  hauteur: number,
  ancres: number
): string {
  if (!camera) return `sans-camera:${largeur}x${hauteur}:${ancres}`
  const arrondi = (valeur: number): number =>
    Number.isFinite(valeur) ? Math.round(valeur * 100) / 100 : 0
  return `${arrondi(camera.x)},${arrondi(camera.y)},${arrondi(camera.z)}:${largeur}x${hauteur}:${ancres}`
}

/** Vrai seulement si quelque chose a bouge depuis le dernier placement. */
export function doitResynchroniser(signature: string, precedente: string | null): boolean {
  return signature !== precedente
}
