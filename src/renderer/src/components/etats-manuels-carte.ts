/**
 * ÉTATS POSÉS À LA MAIN SUR LA RIVIÈRE DE LA CARTE DU PROJET (/draft conv-1113, 2026-10-23).
 *
 * Glisser un post-it vers un autre étage change son état : c'est ce qui fait de la rivière un kanban
 * (« ça doit aussi servir de kanban »). L'état prouvé, lui, vient des fils et ne se réécrit pas :
 * l'état manuel est rangé À CÔTÉ, sur ce poste (même stockage que `arrets-chaine-persistes.ts`), et
 * ne compte jamais comme une preuve. Clé = id de la conversation.
 */
import type { EtageDeLaRiviere, EtatManuel } from './carte-riviere'
import { ETAGES } from './carte-riviere'

export const CLE_ETATS_MANUELS_CARTE = 'autowin.carte.etatsManuels'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

const ETAGES_CONNUS = new Set<string>(ETAGES.map((e) => e.cle))

export function lireEtatsManuels(storage: Stockage): Record<string, EtatManuel> {
  try {
    const lu: unknown = JSON.parse(storage.getItem(CLE_ETATS_MANUELS_CARTE) ?? '{}')
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return {}
    const propres: Record<string, EtatManuel> = {}
    for (const [id, valeur] of Object.entries(lu)) {
      const v = valeur as Partial<EtatManuel> | null
      if (v && typeof v.etage === 'string' && ETAGES_CONNUS.has(v.etage) && typeof v.a === 'number')
        propres[id] = { etage: v.etage as EtageDeLaRiviere, a: v.a }
    }
    return propres
  } catch {
    return {}
  }
}

/**
 * Pose l'état `etage` sur le fil, ou l'efface quand `etage` est `null` ; rend la table à jour.
 * L'heure de pose est prise ICI, au geste : c'est elle qui rend l'état caduc à la demande suivante.
 */
export function poserEtatManuel(
  storage: Stockage,
  conversationId: string,
  etage: EtageDeLaRiviere | null,
  a: number = Date.now()
): Record<string, EtatManuel> {
  const courant = lireEtatsManuels(storage)
  if (etage === null) delete courant[conversationId]
  else courant[conversationId] = { etage, a }
  storage.setItem(CLE_ETATS_MANUELS_CARTE, JSON.stringify(courant))
  return courant
}
