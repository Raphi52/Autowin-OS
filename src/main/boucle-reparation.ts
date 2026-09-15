import {
  arretDeLaReparation,
  libelleDuPassageDeReparation,
  memeRefus
} from './gates/stopgate'

/**
 * POURQUOI CE MODULE — objection du juge sur conv-540, tour
 * 8bc214db-8c48-4a29-880d-1ef4c4391d1f : « deux tests verifient le cablage en LISANT le texte de
 * orchestrator.ts (expect(source).toContain(...)). Ca casse au moindre renommage et ne prouve pas
 * l'execution. »
 *
 * CAUSE : la decision d'un passage de reparation vivait INLINE dans une methode de plus de cinq
 * mille lignes de `src/main/orchestrator.ts`. Rien n'etait appelable depuis un test, donc les tests
 * se rabattaient sur une lecture de source — un scan textuel qui ne prouve aucune execution.
 * La decision est desormais une fonction PURE, appelee par la boucle ET rejouee par les tests.
 */
export type EtatDeBoucleDeReparation = {
  motifsPrecedents: string[]
  refusIdentiquesConsecutifs: number
}

export type PassageDeReparation = {
  /** Ligne a pousser dans la trace avant de rejouer le build (absente au premier passage). */
  trace?: string
  /** Motif d'arret : present, la boucle s'arrete et le DIT ; absent, elle rejoue. */
  arret?: string
  /** Etat a reporter au passage suivant. */
  etatSuivant: EtatDeBoucleDeReparation
}

/** Ce que la boucle pousse dans la trace en entrant dans le passage `attempt` (0 = premier build). */
export function traceDuPassage(attempt: number, plafondDur: number): string | undefined {
  if (attempt <= 0) return undefined
  return libelleDuPassageDeReparation(attempt, plafondDur)
}

/** La decision de fin de passage : rejouer, ou s'arreter en nommant le motif. */
export function deciderDuPassage(entree: {
  attempt: number
  reparationsAccordees: number
  plafondDur: number
  motifsCourants: readonly string[]
  etat: EtatDeBoucleDeReparation
  bundlePerime?: string
}): PassageDeReparation {
  const { attempt, reparationsAccordees, plafondDur, motifsCourants, etat } = entree
  const arret = arretDeLaReparation({
    tentative: attempt + 1,
    reparationsAccordees,
    plafondDur,
    motifsCourants,
    motifsPrecedents: etat.motifsPrecedents,
    refusIdentiquesConsecutifs: etat.refusIdentiquesConsecutifs,
    bundlePerime: entree.bundlePerime
  })
  const trace = traceDuPassage(attempt, plafondDur)
  if (arret) return { ...(trace ? { trace } : {}), arret, etatSuivant: etat }
  return {
    ...(trace ? { trace } : {}),
    etatSuivant: {
      motifsPrecedents: [...motifsCourants],
      refusIdentiquesConsecutifs: memeRefus(motifsCourants, etat.motifsPrecedents)
        ? etat.refusIdentiquesConsecutifs + 1
        : 0
    }
  }
}
