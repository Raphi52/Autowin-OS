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

/** Ce que le rejeu lit d'un message enregistré : son tour, son état et son texte. */
export type MessageEnregistre = {
  role?: string
  turnId?: string
  status?: string
  content?: string
  parts?: ReadonlyArray<{ kind?: string; text?: string }>
}

/**
 * LE REJEU N'A RIEN À AJOUTER QUAND L'ENREGISTREMENT PORTE DÉJÀ LE TOUR.
 *
 * Vécu conv-1149 (2026-10-25), sur le défaut de conv-1146 (« uniquement le bloc raisonnement vide »),
 * reproduit dans une instance cachée. Au rechargement de la fenêtre, la reprise vise un tour ENCORE EN
 * VOL ; un brouillon retient l'écran sur un autre fil, et le texte du tour est rejoué depuis son
 * journal en une bulle « terminée ». Ce rejeu ne lisait pas l'enregistrement : il posait un fil réduit
 * à cette bulle — sans la demande ni l'action en cours — et ce fil-là gagnait ensuite à l'ouverture.
 *
 * Le rejeu sert au tour dont l'enregistrement N'A PAS reçu le texte (l'app était fermée). Il est donc
 * inutile quand l'enregistrement porte le même tour encore EN VOL — le processus principal enregistre
 * chaque événement avant de l'envoyer à l'écran, l'enregistrement est complet — ou quand il porte
 * déjà le texte rejoué.
 */
export function rejeuDejaEnregistre(
  messages: readonly MessageEnregistre[],
  turnId: string,
  texteRejoue: string
): boolean {
  const copie = messages.find(
    (message) => message.role === 'assistant' && message.turnId === turnId
  )
  if (!copie) return false
  if (copie.status === 'streaming') return true
  const attendu = texteRejoue.trim()
  const texte = [
    copie.content ?? '',
    ...(copie.parts ?? []).map((part) => (part.kind === 'text' ? (part.text ?? '') : ''))
  ].join('\n')
  return attendu !== '' && texte.includes(attendu)
}
