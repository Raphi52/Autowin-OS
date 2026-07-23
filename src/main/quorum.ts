// Seuil de quorum pour l'agrégation par vote (fan-out multi-modèles du juge, cf. orchestrator.ts).
// Extrait de l'ancien panel.ts (dont les agrégateurs union/quorum n'étaient jamais appelés :
// l'orchestrateur fait l'union par synthèse LLM et le comptage de quorum inline).

/**
 * Quorum par défaut pour N groupes VOTANTS : majorité simple (⌈N/2⌉, minimum 1).
 * N = nombre de modèles ayant réellement répondu (les crashés ne comptent pas).
 */
export function defaultQuorumThreshold(votingGroups: number): number {
  return Math.max(1, Math.ceil(votingGroups / 2))
}
