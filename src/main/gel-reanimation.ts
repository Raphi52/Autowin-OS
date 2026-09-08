/**
 * REANIMER LA FENETRE AU LIEU DE TUER L'APPLICATION.
 *
 * Mesure du 2026-09-08 (conv-353) : la vue Knowledge se figeait sans fin — processeur a fond,
 * memoire qui monte, debogueur muet. La SEULE issue etait de fermer l'application, ce qui coute a
 * l'utilisateur tout ce qui tourne a cote, et coute au diagnostic un redemarrage complet par essai.
 *
 * Or le processus PRINCIPAL, lui, reste vivant pendant ce gel : c'est lui qui recoit `unresponsive`.
 * Il peut donc recharger le contenu de la fenetre, ce qui tue le processus d'affichage bloque et en
 * repart un neuf — l'application, ses runs et ses autres fenetres survivent.
 *
 * Deux gardes rendent le geste sur :
 *   - un SEUIL : on ne reanime pas une lenteur passagere, seulement un gel qui dure ;
 *   - un DELAI entre deux reanimations : sans lui, une page qui se fige a chaque chargement
 *     serait rechargee en boucle, ce qui remplacerait un gel par une machine a recharger.
 */

/** Ce que la regle a besoin de savoir — aucun Electron ici, donc testable sans fenetre reelle. */
export interface EtatGel {
  /** Depuis combien de temps la fenetre est injoignable, en millisecondes. */
  gelDepuisMs: number
  /** Date de la derniere reanimation, ou undefined si aucune. */
  derniereReanimation?: number
  /** L'instant courant. */
  maintenant: number
}

export interface ReglagesReanimation {
  /** Duree de gel au-dela de laquelle on recharge. */
  seuilMs: number
  /** Duree minimale entre deux reanimations. */
  delaiEntreDeuxMs: number
}

export const REGLAGES_REANIMATION_PAR_DEFAUT: ReglagesReanimation = {
  seuilMs: 20_000,
  delaiEntreDeuxMs: 120_000
}

/** Motif journalise quand la fenetre est rechargee pour la sortir d'un gel. */
export const OPERATION_REANIMATION = 'renderer:fenetre-reanimee'

/**
 * Faut-il recharger la fenetre maintenant ? Rend le motif du refus quand la reponse est non, pour
 * que le journal dise POURQUOI on a laisse le gel courir plutot que de rester muet.
 */
export function doitReanimer(
  etat: EtatGel,
  reglages: ReglagesReanimation = REGLAGES_REANIMATION_PAR_DEFAUT
): { reanimer: true } | { reanimer: false; motif: 'sous-le-seuil' | 'trop-recent' } {
  if (etat.gelDepuisMs < reglages.seuilMs) return { reanimer: false, motif: 'sous-le-seuil' }
  if (
    etat.derniereReanimation !== undefined &&
    etat.maintenant - etat.derniereReanimation < reglages.delaiEntreDeuxMs
  )
    return { reanimer: false, motif: 'trop-recent' }
  return { reanimer: true }
}
