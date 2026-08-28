/**
 * Noyau PUR du detecteur de GEL du process main.
 *
 * « Ce programme ne repond pas » n'est PAS une lenteur : c'est la boucle d'evenements du process
 * main bloquee assez longtemps pour que Windows cesse de voir la fenetre pomper ses messages. Les
 * jalons de tour (`turn-timing.jsonl`) ne peuvent pas l'attraper — ils n'enregistrent que des tours
 * qui SE TERMINENT, et un main bloque ne termine rien.
 *
 * Le principe est celui d'un battement regulier : un minuteur arme a periode FIXE. S'il se reveille
 * en retard, ce retard EST la duree pendant laquelle la boucle a ete tenue. Aucune supposition, une
 * soustraction. L'operation declaree au moment du gel est jointe pour NOMMER le coupable au lieu de
 * le deduire.
 */

/** Retard au-dela duquel un battement manque devient un GEL journalise (et non du bruit d'ordonnancement). */
export const SEUIL_GEL_MS = 1000

/** Periode du battement. Assez courte pour dater un gel, assez longue pour ne rien couter. */
export const PERIODE_BATTEMENT_MS = 500

export interface Gel {
  /** Horodatage ISO du reveil tardif. */
  ts: string
  /** Duree REELLE pendant laquelle la boucle d'evenements est restee tenue. */
  blocageMs: number
  /** Ce que le main disait faire au moment du gel — `inconnu` si rien n'etait declare. */
  operation: string
}

export interface ResumeGels {
  gels: number
  /** Le pire blocage observe, en ms. */
  pireMs: number
  /** Somme des blocages : le temps total ou l'application etait figee. */
  cumulMs: number
  /** Operations classees par temps de gel CUMULE, du pire au moins pire. */
  parOperation: Array<{ operation: string; gels: number; cumulMs: number; pireMs: number }>
  /** Lignes du journal qu'on n'a pas su relire — comptees, jamais jetees en silence. */
  lignesIllisibles: number
}

/**
 * Calcule le blocage a partir d'un reveil de minuteur.
 *
 * Un minuteur arme pour `periode` qui se reveille apres `ecoule` a ete retenu de `ecoule - periode`.
 * En dessous du seuil, il n'y a PAS de gel : rendre 0 evite de peindre en rouge l'ordonnancement
 * normal du systeme.
 */
export function blocageDepuisReveil(
  ecouleMs: number,
  periodeMs = PERIODE_BATTEMENT_MS,
  seuilMs = SEUIL_GEL_MS
): number {
  const retard = Math.round(ecouleMs - periodeMs)
  return retard >= seuilMs ? retard : 0
}

/** Agrege un journal de gels JSONL. Une ligne illisible est COMPTEE, jamais silencieusement jetee. */
export function resumerGels(lignes: readonly string[]): ResumeGels {
  const parOp = new Map<string, { gels: number; cumulMs: number; pireMs: number }>()
  let gels = 0
  let pireMs = 0
  let cumulMs = 0
  let lignesIllisibles = 0
  for (const ligne of lignes) {
    const brut = ligne.trim()
    if (!brut) continue
    let gel: Partial<Gel>
    try {
      gel = JSON.parse(brut) as Partial<Gel>
    } catch {
      lignesIllisibles += 1
      continue
    }
    const ms = typeof gel.blocageMs === 'number' && Number.isFinite(gel.blocageMs) ? gel.blocageMs : 0
    if (ms <= 0) {
      lignesIllisibles += 1
      continue
    }
    const operation = typeof gel.operation === 'string' && gel.operation ? gel.operation : 'inconnu'
    gels += 1
    cumulMs += ms
    if (ms > pireMs) pireMs = ms
    const agg = parOp.get(operation) ?? { gels: 0, cumulMs: 0, pireMs: 0 }
    agg.gels += 1
    agg.cumulMs += ms
    if (ms > agg.pireMs) agg.pireMs = ms
    parOp.set(operation, agg)
  }
  const parOperation = [...parOp.entries()]
    .map(([operation, a]) => ({ operation, ...a }))
    .sort((a, b) => b.cumulMs - a.cumulMs)
  return { gels, pireMs, cumulMs, parOperation, lignesIllisibles }
}
