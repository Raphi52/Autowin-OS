import type { LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'

/*
 * QUEL LOT PART APRÈS LEQUEL (2026-10-31 : « enlève le côté timeline, prends toute la
 * longueur, mais écris la durée et quelle étape se lance après laquelle »).
 *
 * La frise disait l'enchaînement par la position des blocs sur l'axe des heures. Sans axe, il doit
 * s'écrire. Deux sources, dans cet ordre :
 *  - la dépendance déclarée par le plan (`apres`) : le lot attendait ces lots-là ;
 *  - sinon, le lot qui a fini juste avant son départ : un lot sans dépendance part quand une place
 *    se libère (`parallele`), donc à la fin d'un autre. C'est un constat d'heures, pas une cause
 *    inventée : « à la fin du 4 » est vrai même si la place libérée n'était pas celle du 4.
 */

/** Écart toléré entre la fin d'un lot et le départ du suivant : le coordinateur relance en secondes. */
export const ECART_RELAIS_MS = 2 * 60_000

export type Enchainement =
  /** Le plan le fait attendre ces lots (« après 2–6 »). */
  | { genre: 'apres'; rangs: number[] }
  /** Sans dépendance, parti dès qu'un autre lot a fini. */
  | { genre: 'relais'; rang: number }
  /** Sans dépendance, parti sans attendre la fin d'un autre lot. */
  | { genre: 'libre' }
  /** Sans dépendance, pas encore parti : il attend une place. */
  | { genre: 'file' }

export function enchainementDuLot(plan: PlanDeLots, lot: LotDuPlan): Enchainement {
  if (lot.apres?.length) return { genre: 'apres', rangs: [...lot.apres].sort((a, b) => a - b) }
  const debut = lot.debut
  if (debut === undefined) return { genre: 'file' }
  let relais: LotDuPlan | undefined
  for (const autre of plan.lots) {
    if (autre.rang === lot.rang || autre.fin === undefined) continue
    const ecart = debut - autre.fin
    // Une fin notée quelques secondes APRÈS le départ reste un relais : les deux heures sont écrites
    // par deux signaux distincts du coordinateur.
    if (ecart < -5_000 || ecart > ECART_RELAIS_MS) continue
    if (!relais || autre.fin > (relais.fin ?? 0)) relais = autre
  }
  return relais ? { genre: 'relais', rang: relais.rang } : { genre: 'libre' }
}

/** « 2–6 » plutôt que « 2, 3, 4, 5, 6 » : la colonne garde la largeur d'un mot. */
export function rangsLisibles(rangs: readonly number[]): string {
  const tries = [...new Set(rangs)].sort((a, b) => a - b)
  const morceaux: string[] = []
  for (let i = 0; i < tries.length;) {
    let j = i
    while (j + 1 < tries.length && tries[j + 1] === tries[j] + 1) j++
    // Deux rangs qui se suivent restent « 2, 3 » : « 2–3 » ne raccourcit rien.
    if (j - i >= 2) morceaux.push(`${tries[i]}–${tries[j]}`)
    else for (let k = i; k <= j; k++) morceaux.push(String(tries[k]))
    i = j + 1
  }
  return morceaux.join(', ')
}
