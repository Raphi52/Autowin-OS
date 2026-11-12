/**
 * LES AVIS QUE L'APP ÉCRIT PENDANT LA PRÉPARATION D'UN TOUR (copie de travail ouverte ou reprise,
 * bascule de dossier, dossier sans effet, modèle indisponible) attendent que le message envoyé soit
 * enregistré.
 *
 * Le message de l'utilisateur n'entre dans le fil qu'au début du tour (`beginTurn`, dans
 * `run-pilot-chat.ts`), APRÈS cette préparation. Écrit tout de suite, un avis passait donc AU-DESSUS
 * du message qui l'avait provoqué (61 annonces de copie sur 74 relues le 2026-11-12), et le
 * rafraîchissement qui le suivait repeignait le fil depuis le disque, où le message manquait encore :
 * la bulle envoyée disparaissait, puis revenait sous l'avis — « quand le message copie apparaît, ça
 * fait clignoter mon message envoyé ».
 *
 * Retenus pendant la préparation (`tourCompteDesReception`, ipc/chat.ts), les avis s'écrivent au début
 * du tour, sous le message envoyé et au-dessus de la réponse encore vierge. Un tour qui échoue avant
 * de commencer les reçoit quand son lancement se termine : un avis n'est jamais perdu.
 */
export type FilDesAvis = {
  append(
    conversationId: string,
    message: { role: 'assistant'; content: string; avantLaReponseEnCours: true }
  ): unknown
}

export type AvisAvantTour = {
  /** La préparation du tour de ce fil commence : ses avis sont retenus jusqu'à `liberer`. */
  retenir(conversationId: string): void
  /** Un avis : retenu pendant la préparation du tour de ce fil, écrit tout de suite sinon. */
  annoncer(conversationId: string, contenu: string): void
  /**
   * Écrit les avis retenus du fil, dans leur ordre, et cesse de les retenir. Appelé au début du tour,
   * puis de nouveau à la fin de la préparation pour un tour qui n'a pas commencé : sans rien de
   * retenu, c'est sans effet.
   */
  liberer(conversationId: string | undefined): void
}

export function creerAvisAvantTour(dependances: {
  fil: FilDesAvis
  /** Repeint le fil à l'écran : jamais pendant la rétention, le disque n'a pas encore le message. */
  rafraichir: (conversationId: string) => void
}): AvisAvantTour {
  const retenus = new Map<string, string[]>()
  // `avantLaReponseEnCours` : juste après `beginTurn`, le dernier message est la réponse vierge du tour,
  // et l'avis passe au-dessus d'elle ; sans réponse vierge en fin de fil, il s'ajoute à la fin.
  const ecrire = (conversationId: string, contenu: string): void => {
    dependances.fil.append(conversationId, {
      role: 'assistant',
      content: contenu,
      avantLaReponseEnCours: true
    })
  }
  return {
    retenir(conversationId) {
      if (!retenus.has(conversationId)) retenus.set(conversationId, [])
    },
    annoncer(conversationId, contenu) {
      const file = retenus.get(conversationId)
      if (file) {
        file.push(contenu)
        return
      }
      ecrire(conversationId, contenu)
      dependances.rafraichir(conversationId)
    },
    liberer(conversationId) {
      if (!conversationId) return
      const file = retenus.get(conversationId)
      retenus.delete(conversationId)
      if (!file?.length) return
      for (const contenu of file) ecrire(conversationId, contenu)
      dependances.rafraichir(conversationId)
    }
  }
}
