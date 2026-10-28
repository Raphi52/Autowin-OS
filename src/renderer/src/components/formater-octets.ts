import { langueCourante } from '../langue'
import { traduireBoardEtMaintenance } from '../textes-ecrans/board-et-maintenance'

/**
 * Un poids brut ne se lit pas : 3 435 973 836 ne dit rien, « 3.2 Go » repond a la question posee.
 *
 * Module a part et non export du panneau : une fonction exportee depuis un fichier de composant
 * casse le rechargement a chaud (regle `react-refresh/only-export-components`).
 */
export function formaterOctets(octets: number): string {
  // L'unité suit la langue (« Mo » / « MB », conv-1170) ; le chiffre garde son point, comme avant.
  const unite = (
    cle: 'octets.o' | 'octets.ko' | 'octets.mo' | 'octets.go',
    n: string | number
  ): string => traduireBoardEtMaintenance(cle, langueCourante(), { n })
  if (!Number.isFinite(octets) || octets <= 0) return unite('octets.o', 0)
  if (octets >= 1024 ** 3) return unite('octets.go', (octets / 1024 ** 3).toFixed(1))
  if (octets >= 1024 ** 2) return unite('octets.mo', Math.round(octets / 1024 ** 2))
  if (octets >= 1024) return unite('octets.ko', Math.round(octets / 1024))
  return unite('octets.o', octets)
}
