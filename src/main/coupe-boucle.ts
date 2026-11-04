/**
 * COUPE-CIRCUIT DE BOUCLE (conv-364) — la règle « ne relance pas à l'identique en aveugle »
 * n'était que de la prose dans le prompt. Ici elle est tenue par le code : on observe chaque
 * résultat d'outil d'un tour et on rend un motif d'arrêt quand l'agent tourne en rond.
 *  - le MÊME appel (outil + arguments) rend le MÊME résultat `MEME_APPEL_MAX` fois ;
 *  - `ECHECS_D_AFFILEE_MAX` outils échouent d'affilée, sans un seul succès entre eux.
 */
export const MEME_APPEL_MAX = 4
export const ECHECS_D_AFFILEE_MAX = 8

export function creerCoupeBoucle(
  limites = { memeAppel: MEME_APPEL_MAX, echecs: ECHECS_D_AFFILEE_MAX }
): { observer(outil: string, entree: unknown, echec: boolean, sortie: string): string | undefined } {
  const vus = new Map<string, number>()
  let echecs = 0
  return {
    /** Rend le motif d'arrêt, ou `undefined` si le tour peut continuer. */
    observer(outil: string, entree: unknown, echec: boolean, sortie: string): string | undefined {
      echecs = echec ? echecs + 1 : 0
      const cle = `${outil}\u0000${JSON.stringify(entree ?? null)}\u0000${sortie}`
      const n = (vus.get(cle) ?? 0) + 1
      vus.set(cle, n)
      if (n >= limites.memeAppel)
        return `boucle détectée : ${outil} appelé ${n} fois avec les mêmes arguments et le même résultat — tour arrêté`
      if (echecs >= limites.echecs)
        return `boucle détectée : ${echecs} outils en échec d'affilée — tour arrêté`
      return undefined
    }
  }
}
