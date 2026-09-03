/**
 * Noyau PUR de l'outillage « ou passe le temps ? ».
 *
 * Deux sources de FAITS, aucune supposition :
 *  · les jalons de tour ecrits par `src/main/turn-timing.ts` (une ligne JSONL par tour de chat) ;
 *  · une sonde de reactivite du renderer (retard des ticks + taches longues du navigateur).
 *
 * Le rapport ne conclut jamais « c'est lent » : il NOMME un seuil et designe les segments qui le
 * depassent, avec leur echantillon. Un segment sans mesure n'apparait pas.
 */

/** Au-dela de ce p95, un segment de tour est un SUSPECT a instruire (et non un verdict). */
export const SEUIL_SEGMENT_LENT_MS = 500

/** Au-dela de ce retard sur un tick, le renderer etait REELLEMENT bloque (pas juste charge). */
const SEUIL_GEL_RENDERER_MS = 250

export interface SegmentLatence {
  nom: string
  /** Nombre de tours ou ce segment a ete mesure. */
  n: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export interface RapportLatence {
  tours: number
  lignesIllisibles: number
  segments: SegmentLatence[]
  /** Segments dont le p95 depasse {@link SEUIL_SEGMENT_LENT_MS}, du pire au moins pire. */
  suspects: SegmentLatence[]
}

function quantile(triees: number[], q: number): number {
  if (triees.length === 0) return 0
  const i = Math.min(triees.length - 1, Math.floor(triees.length * q))
  return triees[i] as number
}

/**
 * Transforme des lignes JSONL de `turn-timing` en couts PROPRES par segment.
 *
 * Les marques sont CUMULEES depuis le debut du tour : le cout d'une etape est sa marque moins la
 * precedente. Une ligne illisible est COMPTEE, jamais silencieusement jetee.
 */
export function resumerJalons(lignes: readonly string[]): RapportLatence {
  const echantillons = new Map<string, number[]>()
  let tours = 0
  let lignesIllisibles = 0
  for (const ligne of lignes) {
    const brut = ligne.trim()
    if (!brut) continue
    let tour: { marks?: Record<string, unknown> }
    try {
      tour = JSON.parse(brut) as { marks?: Record<string, unknown> }
    } catch {
      lignesIllisibles += 1
      continue
    }
    tours += 1
    const marques = Object.entries(tour.marks ?? {})
      .filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
      .sort((a, b) => a[1] - b[1])
    let precedent = 0
    for (const [nom, cumul] of marques) {
      const propre = Math.max(0, cumul - precedent)
      precedent = cumul
      const liste = echantillons.get(nom) ?? []
      liste.push(propre)
      echantillons.set(nom, liste)
    }
  }
  const segments: SegmentLatence[] = [...echantillons.entries()].map(([nom, valeurs]) => {
    const triees = [...valeurs].sort((a, b) => a - b)
    return {
      nom,
      n: triees.length,
      p50Ms: Math.round(quantile(triees, 0.5)),
      p95Ms: Math.round(quantile(triees, 0.95)),
      maxMs: Math.round(triees[triees.length - 1] ?? 0)
    }
  })
  segments.sort((a, b) => b.p95Ms - a.p95Ms)
  return {
    tours,
    lignesIllisibles,
    segments,
    suspects: segments.filter((s) => s.p95Ms > SEUIL_SEGMENT_LENT_MS)
  }
}

export interface SondeRenderer {
  /** Periode NOMINALE du tick de la sonde. */
  intervalleMs: number
  /** Instants reels des ticks (ms, origine libre). */
  horodatages: readonly number[]
  /** Durees des `longtask` observees pendant la sonde. */
  tachesLongues: readonly number[]
}

export interface ResumeSondeRenderer {
  ticks: number
  /** Pire retard d'un tick au-dela de sa periode nominale : la mesure du GEL. */
  retardMaxMs: number
  gele: boolean
  tachesLongues: number
  tacheLonguePlusLongueMs: number
}

/** Resume une sonde de reactivite : c'est le RETARD qui dit le gel, jamais le nombre de ticks. */
export function resumerSondeRenderer(sonde: SondeRenderer): ResumeSondeRenderer {
  let retardMax = 0
  for (let i = 1; i < sonde.horodatages.length; i += 1) {
    const ecart = (sonde.horodatages[i] as number) - (sonde.horodatages[i - 1] as number)
    retardMax = Math.max(retardMax, ecart - sonde.intervalleMs)
  }
  const retardMaxMs = Math.round(Math.max(0, retardMax))
  return {
    ticks: sonde.horodatages.length,
    retardMaxMs,
    gele: retardMaxMs > SEUIL_GEL_RENDERER_MS,
    tachesLongues: sonde.tachesLongues.length,
    tacheLonguePlusLongueMs: Math.round(Math.max(0, ...sonde.tachesLongues, 0))
  }
}
