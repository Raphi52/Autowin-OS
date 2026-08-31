/**
 * REGISTRE DES CONVERSATIONS EN ATTENTION — la memoire partagee entre la mosaique de chat, qui
 * SAIT quand une fenetre passe en etat « cadre dore / pastille jaune » (tour termine, pas encore
 * repris), et l'accueil, qui doit le MONTRER.
 *
 * Cet etat vivait dans le `useState` local de chaque fenetre de mosaique : personne d'autre ne
 * pouvait le lire, donc l'accueil ne pouvait rien afficher. Le sortir ici est le minimum — un
 * module pur, sans React ni IPC, testable seul, et que la mosaique alimente sans changer sa
 * propre regle d'entree/sortie d'attention.
 */

export interface ConversationEnAttente {
  id: string
  titre: string
  /** Horodatage du passage en attention, pour trier du plus recent au plus ancien si besoin. */
  depuis: number
}

const registre = new Map<string, ConversationEnAttente>()
const abonnes = new Set<(liste: ConversationEnAttente[]) => void>()
/**
 * L'instantane STABLE, refait uniquement quand le registre change.
 *
 * `useSyncExternalStore` compare les references : une liste fraiche a chaque lecture ferait boucler
 * le rendu a l'infini. C'est la raison d'etre de ce cache, pas une optimisation.
 */
let instantane: readonly ConversationEnAttente[] = Object.freeze([])

function notifier(): void {
  instantane = Object.freeze([...registre.values()].map((entree) => ({ ...entree })))
  for (const abonne of abonnes) abonne([...instantane])
}

/** La MEME reference tant que rien ne bouge — a donner tel quel a `useSyncExternalStore`. */
export function instantaneConversationsEnAttente(): readonly ConversationEnAttente[] {
  return instantane
}

/** La liste courante, dans l'ordre d'arrivee. COPIE : le registre n'est pas mutable de l'exterieur. */
export function lireConversationsEnAttente(): ConversationEnAttente[] {
  return [...registre.values()].map((entree) => ({ ...entree }))
}

/**
 * Une fenetre vient de passer en attention. Ré-appeler pour la MEME conversation rafraichit le
 * titre sans creer un doublon : la liste compte des conversations, pas des evenements.
 */
export function marquerConversationEnAttente(id: string, titre: string, depuis = Date.now()): void {
  const existant = registre.get(id)
  registre.set(id, { id, titre, depuis: existant?.depuis ?? depuis })
  notifier()
}

/** L'utilisateur est revenu dessus (clic, focus, ouverture depuis l'accueil). */
export function retirerConversationEnAttente(id: string): void {
  if (!registre.delete(id)) return
  notifier()
}

/** Remise a zero — tests et fermeture de la mosaique. */
export function viderConversationsEnAttente(): void {
  if (registre.size === 0) return
  registre.clear()
  notifier()
}

export function souscrireConversationsEnAttente(
  abonne: (liste: ConversationEnAttente[]) => void
): () => void {
  abonnes.add(abonne)
  return () => {
    abonnes.delete(abonne)
  }
}
