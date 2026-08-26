/**
 * QUELLES CONVERSATIONS PEUVENT CONTENIR CE MOT — sans lire le corpus.
 *
 * La recherche parcourait les 1197 conversations a chaque appel, et l'index de voisinage etait
 * DETRUIT a chaque message pour etre reconstruit entierement a la recherche suivante. Mesure : 108 ms
 * synchrones dans le processus principal d'Electron, a chaque tour de chat. Un gel percu, pas un
 * chiffre abstrait.
 *
 * Deporter ce calcul dans un worker aurait DEPLACE le probleme -- et paye 28 Mo de serialisation pour
 * l'y envoyer. Le supprimer demande de ne plus poser la question au corpus entier : un index inverse
 * repond « ces trois conversations, pas les 1194 autres », et se met a jour a l'AJOUT d'un message
 * plutot que d'etre jete.
 *
 * Ce n'est pas un cache de resultats : c'est une pre-selection de CANDIDATS. Le scan fin (score,
 * extraits, revirements) reste identique, il ne porte plus que sur ce qui peut correspondre.
 */

export interface IndexInverse {
  /** Les conversations qui contiennent au moins une des racines, ou undefined si l'index ne sait pas. */
  candidates(racines: readonly string[]): Set<string> | undefined
  /** Enregistre un message : mise a jour INCREMENTALE, aucun parcours du corpus. */
  ajouter(conversationId: string, racines: readonly string[]): void
  /** Oublie une conversation entiere (suppression). */
  retirer(conversationId: string): void
}

export function creerIndexInverse(): IndexInverse {
  /** racine -> ids de conversations qui la portent. */
  const parRacine = new Map<string, Set<string>>()
  /** id -> racines vues, pour pouvoir retirer proprement. */
  const parConversation = new Map<string, Set<string>>()

  return {
    candidates(racines) {
      if (racines.length === 0) return undefined
      const reunion = new Set<string>()
      for (const racine of racines) {
        const porteurs = parRacine.get(racine)
        if (!porteurs) continue
        for (const id of porteurs) reunion.add(id)
      }
      return reunion
    },

    ajouter(conversationId, racines) {
      let vues = parConversation.get(conversationId)
      if (!vues) {
        vues = new Set()
        parConversation.set(conversationId, vues)
      }
      for (const racine of racines) {
        vues.add(racine)
        let porteurs = parRacine.get(racine)
        if (!porteurs) {
          porteurs = new Set()
          parRacine.set(racine, porteurs)
        }
        porteurs.add(conversationId)
      }
    },

    retirer(conversationId) {
      const vues = parConversation.get(conversationId)
      if (!vues) return
      for (const racine of vues) {
        const porteurs = parRacine.get(racine)
        if (!porteurs) continue
        porteurs.delete(conversationId)
        if (porteurs.size === 0) parRacine.delete(racine)
      }
      parConversation.delete(conversationId)
    }
  }
}
