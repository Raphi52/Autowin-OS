/**
 * REPRISE APRES REDEMARRAGE, cote interface.
 *
 * Le main pose la consigne sur le disque avant de tuer le process (`restart_app`), et la rend UNE
 * SEULE FOIS au demarrage suivant. Ici on la rejoue comme un message ORDINAIRE : meme chemin que
 * si l'utilisateur l'avait tapee, donc meme routage, meme trace, meme affichage dans le fil. Un
 * canal parallele aurait produit un tour invisible dans l'historique.
 *
 * Extrait de ChatView pour etre exercable sans monter tout le composant.
 */
export interface RepriseLue {
  conversationId: string
  consigne: string
  raison?: string
  poseeA: number
}

export interface DependancesReprise {
  /** Consomme la consigne en attente (destructif cote main). */
  lire: () => Promise<RepriseLue | null>
  /** Ouvre la conversation cible ; `false` si elle n'existe plus. */
  ouvrir: (conversationId: string) => Promise<boolean>
  /** Envoie la consigne dans cette conversation. */
  envoyer: (consigne: string, conversationId: string) => Promise<void>
}

export type ResultatReprise =
  | { repris: false; motif: 'aucune' | 'conversation-absente' }
  | { repris: true; conversationId: string }

export async function reprendreApresRedemarrage(
  deps: DependancesReprise
): Promise<ResultatReprise> {
  const reprise = await deps.lire()
  if (!reprise) return { repris: false, motif: 'aucune' }
  // La conversation a pu etre supprimee entre la pose et le redemarrage : on ne fabrique pas un
  // fil pour y deposer une consigne orpheline.
  if (!(await deps.ouvrir(reprise.conversationId)))
    return { repris: false, motif: 'conversation-absente' }
  await deps.envoyer(reprise.consigne, reprise.conversationId)
  return { repris: true, conversationId: reprise.conversationId }
}
