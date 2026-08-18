/**
 * Reprise AUTOMATIQUE au démarrage (survie niveau 2) : aucun popup, aucune question — si un tour a
 * été interrompu par la fermeture de l'app, on rouvre directement sa conversation pour y relire ce
 * que le CLI a produit. Logique PURE (donc testable) : choisir quel tour reprendre.
 */
import { resumeIsStale } from '../../../shared/resume-staleness'

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
 *
 * `nowMs` OPTIONNEL : fourni, il écarte les tours PÉRIMÉS (`shared/resume-staleness.ts`). Omis, le
 * comportement reste exactement l'historique — ce module n'a pas d'horloge cachée.
 *
 * Sans cette borne, un vestige de la veille gardait la priorité sur la mémoire de la dernière
 * conversation ouverte, et l'utilisateur retombait dessus à chaque démarrage (mesuré le 2026-08-18,
 * conv-1267 : deux tours interrompus par un processus tué, en tête de `unfinishedTurns()`).
 */
export function pickTurnToResume(
  turns: readonly UnfinishedTurn[] | null | undefined,
  nowMs?: number
): UnfinishedTurn | null {
  if (!Array.isArray(turns) || turns.length === 0) return null
  const usable = turns.filter(
    (turn) =>
      turn &&
      typeof turn.conversationId === 'string' &&
      turn.conversationId &&
      turn.events > 0 &&
      (nowMs === undefined || !resumeIsStale(turn.updatedAt, nowMs))
  )
  if (usable.length === 0) return null
  return usable.reduce((best, turn) => (turn.updatedAt > best.updatedAt ? turn : best))
}
