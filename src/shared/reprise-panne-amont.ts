/**
 * Reprise automatique quand le fournisseur de modèle tombe (529 « surchargé » et voisins).
 *
 * Le geste : la demande n'a produit aucune réponse, donc on la REJOUE dans une COPIE de la
 * conversation, prise juste avant la demande ratée. La conversation d'origine garde son échec —
 * rien n'est effacé, rien n'est masqué — et la copie porte la nouvelle tentative.
 *
 * Pourquoi une copie plutôt qu'un renvoi sur place : la conversation d'origine contient déjà la
 * demande ratée et sa bulle en échec. Rejouer dessus empilerait la même demande deux fois dans
 * l'historique envoyé au modèle. Repartir du dernier message AVANT la demande donne un fil propre.
 *
 * Module PUR : aucune dépendance à Electron ni à React. Tout ce qui touche au monde extérieur
 * (créer la copie, renvoyer, attendre) est passé en paramètre, donc testable sans interface.
 */

/**
 * Attentes entre deux tentatives. VOLONTAIREMENT courtes : le lecteur du CLI a DÉJÀ attendu en
 * escalier pendant 2-3 minutes avant de rendre la main (`src/main/providers/claude.ts`). Ces
 * attentes-ci s'ajoutent à la sienne ; à 30/60/120 s l'utilisateur attendrait ~3 min 30 de plus
 * pour rien. 5/15/30 s ajoutent 50 s au pire.
 */
export const DELAIS_REPRISE_MS: readonly number[] = [5_000, 15_000, 30_000]

/** Plafond DUR de tentatives supplémentaires. Au-delà, l'échec est rendu à l'utilisateur. */
export const MAX_REPRISES = DELAIS_REPRISE_MS.length

export interface OutilsDeReprise<R> {
  /** Crée la copie de la conversation et rend son identifiant, ou `undefined` si c'est refusé. */
  copier: () => Promise<string | undefined>
  /** Rejoue la MÊME demande dans la copie désignée. */
  renvoyer: (conversationId: string) => Promise<R>
  /** Vrai quand ce résultat est encore une panne du fournisseur. */
  estPanneAmont: (resultat: R) => boolean
  /** Attente entre deux tentatives. */
  attendre: (ms: number) => Promise<void>
  /** Vrai si l'utilisateur a annulé ou fermé entre-temps : on n'insiste pas. */
  abandonne?: () => boolean
  /** Appelé AVANT chaque tentative (numérotée à partir de 1), pour tenir l'utilisateur au courant. */
  surTentative?: (numero: number, total: number) => void
}

export type Reprise<R> =
  /** Une tentative a rendu autre chose qu'une panne : la suite du fil est dans `conversationId`. */
  | { issue: 'reprise'; conversationId: string; resultat: R; tentatives: number }
  /** Les tentatives sont épuisées et la panne dure. */
  | { issue: 'epuisee'; tentatives: number }
  /** Aucune tentative n'était possible (copie refusée, ou abandon de l'utilisateur). */
  | { issue: 'impossible'; tentatives: number }

/**
 * Rejoue la demande jusqu'à `MAX_REPRISES` fois, chaque fois dans une copie NEUVE prise au même
 * point. Une copie neuve par tentative : la précédente porte déjà une demande en échec, la
 * réutiliser rejouerait la demande dans un fil qui la contient.
 *
 * Ne rattrape AUCUNE exception : si `renvoyer` jette (canal coupé, conversation supprimée), l'appelant
 * la voit. Avaler ce cas transformerait une panne locale en « rien ne s'est passé ».
 */
export async function reprendreApresPanneAmont<R>(outils: OutilsDeReprise<R>): Promise<Reprise<R>> {
  let tentatives = 0
  for (const delai of DELAIS_REPRISE_MS) {
    if (outils.abandonne?.()) return { issue: 'impossible', tentatives }
    outils.surTentative?.(tentatives + 1, MAX_REPRISES)
    await outils.attendre(delai)
    if (outils.abandonne?.()) return { issue: 'impossible', tentatives }
    const copie = await outils.copier()
    if (!copie) return { issue: 'impossible', tentatives }
    tentatives += 1
    const resultat = await outils.renvoyer(copie)
    if (!outils.estPanneAmont(resultat))
      return { issue: 'reprise', conversationId: copie, resultat, tentatives }
  }
  return { issue: 'epuisee', tentatives }
}
