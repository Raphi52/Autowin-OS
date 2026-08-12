// Reproduction TS pure, model-agnostic, du "stop-gate" du kit autowin.
// Fonction pure évaluant si une clôture "done/green" est légitime.

/** Une case de Definition-of-Done. */
export interface DodItem {
  /** La case est cochée. */
  checked: boolean
  /** La case a un contenu réel (une DoD vide/non applicable ne bloque jamais). */
  hasContent: boolean
  /**
   * Libellé de la case, pour que le refus NOMME ce qui manque au lieu de le compter. Optionnel : les
   * appelants qui ne le fournissent pas gardent le message compté, plutôt qu'un nom inventé.
   */
  label?: string
}

/** État de clôture soumis à évaluation. */
export interface ClosureState {
  status: 'open' | 'red' | 'green' | 'degraded-closed'
  dod: DodItem[]
  /** Code de sortie du signal de vérification (test/build/script), s'il existe. */
  signalExitCode?: number
}

/** Résultat de l'évaluation : bloqué ou non, avec toutes les raisons cumulées. */
export interface ClosureEvaluation {
  blocked: boolean
  reasons: string[]
}

/**
 * Évalue si une clôture "done/green" est légitime.
 * - 'degraded-closed' = clôture honnête assumée : jamais bloquée, quel que soit le reste.
 * - Sinon : status open/red bloque, DoD à contenu non cochée bloque, signal rouge bloque.
 */
export function evaluateClosure(state: ClosureState): ClosureEvaluation {
  // Clôture dégradée assumée par l'humain : autorité de clôture externe déjà exercée.
  if (state.status === 'degraded-closed') {
    return { blocked: false, reasons: [] }
  }

  const reasons: string[] = []

  if (state.status === 'open') {
    reasons.push('Statut "open" : le travail n\'est pas fermé.')
  } else if (state.status === 'red') {
    // NE PAS inventer la cause. Ce message affirmait « un signal de vérification est en échec »
    // alors que le gate ne sait PAS si un signal a tourné : `red` peut venir d'un avis de juge, d'une
    // exception, ou d'un test rouge. Un gate qui nomme une cause qu'il n'a pas vérifiée envoie
    // chercher au mauvais endroit — constaté sur un run où aucun test n'avait tourné.
    reasons.push('Statut "red" : la clôture a été refusée en amont.')
  }

  const uncheckedContentItems = state.dod.filter((item) => item.hasContent && !item.checked)
  if (uncheckedContentItems.length > 0) {
    // NOMMER, pas compter. « 1 case(s) non cochée(s) » n'est pas actionnable : il faut ouvrir le
    // fichier pour savoir laquelle. Les libellés disponibles sont cités ; sans libellé, on retombe
    // sur le compte plutôt que d'inventer un nom.
    const libelles = uncheckedContentItems
      .map((item) => item.label?.trim())
      .filter((label): label is string => !!label)
    reasons.push(
      libelles.length > 0
        ? `DoD non tenue : ${libelles.map((l) => `« ${l} »`).join(', ')}.`
        : `DoD non tenue : ${uncheckedContentItems.length} case(s) à contenu réel non cochée(s).`
    )
  }

  if (state.signalExitCode !== undefined && state.signalExitCode !== 0) {
    reasons.push(`Signal rouge : code de sortie ${state.signalExitCode} != 0.`)
  }

  return { blocked: reasons.length > 0, reasons }
}
