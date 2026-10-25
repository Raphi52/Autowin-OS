/**
 * LA RÉPONSE QUI PORTE UN BLOC DU FIL (conv-1147, 2026-10-25 — défaut D5 du juge).
 *
 * Le Markdown du fil ne reçoit que du texte (`memo` sur des primitives). La carte « Lancer en N
 * fils » tirait donc son souvenir « déjà lancée » de sa seule SOURCE : deux cartes au même
 * contenu, ou la même carte recopiée dans une branche du fil, partageaient ce souvenir. La seconde
 * se croyait lancée sans l'avoir été. ChatMessageRow pose ici l'IDENTITÉ de la réponse ; un
 * contexte traverse le `memo` du Markdown sans changer ses props.
 *
 * L'identité = (fil qui affiche la réponse, TOUR de la réponse), pas son identifiant de message.
 * Relecture externe du 2026-10-25 (score 74) : une réponse peinte en direct n'a d'identifiant de
 * message qu'une fois son fil relu du disque, et seul le fil affiché en plein l'est
 * (`chat-event-routing.ts`). Dans une fenêtre de mosaïque, la carte restait grisée pour de bon. Le
 * tour, lui, arrive avec le premier événement du tour et vaut la même chose à l'écran et sur
 * disque. Un tour n'a qu'une réponse ; une branche copiée garde le tour mais change de fil.
 *
 * `null` = rendu hors d'un fil (aperçu, test) ; `''` = réponse encore en cours d'écriture ; sinon,
 * l'identité. Fichier sans composant (react-refresh).
 */
import { createContext } from 'react'

export const MessageDuFil = createContext<string | null>(null)

/** Le tour d'une réponse dont aucun événement n'a encore donné l'identifiant (`chat-view-model.ts`). */
const TOUR_INCONNU = 'pending'

export function identiteDeLaReponse(
  message: { done?: boolean; turnId?: string; messageId?: string },
  conversationId: string | null | undefined
): string | null {
  if (message.done !== true) return ''
  const fil = conversationId ?? ''
  if (message.turnId && message.turnId !== TOUR_INCONNU) return `${fil}:${message.turnId}`
  // Message d'un ancien format, sans tour : son identifiant de message, s'il en a un.
  if (message.messageId) return `${fil}:${message.messageId}`
  return null
}
