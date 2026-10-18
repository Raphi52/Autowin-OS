/**
 * LA CADENCE DU DÉCOR DE FOND : quand dessiner l'image suivante.
 *
 * DÉFAUT CORRIGÉ (2026-10-18, conv-323). La boucle sautait toute image arrivée moins de 25 ms après
 * la précédente, « ~40 images/s » selon son commentaire. Or `requestAnimationFrame` ne tombe que sur
 * les battements de l'écran : à 60 Hz (16,7 ms) la première image acceptée est la deuxième (33,3 ms),
 * soit 30 images/s ; à 120 Hz, 25,0 ms mesurés à 24,99 près en faisaient sauter une sur trois de
 * plus ; à 144 Hz, 36 images/s. La cadence réelle dépendait donc de l'écran, et aucune n'était 40.
 *
 * CE QUI EST FIXÉ ICI :
 *   1. UNE cadence visée, 30 images/s, la même sur tous les écrans — celle que l'utilisateur voit
 *      déjà à 60 Hz. La phase avance d'un intervalle à la fois : pas de dérive, pas d'accordéon ;
 *   2. une TOLÉRANCE au battement : un battement en avance d'une fraction de milliseconde compte comme
 *      à l'heure (sinon un écran 60 Hz sauterait une image sur trois) ;
 *   3. un PLAFOND DE CHARGE : une image qui coûte cher au fil principal espace les suivantes, pour
 *      qu'il reste au moins la moitié du fil à l'interface. Mesuré le 2026-10-18 : le fond avenue
 *      coûtait 36 à 45 ms par image au fil principal — à 30 images/s, plus que le fil tout entier.
 */

/** La cadence visée, en images par seconde. */
export const IMAGES_PAR_SECONDE_DECOR = 30

/**
 * LA CADENCE AU REPOS (conv-337, 2026-10-19) : fenêtre sans le focus, ou aucun geste depuis
 * `REPOS_APRES_MS`. Mesuré au banc (scripts/banc-decor-budget.mjs) : 34 ms de calcul par image dans
 * le fil du décor — à 30 images/s, les trois quarts d'un cœur, pour un Accueil qui reste ouvert des
 * heures sans qu'on y touche. Au repos, la moitié. Le premier geste ramène la cadence visée.
 */
export const IMAGES_PAR_SECONDE_REPOS = 15

/** Sans geste (souris, clavier, molette) depuis ce délai, en ms, le décor passe au repos. */
export const REPOS_APRES_MS = 90_000

/** Le décor est-il au repos ? `maintenant` et `dernierGeste` sur la même horloge, en ms. */
export function estAuRepos(maintenant: number, dernierGeste: number, aLeFocus: boolean): boolean {
  return !aLeFocus || maintenant - dernierGeste >= REPOS_APRES_MS
}

/** Part maximale du fil principal que le décor peut occuper en moyenne. */
export const PART_MAX_DU_FIL = 0.5

/** Un battement d'écran peut arriver jusqu'à cette avance (ms) et compter comme à l'heure. */
const TOLERANCE_MS = 4

/** Lissage de la mesure du coût d'une image (moyenne glissante exponentielle). */
const LISSAGE = 0.1

export interface Cadence {
  /** Faut-il dessiner au battement `maintenant` (ms, horloge de requestAnimationFrame) ? */
  doitDessiner(maintenant: number): boolean
  /** Ce qu'a coûté l'image qu'on vient de dessiner, en ms de fil principal. */
  noterCout(ms: number): void
  /** L'intervalle courant entre deux images, en ms. */
  intervalle(): number
  /** Au repos, la cadence descend à `IMAGES_PAR_SECONDE_REPOS` ; hors repos, elle revient. */
  repos(auRepos: boolean): void
}

export function creerCadence(
  imagesParSeconde = IMAGES_PAR_SECONDE_DECOR,
  partMax = PART_MAX_DU_FIL
): Cadence {
  const base = 1000 / imagesParSeconde
  let prochaine: number | null = null
  let coutMoyen = 0

  const baseRepos = 1000 / Math.min(imagesParSeconde, IMAGES_PAR_SECONDE_REPOS)
  let auRepos = false
  const intervalle = (): number => Math.max(auRepos ? baseRepos : base, coutMoyen / partMax)

  return {
    doitDessiner(maintenant) {
      if (prochaine === null) {
        prochaine = maintenant + intervalle()
        return true
      }
      if (maintenant < prochaine - TOLERANCE_MS) return false
      // La phase avance d'un intervalle ; après une longue absence (fenêtre cachée, onglet quitté)
      // elle repart de maintenant au lieu de rattraper les images manquées d'un coup.
      prochaine += intervalle()
      if (prochaine < maintenant) prochaine = maintenant + intervalle()
      return true
    },
    noterCout(ms) {
      if (!(ms >= 0)) return
      coutMoyen = coutMoyen === 0 ? ms : coutMoyen + (ms - coutMoyen) * LISSAGE
    },
    intervalle,
    repos(r) {
      if (r === auRepos) return
      auRepos = r
      // Au réveil, l'image suivante ne doit pas attendre la fin d'un intervalle de repos.
      if (!r && prochaine !== null) prochaine = Math.min(prochaine, prochaine - baseRepos + base)
    }
  }
}
