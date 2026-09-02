/**
 * RÉSUMÉ PAR TOUR du journal d'activité — modèle pur, hors composant.
 *
 * Le journal est une longue liste plate de gestes. À l'échelle d'une conversation réelle, on n'y
 * retrouve plus « ce qu'a fait le tour de 14h32 » : le numéro du tour, son heure de début, combien
 * de gestes il a produits, ce qu'il a coûté et s'il a échoué n'étaient calculés NULLE PART. Ces
 * chiffres existent pourtant déjà dans les lignes (`usage` porte tokens et coût, `ok === false`
 * porte l'échec) ; ils étaient simplement jetés. On les agrège ici, sans jamais rien inventer :
 * un champ absent reste absent.
 */
import type { ModelActivityEntry } from './model-activity-log'

export interface ModelActivityTour {
  turnId: string
  /** Rang du tour dans la conversation, 1..N, dans l'ordre où ses gestes apparaissent. */
  index: number
  /** Lignes du tour, dans l'ordre reçu. */
  entries: ModelActivityEntry[]
  /** Heure du PREMIER geste horodaté du tour. Absente si aucun geste n'a d'heure. */
  debut?: number
  /** Heure du DERNIER geste horodaté. */
  fin?: number
  /** Durée entre premier et dernier geste horodaté, en ms. */
  dureeMs?: number
  /** Somme des tokens lus dans les lignes `usage`. Absente si aucune ligne n'en porte. */
  tokens?: number
  /** Somme des coûts lus dans les lignes `usage`. Absente si aucune ligne n'en porte. */
  cout?: number
  /** Le tour porte au moins un geste en échec. */
  erreur: boolean
}

/**
 * Premier nombre trouvé sous l'une des clés données, À N'IMPORTE QUELLE PROFONDEUR des champs
 * bruts. Les fournisseurs n'écrivent pas leur facturation au même endroit : tantôt à plat
 * (`totalTokens`), tantôt sous un objet (`usage.totalTokens`). On cherche donc la CLÉ, jamais une
 * position ; un objet sans aucune de ces clés ne rend rien plutôt qu'un nombre approchant.
 */
function nombre(fields: Record<string, unknown> | undefined, cles: string[]): number | undefined {
  if (!fields) return undefined
  for (const cle of cles) {
    const valeur = fields[cle]
    if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur
    if (typeof valeur === 'string' && valeur.trim() !== '' && Number.isFinite(Number(valeur)))
      return Number(valeur)
  }
  for (const valeur of Object.values(fields)) {
    if (!valeur || typeof valeur !== 'object') continue
    const imbrique = nombre(valeur as Record<string, unknown>, cles)
    if (imbrique !== undefined) return imbrique
  }
  return undefined
}

const CLES_TOKENS = ['totalTokens', 'tokens', 'total_tokens']
const CLES_COUT = ['costUsd', 'cost', 'coutUsd', 'usd']

/** Écart, en ms, entre une ligne et le premier geste horodaté de son tour. */
export function deltaMs(entry: ModelActivityEntry, tour: ModelActivityTour): number | undefined {
  if (typeof entry.at !== 'number' || typeof tour.debut !== 'number') return undefined
  return entry.at - tour.debut
}

/** Regroupe les lignes par tour, dans l'ordre d'apparition, et résume chaque tour. */
export function grouperParTour(
  entries: readonly ModelActivityEntry[]
): readonly ModelActivityTour[] {
  const parTour = new Map<string, ModelActivityTour>()
  for (const entry of entries) {
    let tour = parTour.get(entry.turnId)
    if (!tour) {
      tour = { turnId: entry.turnId, index: parTour.size + 1, entries: [], erreur: false }
      parTour.set(entry.turnId, tour)
    }
    tour.entries.push(entry)
    if (entry.ok === false || entry.kind === 'error') tour.erreur = true
    if (typeof entry.at === 'number') {
      if (tour.debut === undefined || entry.at < tour.debut) tour.debut = entry.at
      if (tour.fin === undefined || entry.at > tour.fin) tour.fin = entry.at
    }
    if (entry.kind === 'usage') {
      const jetons = nombre(entry.fields, CLES_TOKENS)
      if (jetons !== undefined) tour.tokens = (tour.tokens ?? 0) + jetons
      const prix = nombre(entry.fields, CLES_COUT)
      if (prix !== undefined) tour.cout = (tour.cout ?? 0) + prix
    }
  }
  const tours = [...parTour.values()]
  for (const tour of tours) {
    if (tour.debut !== undefined && tour.fin !== undefined) tour.dureeMs = tour.fin - tour.debut
  }
  return tours
}
