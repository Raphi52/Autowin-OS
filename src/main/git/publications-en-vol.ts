/**
 * LES PUBLICATIONS QUI SUIVENT UN TOUR, comptées pour que le redémarrage les attende.
 *
 * La publication d'un tour (typage, tests, commit, push) part APRÈS la fin du tour, sans être
 * attendue : le redémarrage au repos ne voyait que les tours et les orchestrations, et la coupait
 * environ une minute plus tard. Mesuré le 2026-11-01 (maintenance) : 4 copies de
 * comparaison abandonnées en 24 h, ouvertes juste avant un redémarrage, et leurs 7 fichiers encore
 * non commités dans `main`.
 *
 * Le plafond n'est pas une attente de plus : sans lui, une publication bloquée (un push qui ne rend
 * jamais la main) interdirait tout redémarrage en silence. Passé ce délai, elle ne compte plus.
 */
export const PLAFOND_PUBLICATION_MS = 30 * 60_000

export interface SuiviDesPublications {
  /** Note le début d'une publication ; rend la fonction qui note sa fin. */
  debut(conversationId: string): () => void
  /** Les conversations dont une publication tourne encore, sans doublon. */
  conversations(): string[]
}

export function creerSuiviDesPublications(
  maintenant: () => number = Date.now,
  plafondMs: number = PLAFOND_PUBLICATION_MS
): SuiviDesPublications {
  const enCours = new Set<{ conversationId: string; depuis: number }>()
  return {
    debut(conversationId) {
      const publication = { conversationId, depuis: maintenant() }
      enCours.add(publication)
      return () => {
        enCours.delete(publication)
      }
    },
    conversations() {
      const limite = maintenant() - plafondMs
      return [
        ...new Set([...enCours].filter((p) => p.depuis > limite).map((p) => p.conversationId))
      ]
    }
  }
}
