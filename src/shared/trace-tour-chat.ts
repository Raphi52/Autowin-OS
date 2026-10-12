/**
 * Frontières d'observation des deux événements qu'un tour de chat écrit pour l'arbre du panneau
 * Détails (`src/main/activity/chat-turn-trace.ts`) : partagées pour que l'écran les reconnaisse
 * sans dépendre du code du processus principal.
 */
export const FRONTIERE_DEMANDE_RECUE = 'Autowin chat turn start'
export const FRONTIERE_GESTE_AGENT = 'Autowin chat native tool'
