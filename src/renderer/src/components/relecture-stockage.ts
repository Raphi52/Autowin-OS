/**
 * COMMENTAIRES DE RELECTURE QUI SURVIVENT À L'ÉCRAN.
 *
 * Le panneau des fichiers existe en DEUX exemplaires (onglet graphe et onglet Files de
 * `WorkflowsPanel`) et se démonte à chaque changement d'onglet ; un état React local perdrait donc
 * une relecture en cours au premier clic ailleurs. Même choix que `brouillons-persistes.ts` :
 * `localStorage`, état local de fenêtre, une entrée par conversation.
 */
import { relireCommentaires, type CommentaireRelecture } from '../../../shared/relecture-diff'

export const PREFIXE_RELECTURE = 'autowin.relecture.'

export function lireRelecture(conversationId: string | undefined): CommentaireRelecture[] {
  if (!conversationId) return []
  try {
    const brut = localStorage.getItem(PREFIXE_RELECTURE + conversationId)
    return brut ? relireCommentaires(JSON.parse(brut)) : []
  } catch {
    // Stockage indisponible ou JSON abîmé : on repart d'une relecture vide plutôt que de planter.
    return []
  }
}

export function ecrireRelecture(
  conversationId: string | undefined,
  commentaires: readonly CommentaireRelecture[]
): void {
  if (!conversationId) return
  try {
    const cle = PREFIXE_RELECTURE + conversationId
    if (commentaires.length === 0) localStorage.removeItem(cle)
    else localStorage.setItem(cle, JSON.stringify(commentaires))
  } catch {
    // Quota plein ou stockage absent : la relecture reste valable pour cet écran.
  }
}

let compteurIds = 0

/**
 * Identifiant d'un commentaire. Hors du composant : la règle de pureté de React refuse `Date.now`
 * dans le corps d'un composant, même au fond d'un gestionnaire de clic.
 */
export function nouvelIdCommentaire(): string {
  compteurIds += 1
  return `${Date.now().toString(36)}-${compteurIds.toString(36)}`
}
