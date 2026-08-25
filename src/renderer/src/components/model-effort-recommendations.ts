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
  // « Sol » n'existe PAS dans le catalogue du compte Codex connecte (releve live le 2026-08-25 :
  // terra, luna, gpt-5.5, gpt-5.4-mini). La reco « codex xhigh » vise donc le modele phare
  // REELLEMENT expose (`gpt-5.6-terra`, isDefault). La ligne `sol` reste pour le jour ou le
  // fournisseur l'expose : une reco ne s'affiche que si le modele est dans le catalogue.
  { provider: 'codex', model: /^gpt-5\.6-terra$/, effort: 'xhigh' },
  { provider: 'codex', model: /^gpt-5\.6-sol$/, effort: 'xhigh' }
]

export function recommendedEffort(provider: string, model: string): string | undefined {
  const id = model.trim().toLowerCase()
  return RECOMMENDATIONS.find((entry) => entry.provider === provider && entry.model.test(id))
    ?.effort
}
