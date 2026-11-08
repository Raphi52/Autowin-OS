/**
 * L'EN-TÊTE D'UN FIL QUI TRAVAILLE DANS SA COPIE. La copie est un détail de fonctionnement : le fil
 * travaille sur le projet dont elle est la copie, et c'est ce projet que l'en-tête nomme. La copie
 * n'est sur aucune branche (« (detached) ») : son travail entre, à la fin de chaque tour, dans la
 * branche ACTIVE du dépôt partagé, qui n'est pas forcément main (la branche d'un work item, par
 * exemple). La pastille de branche lit donc la branche de ce dépôt, suivie de « copie du fil ».
 */
export interface FilAvecCopie {
  projectPath?: string
  copieDuFil?: { chemin?: string; depot?: string; dossierAvant?: string }
}

export interface CopieAffichee {
  /** Le projet dont la copie est la copie : le dossier d'avant, sinon le dépôt. */
  projet: string
  /** Le dépôt où le travail de la copie entre : c'est sa branche que l'en-tête montre. */
  depot: string
  /** Le chemin de la copie, gardé pour l'info-bulle. */
  copie: string
}

const cle = (chemin: string): string => chemin.replace(/[\\/]+$/u, '').toLowerCase()

/** La copie dans laquelle le fil travaille en ce moment, ou `null`. */
export function copieAfficheeDuFil(fil: FilAvecCopie | undefined): CopieAffichee | null {
  const chemin = fil?.projectPath?.trim()
  const copie = fil?.copieDuFil
  if (!chemin || typeof copie?.chemin !== 'string' || cle(copie.chemin) !== cle(chemin)) return null
  const depot = copie.depot?.trim()
  const projet = copie.dossierAvant?.trim() || depot
  return projet ? { projet, depot: depot || projet, copie: chemin } : null
}

/** Le dossier dont l'en-tête lit la branche : le dépôt partagé pour un fil dans sa copie. */
export function dossierDeLaBranche(
  dossierDuFil: string | undefined,
  copie: CopieAffichee | null
): string | undefined {
  return copie ? copie.depot : dossierDuFil
}
