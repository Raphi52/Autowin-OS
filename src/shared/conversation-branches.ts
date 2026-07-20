/**
 * Reconstruction PURE et PARTAGÉE de la chaîne de messages d'une branche.
 * Source unique consommée par le store (main) ET la vue (renderer) pour éviter
 * toute divergence de sémantique de branchement.
 */
export interface BranchNode {
  id: string
  parentBranchId?: string
  forkedFromMessageId?: string
}

export interface ChainMessage {
  messageId?: string
  branchId?: string
  parentMessageId?: string
}

/**
 * Chaîne visible pour `branchId` : part du « tip » (dernier message de la branche,
 * ou son point de fork si la branche est encore vide) et remonte `parentMessageId`
 * jusqu'à la racine, héritant naturellement des messages du parent avant le fork.
 */
export function reconstructBranchChain<M extends ChainMessage>(
  messages: M[],
  branches: BranchNode[] | undefined,
  branchId: string
): M[] {
  // Ne chaîner que sur des ids définis : des messages legacy sans messageId
  // (données pré-migration) s'écraseraient sinon sur une unique clé `undefined`.
  const byId = new Map(messages.filter((m) => m.messageId).map((m) => [m.messageId, m] as const))
  let tip: M | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].branchId === branchId) {
      tip = messages[i]
      break
    }
  }
  if (!tip) {
    const branch = branches?.find((b) => b.id === branchId)
    tip = branch?.forkedFromMessageId ? byId.get(branch.forkedFromMessageId) : undefined
  }
  const chain: M[] = []
  const seen = new Set<string>()
  let cursor = tip
  while (cursor) {
    if (cursor.messageId && seen.has(cursor.messageId)) break // anti-cycle défensif
    if (cursor.messageId) seen.add(cursor.messageId)
    chain.push(cursor)
    cursor = cursor.parentMessageId ? byId.get(cursor.parentMessageId) : undefined
  }
  return chain.reverse()
}
