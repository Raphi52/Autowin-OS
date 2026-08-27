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

/**
 * LES CAUSES QU'UNE MACHINE PEUT LEVER — la définition UNIQUE, lue par le bouton ET par le balayage.
 *
 * Elle vivait en double : `CAUSES_REESSAYABLES` dans le coordinateur pour le bouton « Reprendre »,
 * et une condition recopiée à la main ici pour le balayage. Les deux ont dérivé, exactement comme ce
 * module l'avait redouté par écrit — « Toute divergence entre le bouton et le balayage serait un
 * piège : l'un repêcherait ce que l'autre refuse. »
 *
 * Le trou mesuré par lecture le 2026-08-27 : `base-dirty` était accepté par le bouton, réarmé par
 * AUCUNE des deux boucles automatiques. Il n'existait que derrière un clic, alors que
 * `delai-de-reprise.ts` chiffre sa fréquence à 86 refus (contre 216 pour `base-in-progress`).
 *
 * Ce qu'elles ont en commun, et qui justifie de rejouer : leur cause DISPARAÎT d'elle-même —
 * l'utilisateur committe, l'opération git se termine, la copie de preuve n'est plus comptée comme un
 * livrable. Rejouer change donc réellement l'état qui bloque. Ce n'est pas le cas d'un conflit de
 * contenu, qui reste dehors : l'arbitrer, c'est décider à la place de l'utilisateur.
 */
export const CAUSES_REESSAYABLES: ReadonlySet<string> = new Set([
  'merge-failed',
  'ignored-deliverables',
  'base-dirty',
  'base-in-progress'
])

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
 * Combien de fois le balayage retente le MEME travail avant de renoncer.
 *
 * MESURE le 2026-08-24, et c'est un defaut que j'ai introduit le matin meme : sans plafond, le
 * balayage repechait indefiniment vingt-et-un travaux qu'aucune reprise ne pouvait publier
 * (ascendance rompue, garde verifiee correcte). Chaque passage RESTAURAIT leur copie depuis la
 * branche de secours avant d'echouer -- 682 Mo de copies recreees, soit exactement les
 * « workspaces orphelins » que ce chantier devait faire disparaitre.
 *
 * Le compteur de reprise du coordinateur ne pouvait pas servir de garde-fou : `retryRunAsync` le
 * REMET A ZERO a chaque appel. Il fallait donc un compteur propre au balayage, que lui seul ecrit.
 *
 * Trois essais : de quoi absorber une cause transitoire qui met du temps a disparaitre, sans
 * s'acharner. Un travail que trois passages n'ont pas publie ne le sera pas au quatrieme ; il reste
 * repechable A LA MAIN, par le bouton, qui n'est pas concerne par ce plafond.
 */
export const ESSAIS_AUTOMATIQUES_MAX = 3

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

  // La liste ci-dessus est la SEULE source : plus de condition recopiée qui dérive du bouton.
  const bloqueMaisReprenable =
    candidat.publication === 'blocked' &&
    CAUSES_REESSAYABLES.has(candidat.attentionReason ?? '')

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
  maintenant: number,
  essaisFaits: ReadonlyMap<string, number> = new Map()
): string[] {
  return candidats
    .filter((candidat) => {
      if (!estRepechable(candidat)) return false
      // Le plafond d'abord : inutile de regarder l'horloge d'un travail auquel on a renonce.
      if ((essaisFaits.get(candidat.runId) ?? 0) >= ESSAIS_AUTOMATIQUES_MAX) return false
      const dernier = derniersEssais.get(candidat.runId)
      if (dernier === undefined) return true
      // Une horloge qui recule (changement d'heure, test) ne doit pas geler un travail pour
      // toujours : on retente plutôt que de bloquer.
      if (maintenant < dernier) return true
      return maintenant - dernier >= DELAI_ENTRE_DEUX_REPECHAGES_MS
    })
    .map((candidat) => candidat.runId)
}
