/**
 * Reprise AUTOMATIQUE au démarrage (survie niveau 2) : aucun popup, aucune question — si un tour a
 * été interrompu par la fermeture de l'app, on rouvre directement sa conversation pour y relire ce
 * que le CLI a produit. Logique PURE (donc testable) : choisir quel tour reprendre.
 */
export interface UnfinishedTurn {
  conversationId: string
  turnId: string
  events: number
  updatedAt: number
}

/**
 * Tour à reprendre = le PLUS RÉCEMMENT actif (celui que l'utilisateur regardait quand l'app est
 * tombée), et seulement s'il porte au moins un événement récupéré (sinon rien à montrer).
 * Aucun candidat → null (démarrage normal, strictement inchangé).
 */
export function pickTurnToResume(
  turns: readonly UnfinishedTurn[] | null | undefined
): UnfinishedTurn | null {
  if (!Array.isArray(turns) || turns.length === 0) return null
  const usable = turns.filter(
    (turn) =>
      turn && typeof turn.conversationId === 'string' && turn.conversationId && turn.events > 0
  )
  if (usable.length === 0) return null
  return usable.reduce((best, turn) => (turn.updatedAt > best.updatedAt ? turn : best))
}
