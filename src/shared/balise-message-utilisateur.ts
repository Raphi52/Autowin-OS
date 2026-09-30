/**
 * Nom de la balise qui encadre les mots de l'utilisateur dans un tour compose (conv-889, 2026-09-30).
 *
 * Partage entre le processus principal, qui POSE la balise (`main/chat-turn-messages.ts`,
 * `motsUtilisateur`), et l'interface, qui la RETIRE pour afficher la demande
 * (`renderer/src/components/human-message.ts`). Une seule definition : si l'un changeait le nom sans
 * l'autre, l'interface afficherait les balises dans chaque libelle de tour.
 */
export const BALISE_MESSAGE_UTILISATEUR = 'message_utilisateur'

const BALISES = new RegExp(`</?${BALISE_MESSAGE_UTILISATEUR}>`, 'gi')

/** Le texte sans ses balises d'encadrement. */
export function sansBaliseMessageUtilisateur(texte: string): string {
  return texte.replace(BALISES, '')
}
