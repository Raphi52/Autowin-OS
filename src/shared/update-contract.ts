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

/** Action contextuelle du bouton quand une fusion Git est déjà ouverte. */
export type UpdateAction = UpdateStrategy | 'abort-conflict'

/**
 * Un commit qui ARRIVERA avec la mise à jour : qui l'a poussé, quand, et ce qu'il touche.
 *
 * Existe pour que « Fusionner » ne soit plus un clic à l'aveugle : le bouton annonçait « +1 » sans
 * dire de qui ni de quoi, et l'utilisateur devait ouvrir un terminal pour décider (demande du
 * 2026-09-25, conv-858).
 */
export interface IncomingCommit {
  hash: string
  author: string
  /** Date d'auteur, ISO 8601. */
  date: string
  subject: string
  /** Fichiers touchés, TRONQUÉS (cf. `fileCount` pour le total). */
  files: string[]
  /** Nombre total de fichiers touchés, même quand `files` est tronqué. */
  fileCount: number
}

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
 *
 * `diverged` = `main` porte des commits que `origin/main` n'a pas. Avancer devient alors
 * STRUCTURELLEMENT impossible (`--ff-only` refuse), et ne proposer que `fast-forward` laissait
 * l'utilisateur SANS AUCUNE issue dans l'interface : la mise à jour échouait, à chaque clic, avec un
 * message qui lui demandait de faire à la main ce que le bouton pouvait faire. On offre donc les deux
 * voies réelles, rebase d'abord (historique linéaire, c'est le cas courant : des commits locaux pas
 * encore poussés).
 *
 * `arbreSale` = des fichiers sont modifiés en local. `git rebase` refuse ALORS À COUP SÛR (« cannot
 * rebase: You have unstaged changes »), même si les commits entrants ne touchent aucun de ces
 * fichiers — seule la fusion ne refuse que sur un fichier touché des deux côtés. Le rebase n'est donc
 * plus proposé (conv-454, conv-604).
 */
export function strategiesFor(
  branch: string | undefined,
  diverged = false,
  arbreSale = false
): UpdateStrategy[] {
  const choix: UpdateStrategy[] =
    branch !== 'main'
      ? ['merge', 'rebase', 'switch-main']
      : diverged
        ? ['rebase', 'merge']
        : ['fast-forward']
  return arbreSale ? choix.filter((s) => s !== 'rebase') : choix
}
