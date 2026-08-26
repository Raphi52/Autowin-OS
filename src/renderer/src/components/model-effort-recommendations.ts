/**
 * Efforts RECOMMANDÉS (pastille verte dans la matrice MODEL × EFFORT).
 *
 * Table volontairement NOMMÉE, modèle par modèle : une règle par famille (« opus », « gpt-5.6 »)
 * poserait la pastille sur des voisins qui n'ont pas le même profil coût/qualité.
 * Une recommandation ne s'affiche que si le modèle ET le cran existent dans le catalogue LIVE :
 * rien n'est inventé ici, la table ne fait que décorer ce que le catalogue expose déjà.
 */
const RECOMMENDATIONS: { provider: string; model: RegExp; effort: string }[] = [
  { provider: 'claude', model: /^(claude-)?opus-5$/, effort: 'low' },
  // Cote ChatGPT la pastille va sur SOL et sur lui seul (demande utilisateur du 2026-08-25).
  // `gpt-5.6-sol` est ajoute au catalogue codex par `withCodexNamedSupplements` quand le listing
  // live ne l'expose pas encore ; terra n'est plus recommande.
  { provider: 'codex', model: /^gpt-5\.6-sol$/, effort: 'xhigh' }
]

export function recommendedEffort(provider: string, model: string): string | undefined {
  const id = model.trim().toLowerCase()
  return RECOMMENDATIONS.find((entry) => entry.provider === provider && entry.model.test(id))
    ?.effort
}
