import type { HomeLayout } from './home-layout'

/**
 * L'historique des agencements, pour pouvoir ANNULER un geste.
 *
 * Friction relevée le 2026-08-21 par un scout lancé dans Autowin (score 71) : « Disperser » modifiait
 * la disposition d'un coup, et le seul recours était « Rétablir », qui effaçait AUSSI tous les
 * ajustements volontaires. Perdre son travail pour annuler une erreur n'est pas une annulation.
 *
 * L'historique porte sur l'AGENCEMENT — la source de vérité persistée — et jamais sur l'affichage
 * dérivé pour la surface courante. Empiler l'affichage y regraverait un mode compact et rejouerait la
 * perte de disposition corrigée le même jour.
 */
export interface ArrangementHistory {
  /** Les états précédents, du plus ancien au plus récent. Le dernier est celui qu'Annuler restaure. */
  passe: HomeLayout[]
}

/**
 * Profondeur bornée. Une pile sans limite garde en mémoire tous les gestes d'une journée pour un
 * bénéfice nul : personne n'annule cinquante fois de suite.
 */
export const HISTORY_DEPTH = 20

export function emptyHistory(): ArrangementHistory {
  return { passe: [] }
}

/** Empile l'état AVANT le geste. À appeler juste avant de modifier l'agencement. */
export function remember(history: ArrangementHistory, avant: HomeLayout): ArrangementHistory {
  const passe = [...history.passe, avant]
  return { passe: passe.slice(-HISTORY_DEPTH) }
}

export function canUndo(history: ArrangementHistory): boolean {
  return history.passe.length > 0
}

/**
 * Défait le dernier geste : rend l'agencement précédent et l'historique amputé.
 *
 * Rend `null` quand il n'y a rien à défaire, plutôt qu'un état inchangé : l'appelant doit pouvoir
 * distinguer « annulé » de « rien à annuler » sans comparer des tableaux.
 */
export function undo(
  history: ArrangementHistory
): { arrangement: HomeLayout; history: ArrangementHistory } | null {
  if (history.passe.length === 0) return null
  const arrangement = history.passe[history.passe.length - 1]
  return { arrangement, history: { passe: history.passe.slice(0, -1) } }
}
