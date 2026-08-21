import {
  apparierParisEtIssues,
  mesurerCalibration,
  type MesureCalibration
} from '../../shared/pari-calibration'
import { extrairePari } from '../../shared/pari-parse'
import { issuesDepuisVerdict, verdictEstReussi } from './pari-liaison'
import type { PariPhaseStore } from './pari-phase-store'

/**
 * Le cœur du câblage, SORTI de `index.ts` pour être testable.
 *
 * Tant que ces quarante lignes vivaient dans `index.ts`, elles n'étaient couvertes par aucun test —
 * ce fichier n'est pas atteignable en test (il appelle `app.getPath` au chargement). Une condition
 * inversée ou un champ mal nommé y passait donc inaperçu, et le fail-open garantissait qu'aucun rouge
 * ne le révélerait jamais : la mesure se serait simplement tue. Ici, tout est vérifiable.
 */

/** La part d'un step d'orchestration dont ce module a besoin — rien de plus. */
export interface StepObserve {
  step: string
  status?: string
  detail?: string
  text?: string
  execution?: { phase?: string }
}

export interface MesureAffichable extends MesureCalibration {
  /**
   * Nombre de VERDICTS distincts derrière ces paris. Toutes les phases d'un run partagent l'issue de
   * ce run : 40 paris peuvent ne valoir que 10 tirages indépendants. Sans ce compte, un `n` flatteur
   * ferait croire l'échantillon mûr alors qu'il ne l'est pas — et le critère d'abandon porte
   * justement sur cette distinction.
   */
  verdictsDistincts: number
}

/**
 * Traite un step : dépose le pari d'une phase achevée, ou arbitre à l'arrivée du verdict de synthèse.
 * Rend la mesure cumulée quand un arbitrage vient d'avoir lieu, sinon `null`.
 *
 * FAIL-OPEN, mais NON MUET : toute erreur est signalée une fois via `avertir`. Un `catch` silencieux
 * rendait un journal en panne (droits, disque plein, JSONL corrompu) indistinguable d'un journal
 * vide — le lecteur affichait « aucun pari » et personne ne pouvait savoir lequel des deux.
 */
export function traiterStepPourPari(
  step: StepObserve,
  runId: string | undefined,
  store: PariPhaseStore,
  avertir: (message: string, cause: unknown) => void = () => {}
): MesureAffichable | null {
  if (!runId) return null
  try {
    if (step.step !== 'judge') {
      /*
       * `status: 'completed'` EXIGÉ, comme pour l'arbitrage. Une phase en échec dont le texte partiel
       * contient déjà la ligne de pari faisait enregistrer la prédiction d'une tentative avortée —
       * et la non-révision interdisait ensuite à la reprise réussie de parier.
       */
      if (step.status !== 'completed') return null
      const phase = step.execution?.phase
      if (!phase) return null
      const pari = extrairePari(step.text)
      if (!pari) return null
      store.deposer({
        runId,
        phase,
        confiance: pari.confiance,
        refutateur: pari.refutateur,
        emisA: new Date().toISOString()
      })
      return null
    }
    if (step.status !== 'completed') return null
    const reussie = verdictEstReussi(step.detail, step.text ?? '')
    if (reussie === null) return null
    const parisDuRun = store.lire()
    if (!issuesDepuisVerdict(parisDuRun, runId, reussie).length) return null
    if (!store.arbitrer(runId, reussie)) return null
    /*
     * La mesure porte sur TOUT l'historique, pas sur le run qui vient de finir. Calculée run par run,
     * elle valait n=1 ou 2 : le mot « calibration » y était affiché sans qu'il puisse rien signifier,
     * et la discrimination y était structurellement indisponible.
     */
    const paris = store.lire()
    const issues = store.lireIssues()
    const { appariements } = apparierParisEtIssues(paris, issues)
    const mesure = mesurerCalibration(appariements)
    return {
      ...mesure,
      verdictsDistincts: new Set(appariements.map((a) => a.runId)).size
    }
  } catch (cause) {
    avertir('[pari] mesure ignorée', cause)
    return null
  }
}

/** Une ligne lisible pour le journal de l'application — jamais un chiffre sans sa réserve. */
export function resumerMesure(mesure: MesureAffichable): string {
  const calibration = mesure.calibration === null ? 'n/a' : mesure.calibration.toFixed(3)
  const discrimination =
    mesure.discrimination === null
      ? `n/a (${mesure.motifIndisponible ?? 'indisponible'})`
      : mesure.discrimination.toFixed(3)
  const reserve = mesure.echantillonSuffisant ? '' : ' — échantillon encore trop mince'
  return (
    `[pari] ${mesure.n} pari(s) arbitré(s) sur ${mesure.verdictsDistincts} verdict(s) distinct(s) : ` +
    `calibration=${calibration} discrimination=${discrimination}${reserve}`
  )
}
