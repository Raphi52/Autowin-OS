/**
 * MÉMOIRE DES BLOCS « CE QUE ÇA COUVRE » REPLIÉS.
 *
 * Lues une fois, les explications prennent de la place : l'utilisateur replie celles qu'il connaît,
 * et ce choix doit survivre au changement d'écran comme au redémarrage — d'où le stockage local,
 * un booléen par bloc. Seuls les blocs repliés y figurent : déplié est l'état par défaut.
 */
export const CLE_BLOCS_REPLIES = 'autowin.ceQueCaCouvre.replies'

/**
 * Le même bloc vit dans deux écrans montés en même temps (Agent Studio et Réglages gardent leur vue
 * montée) : replier l'un prévient l'autre par cet événement de fenêtre. L'événement `storage` du
 * navigateur ne part que vers les AUTRES fenêtres, il ne suffit donc pas.
 */
export const EVENEMENT_BLOCS_REPLIES = 'autowin:ceQueCaCouvre'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

/** Les blocs repliés, par identifiant. Un stockage illisible ou absent = tout déplié. */
export function lireBlocsReplies(storage: Stockage | undefined): Record<string, true> {
  if (!storage) return {}
  try {
    const lu: unknown = JSON.parse(storage.getItem(CLE_BLOCS_REPLIES) ?? '{}')
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return {}
    const propres: Record<string, true> = {}
    for (const [id, replie] of Object.entries(lu)) if (replie === true) propres[id] = true
    return propres
  } catch {
    return {}
  }
}

/** Retient l'état d'un bloc ; un bloc déplié est RETIRÉ, pour que la clé ne grossisse pas. */
export function noterBlocReplie(storage: Stockage | undefined, id: string, replie: boolean): void {
  if (!storage || !id) return
  const courant = lireBlocsReplies(storage)
  if (replie) courant[id] = true
  else delete courant[id]
  try {
    storage.setItem(CLE_BLOCS_REPLIES, JSON.stringify(courant))
  } catch {
    // Stockage plein ou interdit : le bloc se replie quand même à l'écran, il ne sera simplement
    // pas retenu au prochain démarrage — rien d'autre ne dépend de cette mémoire.
  }
}

/** `localStorage` peut lever (contexte sans stockage) : un bloc ne doit jamais casser l'écran pour ça. */
export function stockageLocal(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
