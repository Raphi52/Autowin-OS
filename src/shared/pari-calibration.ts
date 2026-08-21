/**
 * Fermeture de la boucle « ce que l'agent a annoncé » ↔ « ce qui s'est réellement passé ».
 *
 * Autowin demande DÉJÀ au modèle de déclarer ce dont il n'est pas sûr : la phase de cadrage produit
 * une section `## Confiance`, et `cadrage-confiance.ts` en extrait les affirmations non vérifiées pour
 * les remettre au juge. Mais personne ne comptait ensuite. Une déclaration qu'on ne rapproche jamais
 * du résultat ne coûte rien à celui qui la fait — d'où des agents qui n'ont, structurellement, rien à
 * perdre. Ce module n'ajoute aucune cérémonie : il mesure la déclaration qui existe.
 *
 * DEUX chiffres, jamais un seul. La calibration (Brier) dit si un 0,8 arrive vraiment huit fois sur
 * dix ; la discrimination dit si le chiffre SÉPARE les réussites des échecs. La première seule
 * récompenserait le hedging : annoncer 0,5 partout donne un Brier de 0,25, médiocre mais confortable,
 * pour une déclaration qui n'informe de rien. La discrimination met ce silence à zéro, et c'est
 * exactement ce que vérifient les contrôles négatifs de la suite de tests.
 *
 * Module PUR : aucune I/O, aucune dépendance au ledger. C'est ce qui permet de le falsifier en
 * quelques secondes sur des séries synthétiques, alors que la vraie question — « nos agents sont-ils
 * calibrés ? » — demande des dizaines de phases jugées, donc des semaines d'usage.
 */

/** Le pari tel que déclaré AVANT l'exécution de la phase, donc non révisable après coup. */
export interface PariPhase {
  runId: string
  phase: string
  /** Probabilité annoncée de réussite de la phase, dans [0, 1]. */
  confiance: number
  /** L'observation qui réfuterait le pari — un pari sans réfutateur n'est qu'une humeur. */
  refutateur: string
  emisA: string
}

/** L'issue observée de la phase. `jugee` fait foi : sans verdict, il n'y a rien à apparier. */
export interface IssuePhase {
  runId: string
  phase: string
  reussie: boolean
  jugee: boolean
}

export interface AppariementPari {
  runId: string
  phase: string
  confiance: number
  reussie: boolean
}

export interface ResultatAppariement {
  appariements: AppariementPari[]
  /** Paris dont la phase n'a jamais rendu d'issue (run interrompu, phase abandonnée). */
  parisSansIssue: string[]
  /** Issues sans pari : « pas de pari », JAMAIS compté comme un pari raté. */
  issuesSansPari: string[]
  /** Phases écartées faute de verdict : une phase non jugée n'a pas d'issue falsifiable. */
  issuesNonJugees: string[]
  /** Paris rejetés parce que la confiance sort de [0, 1] — une valeur folle polluerait la mesure. */
  parisInvalides: string[]
}

export interface MesureCalibration {
  n: number
  /**
   * Score de Brier : moyenne des (confiance − issue)². 0 = parfait, 0,25 = le prudent qui dit 0,5
   * partout, 1 = systématiquement sûr et faux. `null` quand il n'y a rien à mesurer.
   */
  calibration: number | null
  /**
   * D de Somers (2·AUC − 1) : +1 = sépare parfaitement, 0 = n'informe pas, −1 = signal à contresens.
   * `null` quand une seule classe est observée — l'ordre est alors indéfini, et inventer un chiffre
   * serait pire que de n'en donner aucun.
   */
  discrimination: number | null
  motifIndisponible: string | null
  /** Sous ce seuil, les deux chiffres sont du bruit d'échantillonnage — à ne pas lire comme un verdict. */
  echantillonSuffisant: boolean
}

/** En dessous, la mesure existe mais ne conclut rien : ordre de grandeur du critère d'abandon. */
export const SEUIL_ECHANTILLON = 20

const cle = (runId: string, phase: string): string => `${runId}/${phase}`

const confianceValide = (valeur: number): boolean =>
  Number.isFinite(valeur) && valeur >= 0 && valeur <= 1

/**
 * Apparie chaque pari à l'issue de SA phase, dans SON run. Tout ce qui ne s'apparie pas est rendu
 * nommément plutôt que silencieusement jeté : un écart inexpliqué dans les comptes est le premier
 * symptôme d'une mesure qu'on ne peut plus croire.
 */
export function apparierParisEtIssues(
  paris: readonly PariPhase[],
  issues: readonly IssuePhase[]
): ResultatAppariement {
  const appariements: AppariementPari[] = []
  const parisSansIssue: string[] = []
  const issuesSansPari: string[] = []
  const issuesNonJugees: string[] = []
  const parisInvalides: string[] = []

  const parIssue = new Map<string, IssuePhase>()
  for (const issue of issues) {
    if (!issue.jugee) {
      issuesNonJugees.push(issue.phase)
      continue
    }
    parIssue.set(cle(issue.runId, issue.phase), issue)
  }

  const parisRetenus = new Set<string>()
  for (const pari of paris) {
    const identite = cle(pari.runId, pari.phase)
    if (!confianceValide(pari.confiance)) {
      parisInvalides.push(identite)
      continue
    }
    const issue = parIssue.get(identite)
    if (!issue) {
      parisSansIssue.push(identite)
      continue
    }
    parisRetenus.add(identite)
    appariements.push({
      runId: pari.runId,
      phase: pari.phase,
      confiance: pari.confiance,
      reussie: issue.reussie
    })
  }

  for (const [identite, issue] of parIssue) {
    if (!parisRetenus.has(identite)) issuesSansPari.push(issue.phase)
  }

  return { appariements, parisSansIssue, issuesSansPari, issuesNonJugees, parisInvalides }
}

/**
 * Aire sous la courbe ROC calculée par comptage de paires — les ex æquo comptent pour une demi-paire,
 * ce qui est précisément ce qui envoie le parieur prudent (0,5 partout) à zéro de discrimination.
 */
function aireSousCourbe(reussites: readonly number[], echecs: readonly number[]): number {
  let concordantes = 0
  for (const bonne of reussites) {
    for (const mauvaise of echecs) {
      if (bonne > mauvaise) concordantes += 1
      else if (bonne === mauvaise) concordantes += 0.5
    }
  }
  return concordantes / (reussites.length * echecs.length)
}

export function mesurerCalibration(appariements: readonly AppariementPari[]): MesureCalibration {
  const n = appariements.length
  if (n === 0) {
    return {
      n: 0,
      calibration: null,
      discrimination: null,
      motifIndisponible: 'aucun pari apparié à une phase jugée',
      echantillonSuffisant: false
    }
  }

  const brier =
    appariements.reduce((somme, a) => {
      const ecart = a.confiance - (a.reussie ? 1 : 0)
      return somme + ecart * ecart
    }, 0) / n

  const reussites = appariements.filter((a) => a.reussie).map((a) => a.confiance)
  const echecs = appariements.filter((a) => !a.reussie).map((a) => a.confiance)

  if (reussites.length === 0 || echecs.length === 0) {
    return {
      n,
      calibration: brier,
      discrimination: null,
      motifIndisponible:
        'une seule classe observée (que des réussites ou que des échecs) : aucun ordre à mesurer',
      echantillonSuffisant: n >= SEUIL_ECHANTILLON
    }
  }

  return {
    n,
    calibration: brier,
    discrimination: 2 * aireSousCourbe(reussites, echecs) - 1,
    motifIndisponible: null,
    echantillonSuffisant: n >= SEUIL_ECHANTILLON
  }
}
