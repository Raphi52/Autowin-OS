import {
  arretDeLaReparation,
  libelleDuPassageDeReparation,
  memeRefus,
  refusEnProgres
} from '../gates/stopgate'

/**
 * POURQUOI CE MODULE — objection du juge, tour
 * 8bc214db-8c48-4a29-880d-1ef4c4391d1f : « deux tests verifient le cablage en LISANT le texte de
 * orchestrator.ts (expect(source).toContain(...)). Ca casse au moindre renommage et ne prouve pas
 * l'execution. »
 *
 * CAUSE : la decision d'un passage de reparation vivait INLINE dans une methode de plus de cinq
 * mille lignes de `src/main/orchestration/orchestrator.ts`. Rien n'etait appelable depuis un test, donc les tests
 * se rabattaient sur une lecture de source — un scan textuel qui ne prouve aucune execution.
 * La decision est desormais une fonction PURE, appelee par la boucle ET rejouee par les tests.
 */
export type EtatDeBoucleDeReparation = {
  motifsPrecedents: string[]
  refusIdentiquesConsecutifs: number
  /** La meilleure note rendue par le juge depuis le début de la boucle (absente : aucune lue). */
  meilleureNote?: number
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
// fix-ok: le libelle figeait « build » alors que la reparation rejoue l'etape nommee.
export function traceDuPassage(
  attempt: number,
  plafondDur: number,
  jusquAuVert = false,
  phase?: string
): string | undefined {
  if (attempt <= 0) return undefined
  return libelleDuPassageDeReparation(attempt, plafondDur, jusquAuVert, phase)
}

/** La decision de fin de passage : rejouer, ou s'arreter en nommant le motif. */
export function deciderDuPassage(entree: {
  attempt: number
  reparationsAccordees: number
  plafondDur: number
  motifsCourants: readonly string[]
  etat: EtatDeBoucleDeReparation
  bundlePerime?: { bundleMs: number; sourceMs: number; demarrageMs?: number; bundle: string }
  /** Réparer jusqu'à ce qu'il n'y ait plus de défaut (voir `arretDeLaReparation`). */
  jusquAuVert?: boolean
  /** Memes reserves MINEUR sur un VALIDE, deux passages de suite. */
  // fix-ok: la boucle juge-réparation relançait un passage quand le juge rendait VALIDE avec les MÊMES réserves MINEUR (107 passages sur 109 après validation) ; arrêt décidé par le code, jamais par le juge
  reservesMineuresFigees?: boolean
  /** Le panel de juges est en panne, voir `arretDeLaReparation`. */
  panneDesJuges?: string
  /** La note rendue par le juge DANS ce passage (absente : refus avant le juge, ou note illisible). */
  noteDuJuge?: number
}): PassageDeReparation {
  const { attempt, reparationsAccordees, plafondDur, motifsCourants, etat } = entree
  const enProgres = refusEnProgres({
    motifsCourants,
    note: entree.noteDuJuge,
    meilleureNote: etat.meilleureNote
  })
  const meilleureNote =
    entree.noteDuJuge === undefined
      ? etat.meilleureNote
      : Math.max(entree.noteDuJuge, etat.meilleureNote ?? entree.noteDuJuge)
  const arret = arretDeLaReparation({
    tentative: attempt + 1,
    reparationsAccordees,
    plafondDur,
    motifsCourants,
    motifsPrecedents: etat.motifsPrecedents,
    refusIdentiquesConsecutifs: etat.refusIdentiquesConsecutifs,
    bundlePerime: entree.bundlePerime,
    jusquAuVert: entree.jusquAuVert,
    reservesMineuresFigees: entree.reservesMineuresFigees,
    ...(entree.panneDesJuges ? { panneDesJuges: entree.panneDesJuges } : {}),
    noteEnProgres: enProgres
  })
  const trace = traceDuPassage(attempt, plafondDur, entree.jusquAuVert)
  if (arret) return { ...(trace ? { trace } : {}), arret, etatSuivant: etat }
  return {
    ...(trace ? { trace } : {}),
    etatSuivant: {
      motifsPrecedents: [...motifsCourants],
      // Une note en hausse ouvre une nouvelle série : le refus suivant repart de un.
      refusIdentiquesConsecutifs:
        !enProgres && memeRefus(motifsCourants, etat.motifsPrecedents)
          ? etat.refusIdentiquesConsecutifs + 1
          : 0,
      ...(meilleureNote === undefined ? {} : { meilleureNote })
    }
  }
}
