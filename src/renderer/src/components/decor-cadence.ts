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

/**
 * LE DÉCOR DESSINÉ DANS SON PROPRE FIL (Worker, decor-avenue-hote.ts) — conv-347, 2026-10-19,
 * « l'accueil il fait pas assez lissé ». La règle du fil principal (moyenne ÷ 0,5) n'y voyait que le
 * prix d'un `postMessage`, ≈ 0 ms : la cadence restait à 30 images/s pendant que le Worker en mettait
 * 30 à 52 (reflet une image sur deux), et une image sur deux tombait pendant que la précédente était
 * encore en vol. Écarts mesurés au profil : 33 / 67 ms en alternance, de 40 à 131 ms au total.
 *
 * Pour un fil dédié, le rythme suit donc le coût RÉEL des images dans ce fil :
 *   1. le coût HAUT, pas la moyenne : le centile `CENTILE_FIL_DEDIE` des `FENETRE_FIL_DEDIE`
 *      dernières images. Une image sur deux porte le reflet : la moyenne laisserait la lourde
 *      déborder une fois sur deux. Un pic isolé (compilation, ramasse-miettes : 487 ms relevées chez
 *      l'utilisateur) reste hors du centile et ne fait pas chuter la cadence ;
 *   2. une marge : le Worker ne dessine pas plus de `PART_MAX_FIL_DEDIE` de son temps ;
 *   3. des intervalles en BATTEMENTS ENTIERS d'écran 60 Hz (33, 50, 67 ms…) : un intervalle de 41 ms
 *      tomberait tantôt sur 33, tantôt sur 50 — l'à-coup reviendrait par l'arrondi ;
 *   4. une hystérésis : le palier ne redescend que si le coût passe nettement sous le palier
 *      inférieur, sinon la cadence oscillerait entre deux paliers.
 */
export const PART_MAX_FIL_DEDIE = 0.8
/** Combien d'images récentes du fil dédié servent à estimer son coût haut. */
const FENETRE_FIL_DEDIE = 20
/** Le centile du coût retenu (0,85 sur 20 images : les trois plus lourdes sont écartées). */
const CENTILE_FIL_DEDIE = 0.85
/** Un battement d'écran 60 Hz (aussi un multiple exact des battements à 120 et 240 Hz). */
const BATTEMENT_MS = 1000 / 60
/** Le palier ne redescend que sous cette part du palier inférieur. */
const HYSTERESE = 0.85

/** Le plus petit nombre entier de battements qui couvre `ms`. */
const enBattements = (ms: number): number => Math.ceil(ms / BATTEMENT_MS - 1e-6) * BATTEMENT_MS

/** Un battement d'écran peut arriver jusqu'à cette avance (ms) et compter comme à l'heure. */
const TOLERANCE_MS = 4

/** Lissage de la mesure du coût d'une image (moyenne glissante exponentielle). */
const LISSAGE = 0.1

/**
 * Où l'image a été dessinée : `interface` = sur le fil principal (son coût est pris sur l'interface),
 * `dedie` = dans le fil du décor (Worker), le coût revenant de ce fil.
 */
export type FilDuDecor = 'interface' | 'dedie'

export interface Cadence {
  /** Faut-il dessiner au battement `maintenant` (ms, horloge de requestAnimationFrame) ? */
  doitDessiner(maintenant: number): boolean
  /** Ce qu'a coûté l'image qu'on vient de dessiner, en ms, et sur quel fil (défaut : l'interface). */
  noterCout(ms: number, fil?: FilDuDecor): void
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
  /** Fil dédié : les derniers coûts relevés, et le palier (ms, battements entiers) qu'ils imposent. */
  const coutsDedies: number[] = []
  let palier = 0
  const intervalle = (): number => Math.max(auRepos ? baseRepos : base, coutMoyen / partMax, palier)

  const noterCoutDedie = (ms: number): void => {
    coutsDedies.push(ms)
    if (coutsDedies.length > FENETRE_FIL_DEDIE) coutsDedies.shift()
    const tries = [...coutsDedies].sort((a, b) => a - b)
    const haut = tries[Math.min(tries.length - 1, Math.floor(CENTILE_FIL_DEDIE * tries.length))]
    const besoin = enBattements(haut / PART_MAX_FIL_DEDIE)
    if (besoin > palier) palier = besoin
    else if (haut / PART_MAX_FIL_DEDIE < (palier - BATTEMENT_MS) * HYSTERESE) palier = besoin
  }

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
    noterCout(ms, fil = 'interface') {
      if (!(ms >= 0)) return
      if (fil === 'dedie') return noterCoutDedie(ms)
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
