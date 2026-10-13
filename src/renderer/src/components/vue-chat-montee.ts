import type { Msg } from './chat-view-types'

/**
 * LA VUE DU CHAT RÉELLEMENT MONTÉE — pour une fin de tour lancée par une vue remontée depuis.
 *
 * Un envoi garde, jusqu'à la fin du tour, la copie du fil de la vue qui l'a lancé
 * (`liveMessagesRef`). Si la vue est remontée entre-temps, cette copie est morte : elle ne reçoit
 * plus rien, et la fin du tour y lisait un début de réponse. En mode développement, la vue est
 * remontée chaque fois qu'un fichier qu'elle importe change sous les agents. Mesuré le 2026-10-12 :
 * 12 « Réponse affichée » sur 50 tronquées (conv-912 : 185 caractères sur 5 053), et conv-910 et
 * conv-912 figées à la MÊME seconde (17:08:47), celle d'un remontage.
 *
 * Ce module ne vit pas dans `ChatView.tsx` : un module rechargé à chaud est réexécuté, et un état
 * posé dans SON corps repartirait de zéro avec lui. Ici, il survit au remontage.
 */
type FilsParConversation = ReadonlyMap<string, readonly Msg[]>

let montee: { fils: () => FilsParConversation } | null = null

/** Déclare la vue montée ; la fonction rendue la retire, seulement si elle est encore la montée. */
export function declarerVueChatMontee(fils: () => FilsParConversation): () => void {
  const entree = { fils }
  montee = entree
  return () => {
    if (montee === entree) montee = null
  }
}

/** Le fil d'une conversation dans la vue montée ; rien quand aucune vue n'est montée. */
export function filDeLaVueMontee(conversationId: string): readonly Msg[] | undefined {
  return montee?.fils().get(conversationId)
}
