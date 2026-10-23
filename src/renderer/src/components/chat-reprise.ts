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
  /**
   * Un tour occupe-t-il deja ce fil ? Reponse de l'AUTORITE (le main), pas de l'ecran : au
   * demarrage, l'ecran n'a pas encore adopte le tour repris.
   */
  tourEnCours: (conversationId: string) => Promise<boolean>
  /** Range la consigne derriere le tour en cours : elle partira a sa fin. */
  mettreEnFile: (consigne: string, conversationId: string) => void
  /** Envoie la consigne dans cette conversation. */
  envoyer: (consigne: string, conversationId: string) => Promise<void>
}

export type ResultatReprise =
  | { repris: false; motif: 'aucune' | 'conversation-absente' }
  | { repris: true; conversationId: string; enFile?: true }

export async function reprendreApresRedemarrage(
  deps: DependancesReprise
): Promise<ResultatReprise> {
  const reprise = await deps.lire()
  if (!reprise) return { repris: false, motif: 'aucune' }
  // La conversation a pu etre supprimee entre la pose et le redemarrage : on ne fabrique pas un
  // fil pour y deposer une consigne orpheline.
  if (!(await deps.ouvrir(reprise.conversationId)))
    return { repris: false, motif: 'conversation-absente' }
  /*
   * LE TOUR QUI A DEMANDE LE REDEMARRAGE TOURNE ENCORE (conv-1127, 2026-10-23 20:55). `restart_app`
   * relance l'app 1,2 s apres sa reponse : le CLI de ce tour survit, le main le REPREND au demarrage
   * et refuse tout nouveau message dans ce fil tant qu'il vit. Envoyee aussitot, la consigne etait
   * refusee (« Un tour repris apres le redemarrage tourne encore ») — et perdue, le main l'ayant deja
   * effacee du disque. Elle attend donc la fin de ce tour, comme un message tape pendant un tour.
   */
  if (await deps.tourEnCours(reprise.conversationId)) {
    deps.mettreEnFile(reprise.consigne, reprise.conversationId)
    return { repris: true, conversationId: reprise.conversationId, enFile: true }
  }
  await deps.envoyer(reprise.consigne, reprise.conversationId)
  return { repris: true, conversationId: reprise.conversationId }
}
