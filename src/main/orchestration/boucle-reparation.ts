import {
  arretDeLaReparation,
  estFreinDuRefusRepete,
  libelleDuPassageDeReparation,
  memeRefus,
  refusEnProgres
} from '../gates/stopgate'
import { reservesMineuresAuFrein } from '../juge/objections-juge'

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

/**
 * AU FREIN, UN TRAVAIL QUI N'A PLUS QUE DES REMARQUES MINEURES EST LIVRÉ AVEC SES RÉSERVES.
 *
 * Trois conditions, toutes nécessaires : l'arrêt est le frein du refus répété (pas un code périmé
 * ni une panne de juges) ; le refus vient du verdict du juge et de lui SEUL (aucune case de la
 * demande non tenue, aucun travail non livré, aucun test du juge modifié) ; ce verdict ne porte que
 * des MINEUR (`reservesMineuresAuFrein`). Rend les réserves à écrire sous le résultat, `[]` sinon.
 */
export function reservesLivreesAuFrein(entree: {
  arret: string | undefined
  /** Le verdict rendu par le juge DANS ce passage ; absent si le contrôle a refusé avant lui. */
  verdictDuPassage: string | undefined
  /** Les motifs du refus sont exactement ceux que ce verdict produit à lui seul. */
  refusDuVerdictSeul: boolean
}): string[] {
  if (!estFreinDuRefusRepete(entree.arret)) return []
  if (!entree.verdictDuPassage || !entree.refusDuVerdictSeul) return []
  return reservesMineuresAuFrein(entree.verdictDuPassage)
}

/** La ligne de trace d'une livraison au frein : elle dit pourquoi le run n'est pas rouge. */
export function ligneDeLivraisonAuFrein(reserves: readonly string[]): string {
  const nombre = `${reserves.length} remarque${reserves.length > 1 ? 's' : ''} mineure${reserves.length > 1 ? 's' : ''}`
  return `Livré avec réserves : le même refus est revenu plusieurs fois de suite et il ne reste que ${nombre} — rejouer ne converge plus, elles sont écrites sous le résultat.`
}

/** La decision de fin de passage : rejouer, ou s'arreter en nommant le motif. */
export function deciderDuPassage(entree: {
  attempt: number
  reparationsAccordees: number
  plafondDur: number
  /** Le motif de la politique quand le plafond vaut zéro : il est dit dans l'arrêt, jamais muet. */
  motifPlafond?: string
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
    ...(entree.motifPlafond ? { motifPlafond: entree.motifPlafond } : {}),
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
