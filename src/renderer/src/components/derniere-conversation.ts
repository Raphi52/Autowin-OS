/**
 * MEMOIRE de la dernière conversation ouverte, pour rouvrir dessus au démarrage.
 *
 * Demande utilisateur du 2026-08-18 : « quand je relance l'app j'aimerais que ça me mette sur ma
 * dernière conversation où j'étais ». La conversation active ne vivait qu'en mémoire du processus
 * principal (`activeConversationId`), donc perdue à chaque relance ; et le boot n'ouvrait que les
 * conversations à tour inachevé (survie de niveau 2), ce qui laissait l'utilisateur sur autre chose.
 *
 * `localStorage` et non le store disque : c'est une préférence d'affichage locale, du même ordre que
 * la largeur des panneaux ou les catégories repliées. Elle n'a rien à faire dans les données
 * partagées d'une conversation.
 */
export const CLE_DERNIERE_CONVERSATION = 'autowin.chat.derniereConversation'

/** Retient la conversation ouverte. Un échec d'écriture ne doit jamais casser une navigation. */
export function memoriserDerniereConversation(id: string): void {
  try {
    window.localStorage.setItem(CLE_DERNIERE_CONVERSATION, id)
  } catch {
    // Stockage indisponible (mode privé, quota) : la reprise est un confort, pas un invariant.
  }
}

/**
 * L'identifiant retenu, s'il désigne encore une conversation EXISTANTE.
 *
 * Le contrôle d'existence est ici et pas chez l'appelant : une conversation supprimée entre deux
 * lancements ne doit pas produire une sélection fantôme ni une erreur au boot.
 */
export function derniereConversationOuverte(
  existantes: readonly { id: string }[]
): string | undefined {
  let retenu: string | null = null
  try {
    retenu = window.localStorage.getItem(CLE_DERNIERE_CONVERSATION)
  } catch {
    return undefined
  }
  if (!retenu) return undefined
  return existantes.some((conversation) => conversation.id === retenu) ? retenu : undefined
}
