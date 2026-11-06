/**
 * Combiner la consigne d'un workflow avec celle de la phase.
 *
 * Deux modes, et la différence n'est pas cosmétique :
 *
 *  - `append` AJOUTE au skill installé. C'est le mode sûr : on infléchit une méthode éprouvée.
 *  - `replace` SUBSTITUE le skill. C'est le mode qui permet de comparer une méthode maison à la
 *    méthode du kit — mais il jette tout le contenu du skill, y compris ses garde-fous. Un remplacement
 *    par une consigne VIDE reviendrait à lancer la phase sans aucune instruction : on refuse, et on
 *    garde la base plutôt que d'exécuter à l'aveugle.
 */

export interface PhaseInstructionOverride {
  mode: 'append' | 'replace'
  text: string
}

export function combinePhaseInstruction(
  base: string,
  override?: PhaseInstructionOverride
): string {
  const consigne = override?.text?.trim()
  if (!consigne) return base
  if (override?.mode === 'replace') return consigne
  if (!base.trim()) return consigne
  // Séparateur explicite : sans lui la consigne du workflow se fond dans le skill et le modèle ne
  // distingue plus ce qui vient de la méthode de ce qui vient de la demande.
  return `${base}\n\n--- Consigne du workflow ---\n${consigne}`
}
