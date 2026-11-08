/**
 * L'EN-TÊTE D'UN FIL QUI TRAVAILLE DANS SA COPIE. La copie est un détail de fonctionnement : le fil
 * travaille sur le projet dont elle est la copie, et c'est ce projet que l'en-tête nomme. La pastille
 * de branche, qui lisait « (detached) » (une copie n'est sur aucune branche), dit « copie du fil »
 * (`entete.copieDuFil` des textes de l'écran).
 */
export interface FilAvecCopie {
  projectPath?: string
  copieDuFil?: { chemin?: string; depot?: string; dossierAvant?: string }
}

export interface CopieAffichee {
  /** Le projet dont la copie est la copie : le dossier d'avant, sinon le dépôt. */
  projet: string
  /** Le chemin de la copie, gardé pour l'info-bulle. */
  copie: string
}

const cle = (chemin: string): string => chemin.replace(/[\\/]+$/u, '').toLowerCase()

/** La copie dans laquelle le fil travaille en ce moment, ou `null`. */
export function copieAfficheeDuFil(fil: FilAvecCopie | undefined): CopieAffichee | null {
  const chemin = fil?.projectPath?.trim()
  const copie = fil?.copieDuFil
  if (!chemin || typeof copie?.chemin !== 'string' || cle(copie.chemin) !== cle(chemin)) return null
  const projet = copie.dossierAvant?.trim() || copie.depot?.trim()
  return projet ? { projet, copie: chemin } : null
}

/** La pastille de branche parle de la copie du fil (une copie n'est sur aucune branche). */
export function brancheEstLaCopieDuFil(branche: string, copie: CopieAffichee | null): boolean {
  return copie !== null && branche === '(detached)'
}
