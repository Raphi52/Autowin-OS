import { describe, expect, it } from 'vitest'
import {
  apparierParisEtIssues,
  mesurerCalibration,
  type IssuePhase,
  type PariPhase
} from './pari-calibration'

/**
 * Ces tests portent la QUESTION FALSIFIABLE du chantier : le couple (calibration, discrimination)
 * distingue-t-il un parieur informatif d'un parieur qui se protège ? La calibration seule ne suffit
 * pas — un agent qui annonce 0,5 partout obtient un Brier honorable sans rien dire. Les trois
 * contrôles négatifs ci-dessous existent pour que ce mensonge-là soit impossible à faire passer.
 */

const pari = (phase: string, confiance: number): PariPhase => ({
  runId: 'run-1',
  phase,
  confiance,
  refutateur: `ce qui me réfuterait sur ${phase}`,
  emisA: '2026-08-21T10:00:00.000Z'
})

const issue = (phase: string, reussie: boolean, jugee = true): IssuePhase => ({
  runId: 'run-1',
  phase,
  reussie,
  jugee
})

/** Alterne réussites et échecs pour que les deux classes soient toujours représentées. */
const serie = (
  taille: number,
  confiancePour: (reussie: boolean) => number
): { paris: PariPhase[]; issues: IssuePhase[] } => {
  const paris: PariPhase[] = []
  const issues: IssuePhase[] = []
  for (let i = 0; i < taille; i++) {
    const reussie = i % 2 === 0
    paris.push(pari(`phase-${i}`, confiancePour(reussie)))
    issues.push(issue(`phase-${i}`, reussie))
  }
  return { paris, issues }
}

describe('appariement pari <-> issue', () => {
  it('apparie une phase jugée sur le couple runId + phase', () => {
    const resultat = apparierParisEtIssues([pari('build', 0.8)], [issue('build', true)])
    expect(resultat.appariements).toEqual([
      { runId: 'run-1', phase: 'build', confiance: 0.8, reussie: true }
    ])
    expect(resultat.parisSansIssue).toEqual([])
  })

  it("N'APPARIE RIEN quand la phase n'a pas été jugée — une phase sans verdict n'a pas d'issue falsifiable", () => {
    const resultat = apparierParisEtIssues([pari('scout', 0.9)], [issue('scout', true, false)])
    expect(resultat.appariements).toEqual([])
    expect(resultat.issuesNonJugees).toEqual(['scout'])
  })

  it('note une issue sans pari comme « pas de pari » au lieu de la compter comme un pari raté', () => {
    const resultat = apparierParisEtIssues([], [issue('build', false)])
    expect(resultat.appariements).toEqual([])
    expect(resultat.issuesSansPari).toEqual(['build'])
  })

  it('ne confond pas deux runs qui portent le même nom de phase', () => {
    const autreRun: PariPhase = { ...pari('build', 0.2), runId: 'run-2' }
    const resultat = apparierParisEtIssues([pari('build', 0.8), autreRun], [issue('build', true)])
    expect(resultat.appariements).toHaveLength(1)
    expect(resultat.appariements[0]?.confiance).toBe(0.8)
    expect(resultat.parisSansIssue).toEqual(['run-2/build'])
  })
})

describe('mesure — contrôles négatifs', () => {
  it('parieur PARFAIT : discrimination maximale et calibration quasi nulle', () => {
    const { paris, issues } = serie(20, (reussie) => (reussie ? 1 : 0))
    const { appariements } = apparierParisEtIssues(paris, issues)
    const mesure = mesurerCalibration(appariements)
    expect(mesure.discrimination).toBeCloseTo(1, 5)
    expect(mesure.calibration).toBeCloseTo(0, 5)
  })

  it('parieur PRUDENT (0,5 partout) : discrimination NULLE — le hedging ne rapporte rien', () => {
    const { paris, issues } = serie(20, () => 0.5)
    const { appariements } = apparierParisEtIssues(paris, issues)
    const mesure = mesurerCalibration(appariements)
    expect(mesure.discrimination).toBeCloseTo(0, 5)
    // Et son Brier reste médiocre-mais-pas-catastrophique : c'est bien pourquoi il ne suffit pas.
    expect(mesure.calibration).toBeCloseTo(0.25, 5)
  })

  it('parieur INVERSÉ : discrimination NÉGATIVE — le signal existe, à contresens', () => {
    const { paris, issues } = serie(20, (reussie) => (reussie ? 0 : 1))
    const { appariements } = apparierParisEtIssues(paris, issues)
    const mesure = mesurerCalibration(appariements)
    expect(mesure.discrimination).toBeCloseTo(-1, 5)
  })

  it('parieur INFORMATIF MAIS MAL CALIBRÉ : discrimination forte, calibration mauvaise', () => {
    // Il ordonne parfaitement (0,6 pour les réussites, 0,55 pour les échecs) mais ses chiffres mentent.
    const { paris, issues } = serie(20, (reussie) => (reussie ? 0.6 : 0.55))
    const { appariements } = apparierParisEtIssues(paris, issues)
    const mesure = mesurerCalibration(appariements)
    expect(mesure.discrimination).toBeCloseTo(1, 5)
    expect(mesure.calibration).toBeGreaterThan(0.15)
  })
})

describe('mesure — refus de conclure', () => {
  it('rend une discrimination NULLE et non un chiffre inventé quand une seule classe est observée', () => {
    const { appariements } = apparierParisEtIssues(
      [pari('a', 0.8), pari('b', 0.9)],
      [issue('a', true), issue('b', true)]
    )
    const mesure = mesurerCalibration(appariements)
    expect(mesure.discrimination).toBeNull()
    expect(mesure.motifIndisponible).toMatch(/une seule/i)
    expect(mesure.calibration).not.toBeNull()
  })

  it('sur zéro appariement, ne rend aucun chiffre plutôt qu’un zéro trompeur', () => {
    const mesure = mesurerCalibration([])
    expect(mesure.n).toBe(0)
    expect(mesure.calibration).toBeNull()
    expect(mesure.discrimination).toBeNull()
  })

  it('signale que l’échantillon est trop mince tant que le seuil de lecture n’est pas atteint', () => {
    const { paris, issues } = serie(6, (reussie) => (reussie ? 0.9 : 0.2))
    const { appariements } = apparierParisEtIssues(paris, issues)
    expect(mesurerCalibration(appariements).echantillonSuffisant).toBe(false)
    const large = serie(40, (reussie) => (reussie ? 0.9 : 0.2))
    const apparies = apparierParisEtIssues(large.paris, large.issues).appariements
    expect(mesurerCalibration(apparies).echantillonSuffisant).toBe(true)
  })
})

describe('robustesse des entrées', () => {
  it('rejette une confiance hors [0,1] au lieu de la laisser polluer la mesure', () => {
    const resultat = apparierParisEtIssues(
      [{ ...pari('build', 1.7) }, pari('clean', 0.8)],
      [issue('build', true), issue('clean', true)]
    )
    expect(resultat.appariements.map((a) => a.phase)).toEqual(['clean'])
    expect(resultat.parisInvalides).toEqual(['run-1/build'])
  })
})
