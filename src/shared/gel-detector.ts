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

/**
 * Part du retard qui doit avoir ete brulee par NOTRE process pour que le gel lui soit imputable.
 * En dessous, le temps a passe ailleurs : la boucle n'etait pas tenue, elle n'etait pas ordonnancee.
 */
export const PART_CPU_IMPUTABLE = 0.5

/**
 * Origine d'un gel.
 *  · `boucle-tenue` — notre process a brule le temps : c'est NOTRE code qui figeait la fenetre.
 *  · `process-prive-de-cpu` — le retard s'est ecoule sans que nous consommions de CPU (machine
 *    saturee, mise en veille, process desordonnance). Reel pour l'utilisateur, mais NON imputable a
 *    une operation : l'operation declaree a cet instant n'est qu'une coincidence.
 *
 * Limite assumee : un blocage synchrone d'ENTREE-SORTIE ne brule pas de CPU non plus. Il n'est pas
 * perdu pour autant — `instrumenterCanauxIpc` le chronometre DIRECTEMENT et le journalise sous le
 * suffixe `(sync)`, sans dependre de cette heuristique.
 */
export type CauseGel = 'boucle-tenue' | 'process-prive-de-cpu' | 'entree-sortie-bloquante'

/**
 * Part du blocage que le TEMOIN doit avoir subie pour que la contention machine soit credible.
 * En dessous, le temoin s'est reveille A L'HEURE : la machine nous ordonnancait bien, donc le thread
 * principal etait coince dans un appel bloquant — c'est NOTRE code, pas la machine.
 */
export const PART_TEMOIN_EN_RETARD = 0.5

export interface Gel {
  /** Horodatage ISO du reveil tardif. */
  ts: string
  /** Duree REELLE pendant laquelle la boucle d'evenements est restee tenue. */
  blocageMs: number
  /** Ce que le main disait faire au moment du gel — `inconnu` si rien n'etait declare. */
  operation: string
  /** Absent sur les gels journalises avant l'introduction de la preuve par le CPU. */
  cause?: CauseGel
  /**
   * PISTE, pas verdict — renseigne uniquement quand `operation` vaut `inconnu`. C'est la derniere
   * operation qui s'est REFERMEE pendant la fenetre figee : elle a donc reellement tourne pendant
   * le gel. Une operation refermee AVANT la fenetre n'est jamais reportee ici (l'erreur d'alibi
   * deja payee sur `timer:balayage:copiesAbandonnees`).
   */
  indice?: string
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
  /** Gels REELS mais non imputables a notre boucle — exclus de l'attribution, jamais caches. */
  gelsNonImputables: number
  /** Temps fige total non imputable a notre code. */
  msNonImputables: number
}

/**
 * Classe un reveil tardif : y a-t-il gel, et est-il IMPUTABLE a notre boucle ?
 *
 * Mesure du 2026-08-28 (20:37 -> 21:42) : un « gel » de 16 a 22 s toutes les minutes, reparti au
 * hasard sur `inactif`, `demarrage:interface chargee`, `os:models:quotas`, `os:pilotChat`. Une
 * boucle tenue par notre propre code ne change pas de coupable a chaque minute. Le CPU consomme
 * pendant le retard tranche : brule chez nous => c'est nous ; pas brule => c'est la machine.
 */
export function classerGel(
  ecouleMs: number,
  cpuMsConsomme: number,
  periodeMs = PERIODE_BATTEMENT_MS,
  seuilMs = SEUIL_GEL_MS,
  retardTemoinMs?: number
): { blocageMs: number; cause: CauseGel } {
  const blocageMs = blocageDepuisReveil(ecouleMs, periodeMs, seuilMs)
  if (blocageMs > 0 && cpuMsConsomme >= blocageMs * PART_CPU_IMPUTABLE)
    return { blocageMs, cause: 'boucle-tenue' }
  /*
   * Sans temoin, le classement d'origine est STRICTEMENT conserve : les journaux anterieurs restent
   * relisibles et aucun gel ancien ne change de cause retroactivement.
   */
  if (
    blocageMs > 0 &&
    retardTemoinMs !== undefined &&
    retardTemoinMs < blocageMs * PART_TEMOIN_EN_RETARD
  )
    return { blocageMs, cause: 'entree-sortie-bloquante' }
  return { blocageMs, cause: 'process-prive-de-cpu' }
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
  let gelsNonImputables = 0
  let msNonImputables = 0
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
    const ms =
      typeof gel.blocageMs === 'number' && Number.isFinite(gel.blocageMs) ? gel.blocageMs : 0
    if (ms <= 0) {
      lignesIllisibles += 1
      continue
    }
    // Un gel prouve NON imputable est compte a part : il est reel, mais l'operation declaree a cet
    // instant n'est qu'une coincidence — l'attribuer ferait chasser un alibi.
    if (gel.cause === 'process-prive-de-cpu') {
      gelsNonImputables += 1
      msNonImputables += ms
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
  return {
    gels,
    pireMs,
    cumulMs,
    parOperation,
    lignesIllisibles,
    gelsNonImputables,
    msNonImputables
  }
}

/**
 * NOMME un acces synchrone susceptible de tenir la boucle.
 *
 * Le temoin prouve QUE le main est coince dans une entree-sortie ; il ne dit pas LAQUELLE. Un
 * nom utile doit repondre a deux questions : quel appel, et surtout — disque local ou partage
 * RESEAU. Un `readFileSync` sur `//ged2` peut tenir la boucle des secondes quand le partage rame ;
 * le meme appel sur `C:` coute des millisecondes. Le chemin est CONDENSE (racine + fichier) :
 * l'agregation par operation doit regrouper les acces d'un meme partage, pas les eparpiller.
 */
export function nommerAccesBloquant(api: string, cible?: unknown): string {
  if (typeof cible !== 'string' || !cible) return `io:disque:${api}`
  const normalise = cible.split(String.fromCharCode(92)).join('/')
  const reseau = normalise.startsWith('//')
  const segments = normalise.split('/').filter(Boolean)
  const racine = reseau ? `//${segments.slice(0, 2).join('/')}` : (segments[0] ?? '')
  const fichier = segments[segments.length - 1] ?? ''
  const intermediaire = reseau ? segments.length > 3 : segments.length > 2
  const condense = intermediaire ? `${racine}/…/${fichier}` : `${racine}/${fichier}`
  return `io:${reseau ? 'reseau' : 'disque'}:${api} ${condense}`
}
