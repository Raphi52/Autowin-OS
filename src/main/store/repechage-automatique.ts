/**
 * QUI repêcher tout seul, et à quelle cadence.
 *
 * LE DÉFAUT, mesuré le 2026-08-23 puis relu le 2026-08-24 : republier un travail en attente
 * n'existait QUE comme un bouton. `worktree:retry-recovery` est un `ipcMain.handle`
 * (`src/main/index.ts`) sans aucun appelant automatique — grep sur `src/main` : zéro. Un travail
 * fini attendait donc qu'un humain devine qu'il faut ouvrir le bon panneau, et clique, une fois par
 * travail. Résultat constaté : QUATORZE travaux terminés dormant sur des branches `autowin/recovery/`.
 *
 * CE MODULE RENVERSE UNE DÉCISION DÉLIBÉRÉE, et il faut le dire plutôt que l'effacer. Le
 * coordinateur portait écrit : « La reprise demeure un GESTE DE L'UTILISATEUR, jamais automatique :
 * il décide après avoir lu le diff. On rend une porte, on ne pousse personne à travers. »
 * L'utilisateur a tranché l'inverse le 2026-08-24 — il veut que la publication se fasse seule. On
 * garde la contrepartie qui donnait sa valeur à cette prudence : le repêchage automatique ne
 * franchit QUE des portes récupérables (republier, geste réversible et sans perte), JAMAIS une
 * porte qui détruit ou qui arbitre un conflit de contenu.
 *
 * Le tri vit ici, séparé de la minuterie, parce que c'est lui qui est risqué : repêcher ce qu'il ne
 * fallait pas est bien pire que repêcher trop tard.
 */

/** L'état d'un run, réduit aux seuls champs qui décident du repêchage. */
export interface CandidatAuRepechage {
  runId: string
  publication?: string
  attentionReason?: string
  verdict?: string
}

/**
 * Combien attendre avant de retenter le MÊME travail.
 *
 * Un travail que le balayage vient de repousser ne doit pas repartir au tour suivant : il
 * échouerait à l'identique et le journal se remplirait d'un même refus. Dix minutes laissent le
 * temps à la cause réelle (un arbre occupé, une base qui bouge) de disparaître.
 */
export const DELAI_ENTRE_DEUX_REPECHAGES_MS = 10 * 60_000

/** L'intervalle entre deux balayages. Large : ce n'est pas une course, c'est un filet. */
export const INTERVALLE_BALAYAGE_MS = 5 * 60_000

/**
 * Ce travail peut-il être republié sans rien décider à la place de l'utilisateur ?
 *
 * Le prédicat REPRODUIT celui de `retryRun` / `retryRunAsync` — il était déjà écrit deux fois là-bas,
 * et l'automatisation en aurait fait une troisième copie. Toute divergence entre le bouton et le
 * balayage serait un piège : l'un repêcherait ce que l'autre refuse.
 *
 * `unknown` veut dire « JAMAIS JUGÉ », pas « jugé mauvais ». Onze des quatorze travaux bloqués sont
 * des `command-edit`, des éditions demandées dans le chat qui ne passent jamais devant un juge :
 * exiger le vert les condamnait par construction. Seul `red` interdit — celui-là a été jugé, et
 * négativement.
 */
export function estRepechable(candidat: CandidatAuRepechage): boolean {
  if (candidat.verdict === 'red') return false

  // Un refus pour fichiers ignorés se répare hors de l'app (déplacer la preuve) ; il reste
  // réessayable, exactement comme `merge-failed`.
  const bloqueMaisReprenable =
    candidat.publication === 'blocked' &&
    (candidat.attentionReason === 'merge-failed' ||
      candidat.attentionReason === 'ignored-deliverables')

  const repriseEpuisee =
    ['pending', 'cleanup-pending'].includes(candidat.publication ?? '') &&
    candidat.attentionReason === 'retry-exhausted'

  return bloqueMaisReprenable || repriseEpuisee
}

/**
 * Le lot à repêcher lors de ce balayage.
 *
 * `derniersEssais` porte, par run, l'instant du dernier repêchage AUTOMATIQUE. Un run absent de
 * cette table n'a jamais été tenté par le balayage : il part au premier tour.
 */
export function travauxARepecher(
  candidats: readonly CandidatAuRepechage[],
  derniersEssais: ReadonlyMap<string, number>,
  maintenant: number
): string[] {
  return candidats
    .filter((candidat) => {
      if (!estRepechable(candidat)) return false
      const dernier = derniersEssais.get(candidat.runId)
      if (dernier === undefined) return true
      // Une horloge qui recule (changement d'heure, test) ne doit pas geler un travail pour
      // toujours : on retente plutôt que de bloquer.
      if (maintenant < dernier) return true
      return maintenant - dernier >= DELAI_ENTRE_DEUX_REPECHAGES_MS
    })
    .map((candidat) => candidat.runId)
}
