/**
 * RELAIS d'ouverture de conversation.
 *
 * Défaut vécu le 2026-09-17 : depuis l'écran des fiches, la bulle d'un ticket demandait l'affichage
 * du chat PUIS émettait tout de suite `autowin:open-conversation`. Quand le chat n'était pas encore
 * monté, son écouteur n'existait pas : l'événement tombait dans le vide et le chat, en s'affichant,
 * ouvrait « là où l'utilisateur était » — une autre conversation. Vu de l'utilisateur : « ça bascule
 * toujours sur la première ».
 *
 * L'événement reste le chemin normal (chat déjà monté). Ce relais couvre le cas où le destinataire
 * n'existe pas encore : la demande est DÉPOSÉE, puis RÉCLAMÉE par le chat à son montage.
 * Volontairement à usage unique : une demande consommée ne doit pas rouvrir la conversation plus
 * tard, sinon elle volerait la sélection de l'utilisateur.
 */
let enAttente: string | null = null

/** Dépose la conversation à ouvrir dès que le chat sera là. */
export function deposerOuvertureConversation(conversationId: string): void {
  enAttente = conversationId
}

/** Réclame la demande en attente (et la consomme). `null` si aucune. */
export function reclamerOuvertureConversation(): string | null {
  const demande = enAttente
  enAttente = null
  return demande
}
