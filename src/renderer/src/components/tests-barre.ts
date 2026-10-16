/**
 * LA BARRE REUSSIS / ECHECS DE LA VUE TESTS (conv-981, 2026-10-16) : les totaux n'etaient que trois
 * textes (« N passés · N échecs · N ignorés »). La barre montre la part de chacun d'un coup d'oeil ;
 * le reste du rail, ce sont les ignores. Calcul separe du composant (rechargement a chaud).
 *
 * Les totaux viennent aussi du STOCKAGE LOCAL (le dernier run memorise), donc d'un JSON qui a pu
 * etre abime : une valeur absente, negative, non numerique ou infinie compte pour zero, et des
 * reussis + echecs au-dela du total se partagent la barre entiere — jamais une largeur NaN, jamais
 * deux segments qui deborderaient du rail a eux deux.
 */
export type TotauxDeLaBarre = { passed?: unknown; failed?: unknown; total?: unknown }

const compte = (valeur: unknown): number =>
  typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? valeur : 0

/** Tronque au centieme : un arrondi au plus proche pourrait porter la somme a 100,01 %. */
const auCentieme = (pourcent: number): number => Math.floor(pourcent * 100) / 100

/** Largeur des deux segments, en pourcentage du rail (0 a 100, somme <= 100). Pure. */
export function largeursDeLaBarre(totaux: TotauxDeLaBarre | null | undefined): {
  reussis: number
  echecs: number
} {
  const reussis = compte(totaux?.passed)
  const echecs = compte(totaux?.failed)
  const base = Math.max(compte(totaux?.total), reussis + echecs)
  if (!Number.isFinite(base) || base === 0) return { reussis: 0, echecs: 0 }
  return { reussis: auCentieme((reussis / base) * 100), echecs: auCentieme((echecs / base) * 100) }
}
