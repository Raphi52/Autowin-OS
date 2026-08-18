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

/**
 * Le refus qu'un nouveau passage de BUILD ne peut pas lever.
 *
 * Il ne parle pas du livrable : le RUN est rouge en amont, et rien de ce que build produira ne
 * changera ce statut. Toutes les autres raisons (DoD non tenue, signal rouge) sont au contraire
 * exactement ce qu'une réparation adresse.
 */
export const CLOSURE_UPSTREAM_REFUSAL = 'Statut "red" : la clôture a été refusée en amont.'

/**
 * Faut-il ARRÊTER la boucle de réparation plutôt que de payer un passage de plus ?
 *
 * Mesuré dans `conv-1242` le 2026-08-15 : trois passages `build` (73 s, 60 s, puis un troisième),
 * chacun suivi du MÊME refus mot pour mot — « Statut "red" : la clôture a été refusée en amont ».
 * Plus de deux minutes de calcul brûlées, puis abandon. Chaque tour de boucle rejoue un build
 * complet, toutes les phases post-build et un panel de juge : ce n'est pas un retry bon marché.
 *
 * La règle tient les DEUX intentions, et c'est tout l'enjeu de sa forme :
 * - un motif identique ne suffit PAS à conclure (une dépendance ou une preuve peut être devenue
 *   disponible entre deux passages) — donc on ne coupe pas sur la seule répétition ;
 * - un refus dont AUCUNE raison n'est réparable par build ne peut pas évoluer par un rejeu — donc
 *   le répéter est une dépense sans contrepartie.
 *
 * On coupe à l'intersection : refus IDENTIQUE **et** entièrement hors de portée de build. Un refus
 * mixte (amont + DoD non cochée) reste rejoué : la DoD, elle, est réparable.
 */
export function doitArreterLaReparation(
  motifsCourants: readonly string[],
  motifsPrecedents: readonly string[]
): boolean {
  if (motifsCourants.length === 0) return false
  const identique =
    motifsCourants.length === motifsPrecedents.length &&
    motifsCourants.every((motif, index) => motif === motifsPrecedents[index])
  if (!identique) return false
  return motifsCourants.every((motif) => motif === CLOSURE_UPSTREAM_REFUSAL)
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
    reasons.push(CLOSURE_UPSTREAM_REFUSAL)
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
