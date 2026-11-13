/**
 * COUPE-CIRCUIT DE BOUCLE — la règle « ne relance pas à l'identique en aveugle »
 * n'était que de la prose dans le prompt. Ici elle est tenue par le code : on observe chaque
 * résultat d'outil d'un tour et on rend un motif d'arrêt quand l'agent tourne en rond.
 *  - le MÊME appel (outil + arguments) rend le MÊME résultat `MEME_APPEL_MAX` fois ;
 *  - `ECHECS_D_AFFILEE_MAX` outils échouent d'affilée, sans un seul succès entre eux.
 */
import { createHash } from 'node:crypto'

export const MEME_APPEL_MAX = 4
export const ECHECS_D_AFFILEE_MAX = 8

/**
 * CE QUE LE COUPE-CIRCUIT COMPARE (2026-11-13). Le texte d'un résultat d'outil, plus une empreinte
 * courte de chaque image. Le texte seul (`claudeToolResultText`) est vide pour un Read d'image : une
 * photo refaite au même chemin après chaque correction passait pour « le même résultat », et la 4e
 * relecture coupait le tour — mesuré sur le lot 2 du plan-9817a640, 73 minutes de travail perdues.
 */
export function sortieComparable(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu
  if (!Array.isArray(contenu)) return ''
  return contenu
    .map((bloc) => {
      if (!bloc || typeof bloc !== 'object') return ''
      const b = bloc as { type?: unknown; text?: unknown; source?: { data?: unknown } }
      if (typeof b.text === 'string') return b.text
      if (b.type === 'image' && typeof b.source?.data === 'string')
        return `[image ${createHash('sha1').update(b.source.data).digest('hex').slice(0, 16)}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function creerCoupeBoucle(
  limites = { memeAppel: MEME_APPEL_MAX, echecs: ECHECS_D_AFFILEE_MAX }
): {
  observer(outil: string, entree: unknown, echec: boolean, sortie: string): string | undefined
} {
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
