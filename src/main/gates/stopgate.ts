// Reproduction TS pure, model-agnostic, du "stop-gate" du kit autowin.
// Fonction pure évaluant si une clôture "done/green" est légitime.

/** Une case de Definition-of-Done. */
export interface DodItem {
  /** La case est cochée. */
  checked: boolean
  /** La case a un contenu réel (une DoD vide/non applicable ne bloque jamais). */
  hasContent: boolean
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
    reasons.push('Statut "red" : un signal de vérification est en échec.')
  }

  const uncheckedContentItems = state.dod.filter((item) => item.hasContent && !item.checked)
  if (uncheckedContentItems.length > 0) {
    reasons.push(
      `DoD non tenue : ${uncheckedContentItems.length} case(s) à contenu réel non cochée(s).`
    )
  }

  if (state.signalExitCode !== undefined && state.signalExitCode !== 0) {
    reasons.push(`Signal rouge : code de sortie ${state.signalExitCode} != 0.`)
  }

  return { blocked: reasons.length > 0, reasons }
}

/**
 * Jette une Error détaillée si la clôture n'est pas légitime.
 * Autorité de clôture : ne jamais déclarer "done/green" sans artefact vérifié.
 */
export function assertClosable(state: ClosureState): void {
  const evaluation = evaluateClosure(state)
  if (evaluation.blocked) {
    throw new Error(
      `Clôture bloquée (${evaluation.reasons.length} raison(s)) :\n` +
        evaluation.reasons.map((r) => `- ${r}`).join('\n')
    )
  }
}
