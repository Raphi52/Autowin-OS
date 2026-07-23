/**
 * Active verify-replay EN PROD via l'env `AUTOWIN_VERIFY_REPLAY` (opt-in explicite) :
 *   absent | '' | 'off'  → dormant (aucun re-jeu ; comportement historique)
 *   'auto'               → résout la commande de test déclarée du workspace (package.json)
 *   '<commande>'         → rejoue CETTE commande exacte
 * Off par défaut à dessein : forcer `npm test` sur CHAQUE gate de mutation est coûteux et grossier
 * (bloque sur un test cassé sans rapport) → l'activation est une décision délibérée de l'opérateur.
 */
export function resolveVerifyReplayConfig(
  env: string | undefined = process.env.AUTOWIN_VERIFY_REPLAY
): { verifyCmd?: string; autoVerify?: boolean } {
  const v = (env ?? '').trim()
  if (!v || v.toLowerCase() === 'off') return {}
  if (v.toLowerCase() === 'auto') return { autoVerify: true }
  return { verifyCmd: v }
}
