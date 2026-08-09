/**
 * Réordonnancement de la FILE d'attente du chat.
 *
 * La file était lisible et supprimable, mais son ORDRE était figé à l'ordre de frappe : un message
 * urgent tapé en dernier partait en dernier, et le seul recours était de tout retirer puis retaper.
 *
 * Invariant conservé : un message marqué `btw` reste EN DERNIER (c'est sa définition — il part après
 * tous les autres, y compris ceux tapés ensuite). On ne le déplace pas, et rien ne passe après lui.
 *
 * PUR (aucun React) → testable directement.
 */

export interface QueueEntryLike {
  id: number
  mode?: 'btw'
}

/** Index du dernier emplacement déplaçable (les `btw` de queue sont hors-jeu). */
function movableLength<T extends QueueEntryLike>(list: T[]): number {
  let n = list.length
  while (n > 0 && list[n - 1].mode === 'btw') n -= 1
  return n
}

/**
 * Déplace l'entrée `id` d'un cran (`-1` haut, `+1` bas). Rend la MÊME référence si le déplacement
 * est impossible (entrée absente, déjà en bout, ou entrée `btw`) — l'appelant peut donc comparer.
 */
export function moveQueueEntry<T extends QueueEntryLike>(
  list: T[],
  id: number,
  delta: -1 | 1
): T[] {
  const from = list.findIndex((entry) => entry.id === id)
  if (from < 0) return list
  if (list[from].mode === 'btw') return list
  const limit = movableLength(list)
  const to = from + delta
  if (to < 0 || to >= limit) return list
  const next = list.slice()
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry)
  return next
}

/** Le déplacement est-il offert pour cette entrée ? (pilote l'état `disabled` des boutons). */
export function canMoveQueueEntry<T extends QueueEntryLike>(
  list: T[],
  id: number,
  delta: -1 | 1
): boolean {
  return moveQueueEntry(list, id, delta) !== list
}
