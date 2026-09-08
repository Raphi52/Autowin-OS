/**
 * LE GEL QUE PERSONNE NE SIGNALE — quand la fenetre meurt SANS interaction.
 *
 * Mesure du 2026-09-08 (conv-353) : une fenetre qui ne repondait plus du tout (meme pas a une
 * evaluation triviale) n'a produit AUCUNE ligne `fenetre-injoignable`, donc aucune reanimation.
 * Raison : Electron n'emet `unresponsive` que lorsque la fenetre ne repond plus aux EVENEMENTS
 * D'ENTREE. Sans souris ni clavier — fenetre en arriere-plan, ou machine qui travaille seule — le
 * gel est parfaitement invisible.
 *
 * On ajoute donc un BATTEMENT actif : le processus principal demande regulierement un echo a la
 * fenetre. Plusieurs echos manques d'affilee etablissent le gel, sans dependre de personne.
 */

export interface EtatBattement {
  /** Echos consecutifs restes sans reponse. */
  echosManques: number
  /** Intervalle entre deux demandes d'echo, en millisecondes. */
  intervalleMs: number
}

/** Duree de silence au-dela de laquelle on declare la fenetre gelee. */
export const SILENCE_AVANT_GEL_MS = 15_000

/** Motif journalise quand c'est le battement — et non Electron — qui a vu le gel. */
export const OPERATION_GEL_PAR_BATTEMENT = 'renderer:silence-au-battement'

/**
 * La fenetre est-elle consideree gelee ? On exige une DUREE de silence, pas un nombre d'echos :
 * ainsi le verdict ne change pas si l'on modifie la cadence des demandes.
 */
export function fenetreSilencieuse(
  etat: EtatBattement,
  silenceAvantGelMs: number = SILENCE_AVANT_GEL_MS
): boolean {
  return etat.echosManques * etat.intervalleMs >= silenceAvantGelMs
}

/** Le minimum vital d'une fenetre pour ce battement — pas besoin d'un vrai Electron en test. */
export interface FenetreBattante {
  webContents?: {
    executeJavaScript?(code: string): Promise<unknown>
    reloadIgnoringCache?(): void
    /** Dernier recours : tue le processus d'affichage, Electron en repart un neuf. */
    forcefullyCrashRenderer?(): void
  }
}

/** Motif journalise quand le rechargement n'a pas suffi et qu'on tue l'affichage. */
export const OPERATION_ESCALADE = 'renderer:affichage-force-a-repartir'

/** Silence supplementaire tolere APRES un rechargement reste sans effet. */
export const SILENCE_AVANT_ESCALADE_MS = 30_000

/**
 * Branche le battement et rend la fonction qui l'arrete.
 *
 * A chaque intervalle, on demande un echo. S'il tarde plus que l'intervalle, il compte pour
 * manque. Passe le seuil de SILENCE, on journalise une fois puis on recharge la fenetre — meme
 * geste que la reanimation sur `unresponsive`, mais declenche sans aucune interaction humaine.
 */
export function surveillerParBattement(
  fenetre: FenetreBattante,
  journaliser: (operation: string, silenceMs: number) => void,
  options: {
    intervalleMs?: number
    silenceAvantGelMs?: number
    silenceAvantEscaladeMs?: number
    planifier?: (action: () => void, delaiMs: number) => unknown
    annuler?: (jeton: unknown) => void
  } = {}
): () => void {
  const intervalleMs = options.intervalleMs ?? 5_000
  const silenceAvantGelMs = options.silenceAvantGelMs ?? SILENCE_AVANT_GEL_MS
  const planifier = options.planifier ?? setInterval
  const annuler = options.annuler ?? ((jeton) => clearInterval(jeton as never))
  const silenceAvantEscaladeMs = options.silenceAvantEscaladeMs ?? SILENCE_AVANT_ESCALADE_MS
  let echosManques = 0
  let dejaSignale = false
  let silenceAuRechargement: number | undefined
  let dejaEscalade = false

  const jeton = planifier(() => {
    let repondu = false
    void fenetre.webContents
      ?.executeJavaScript?.('1')
      .then(() => {
        repondu = true
        echosManques = 0
        dejaSignale = false
        dejaEscalade = false
        silenceAuRechargement = undefined
      })
      .catch(() => {})
    // L'echo est juge au tour SUIVANT : s'il n'est pas revenu d'ici la, il est manque.
    setTimeout(() => {
      if (repondu) return
      echosManques += 1
      const silenceMs = echosManques * intervalleMs
      if (!fenetreSilencieuse({ echosManques, intervalleMs }, silenceAvantGelMs)) return
      if (!dejaSignale) {
        dejaSignale = true
        dejaEscalade = false
        silenceAuRechargement = silenceMs
        journaliser(OPERATION_GEL_PAR_BATTEMENT, silenceMs)
        fenetre.webContents?.reloadIgnoringCache?.()
        return
      }
      /*
       * ESCALADE — mesure du 2026-09-08 17:52 : le rechargement a bien ete demande (ligne
       * `silence-au-battement`, 15 000 ms) et la fenetre est restee MORTE deux minutes de plus.
       * C'est attendu : `reloadIgnoringCache` est un message que le processus d'affichage doit
       * TRAITER — un blocage total ne le traite jamais. Le seul geste qui aboutit alors est de tuer
       * ce processus : Electron en repart un neuf, et l'application, elle, survit.
       */
      if (silenceAuRechargement === undefined || dejaEscalade) return
      if (silenceMs - silenceAuRechargement < silenceAvantEscaladeMs) return
      // Une seule fois par episode : si tuer l'affichage n'a pas suffi, recommencer n'aiderait pas
      // et transformerait la reparation en boucle de crashs.
      dejaEscalade = true
      journaliser(OPERATION_ESCALADE, silenceMs)
      fenetre.webContents?.forcefullyCrashRenderer?.()
    }, Math.max(1, intervalleMs - 100))
  }, intervalleMs)

  return () => annuler(jeton)
}
