/**
 * LA CADENCE DU DÉCOR DE FOND : quand dessiner l'image suivante.
 *
 * DÉFAUT CORRIGÉ (2026-10-18). La boucle sautait toute image arrivée moins de 25 ms après
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
 *
 * DÉFAUT CORRIGÉ (2026-11-06, « chaque zoom in and out est laggy »). Les points 1 et 2
 * supposaient un écran à 60 Hz. Celui de l'utilisateur, vu par le Bureau à distance, bat toutes les
 * 15,1 ms (66 Hz, mesuré par requestAnimationFrame dans l'app ouverte) : la phase de 16,7 ms prenait
 * du retard et sautait un battement sur dix — un trou de 30 ms six fois par seconde, invisible quand
 * seuls les tanukis marchent, net quand tout le décor glisse pendant le zoom. Même accordéon à 75,
 * 90, 100, 144 ou 165 Hz (écarts de 1 puis 2, ou 2 puis 3 battements). Désormais l'intervalle est un
 * nombre ENTIER de battements RÉELS de l'écran, appris des appels successifs : le plus proche de la
 * cadence visée, arrondi au-dessus pour le plafond de charge. Les images tombent à écart constant.
 */

/** La cadence visée, en images par seconde. */
export const IMAGES_PAR_SECONDE_DECOR = 60 // plafond 30 levé le 2026-11-04 (« ca pas smooth »)

/**
 * LA CADENCE AU REPOS (2026-10-19) : fenêtre sans le focus, ou aucun geste depuis
 * `REPOS_APRES_MS`. Mesuré au banc de décor (retiré) : 34 ms de calcul par image dans
 * le fil du décor — à 30 images/s, les trois quarts d'un cœur, pour un Accueil qui reste ouvert des
 * heures sans qu'on y touche. Au repos, la moitié. Le premier geste ramène la cadence visée.
 */
export const IMAGES_PAR_SECONDE_REPOS = 60 // repos à 15 levé ; fenêtre cachée = aucune image (rAF)

/** Sans geste (souris, clavier, molette) depuis ce délai, en ms, le décor passe au repos. */
export const REPOS_APRES_MS = 90_000

/** Le décor est-il au repos ? `maintenant` et `dernierGeste` sur la même horloge, en ms. */
export function estAuRepos(maintenant: number, dernierGeste: number, aLeFocus: boolean): boolean {
  return !aLeFocus || maintenant - dernierGeste >= REPOS_APRES_MS
}

/** Part maximale du fil principal que le décor peut occuper en moyenne. */
export const PART_MAX_DU_FIL = 0.5

/** Un battement d'écran 60 Hz (aussi un multiple exact des battements à 120 et 240 Hz). */
const BATTEMENT_MS = 1000 / 60
/** Combien d'écarts récents entre deux appels servent à apprendre la période de l'écran. */
const FENETRE_PERIODE = 15
/** Hors de ces bornes (ms), un écart n'est pas un battement : fenêtre cachée, veille, horloge figée. */
const PERIODE_MIN_MS = 3
const PERIODE_MAX_MS = 70

/** Lissage de la mesure du coût d'une image (moyenne glissante exponentielle). */
const LISSAGE = 0.1

export interface Cadence {
  /** Faut-il dessiner au battement `maintenant` (ms, horloge de requestAnimationFrame) ? */
  doitDessiner(maintenant: number): boolean
  /** Ce qu'a coûté au fil de l'interface l'image qu'on vient de dessiner, en ms. */
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
  let coutMoyen = 0
  /** Le battement de la dernière image dessinée, et celui du dernier appel (ms). */
  let dernierDessin: number | null = null
  let dernierAppel: number | null = null
  /** Les derniers écarts entre deux appels : la boucle appelle à chaque battement de l'écran. */
  const ecartsAppels: number[] = []
  /**
   * La période réelle de l'écran : la médiane BASSE des derniers écarts. Un battement que le fil
   * occupé a laissé passer compte double ; tant qu'il n'est pas majoritaire, il ne fausse rien.
   */
  const periode = (): number => {
    if (ecartsAppels.length === 0) return BATTEMENT_MS
    const tries = [...ecartsAppels].sort((a, b) => a - b)
    return tries[Math.floor((tries.length - 1) / 2)]
  }

  const baseRepos = 1000 / Math.min(imagesParSeconde, IMAGES_PAR_SECONDE_REPOS)
  let auRepos = false
  const intervalle = (): number => Math.max(auRepos ? baseRepos : base, coutMoyen / partMax)

  const battement = (maintenant: number): void => {
    if (dernierAppel !== null) {
      const ecart = maintenant - dernierAppel
      if (ecart >= PERIODE_MIN_MS && ecart <= PERIODE_MAX_MS) {
        ecartsAppels.push(ecart)
        if (ecartsAppels.length > FENETRE_PERIODE) ecartsAppels.shift()
      }
    }
    dernierAppel = maintenant
  }

  return {
    doitDessiner(maintenant) {
      battement(maintenant)
      if (dernierDessin === null) {
        dernierDessin = maintenant
        return true
      }
      // Un nombre ENTIER de battements entre deux images : le plus proche de la cadence
      // visée (égalité : le plus fluide), au moins ce qu'exige le plafond de charge. Le seuil à un
      // demi-battement absorbe le tremblement de l'horloge ; après une longue absence, l'image part
      // aussitôt, sans rattrapage.
      const p = periode()
      const vise = Math.max(1, Math.round((auRepos ? baseRepos : base) / p - 1e-6))
      const charge = Math.ceil(coutMoyen / partMax / p - 1e-6)
      const n = Math.max(vise, charge)
      if (maintenant - dernierDessin < (n - 0.5) * p) return false
      dernierDessin = maintenant
      return true
    },
    noterCout(ms) {
      if (!(ms >= 0)) return
      coutMoyen = coutMoyen === 0 ? ms : coutMoyen + (ms - coutMoyen) * LISSAGE
    },
    intervalle,
    repos(r) {
      // Le nombre de battements est recalculé à chaque appel : au réveil, l'image suivante
      // n'attend pas la fin d'un intervalle de repos.
      auRepos = r
    }
  }
}
