/**
 * Vocabulaire de la MISE À JOUR, partagé par le main, le preload et le renderer.
 *
 * Vit dans `shared/` parce qu'il traverse les trois couches : le main l'applique, le preload le
 * transporte, le renderer l'affiche et le choisit. Le recopier de part et d'autre est précisément le
 * défaut corrigé le même jour sur les évènements du pilote — trois listes écrites à la main avaient
 * dérivé sans que rien ne le signale, la frontière IPC ne faisant qu'un cast non vérifié.
 */

/**
 * Manières d'intégrer `origin/main`.
 *
 * - `fast-forward` : sur `main`, avancer sans rien fabriquer. Le geste évident, donc le défaut.
 * - `merge`        : depuis une branche, fusionner `origin/main` en gardant son propre historique.
 * - `rebase`       : depuis une branche, rejouer son travail par-dessus `origin/main` (historique linéaire).
 * - `switch-main`  : basculer sur `main` et l'avancer. Le travail de la branche RESTE sur la branche.
 */
export type UpdateStrategy = 'fast-forward' | 'merge' | 'rebase' | 'switch-main'

/** Libellés destinés à l'utilisateur — un bouton doit DIRE ce qu'il fait avant d'être cliqué. */
export const UPDATE_STRATEGY_LABELS: Record<UpdateStrategy, string> = {
  'fast-forward': 'Mettre à jour',
  merge: 'Fusionner origin/main',
  rebase: 'Rebaser sur origin/main',
  'switch-main': 'Basculer sur main'
}

/** Ce que chaque stratégie fait vraiment, pour l'infobulle. */
export const UPDATE_STRATEGY_HINTS: Record<UpdateStrategy, string> = {
  'fast-forward': 'Avance ta branche main sur origin/main, sans commit de fusion.',
  merge: 'Fusionne origin/main dans ta branche courante en conservant ton historique.',
  rebase: 'Rejoue tes commits par-dessus origin/main — historique linéaire, hashes réécrits.',
  'switch-main': 'Bascule sur main et l’avance. Ton travail reste intact sur ta branche.'
}

/**
 * Stratégies proposées selon la branche sortie. Sur `main` avancer est sans ambiguïté ; ailleurs les
 * trois voies sont légitimes et le choix appartient à l'utilisateur.
 */
export function strategiesFor(branch: string | undefined): UpdateStrategy[] {
  return branch === 'main' ? ['fast-forward'] : ['merge', 'rebase', 'switch-main']
}
