import type { TicketItem } from '../../../shared/tickets'

/**
 * MODE AUTO — traiter les tickets ENTRANTS du filtre courant, sans intervention.
 *
 * C'est la fonction la plus dangereuse de la vue Tickets : mal bornée, elle lance des dizaines
 * d'orchestrations payantes sans que personne ne l'ait demandé. Toute la logique de decision vit
 * donc ICI, pure et testable, avec trois garde-fous non negociables :
 *
 * 1. AMORCE — a l'activation, tout ce qui est deja affiche est marque « vu » SANS etre traite.
 *    Sinon cocher la case declencherait un run par ticket existant (jusqu'a 50 d'un coup).
 * 2. MARQUAGE AVANT TRAITEMENT — un ticket est enregistre comme vu des qu'il est retenu, jamais
 *    apres son traitement : un echec, un re-render ou une fermeture ne doit pas le relancer.
 * 3. CAP PAR CYCLE — un afflux (import massif, changement de filtre) ne peut pas se transformer en
 *    rafale illimitee ; le reste attendra le cycle suivant.
 */

/** Identite STABLE d'un ticket : la source ET l'id (deux sources peuvent partager un id). */
export function ticketSeenKey(item: Pick<TicketItem, 'sourceId' | 'id'>): string {
  return `${item.sourceId}::${item.id}`
}

export const AUTO_MODE_CAP_PER_CYCLE = 3

export interface IncomingSelection {
  /** Tickets a traiter MAINTENANT (bornes par le cap). */
  toTreat: TicketItem[]
  /** Cles a enregistrer comme vues : celles retenues ET celles reportees (elles ne sont plus neuves). */
  seenAdditions: string[]
  /** Nombre de tickets neufs reportes au prochain cycle a cause du cap. */
  deferred: number
}

/**
 * Choisit les tickets entrants a traiter. `items` doit deja etre FILTRE (le filtre de la vue est le
 * perimetre voulu par l'utilisateur). Un ticket deja vu n'est jamais retraite.
 */
export function pickIncomingTickets(
  items: readonly TicketItem[],
  seen: ReadonlySet<string>,
  cap: number = AUTO_MODE_CAP_PER_CYCLE
): IncomingSelection {
  const fresh = items.filter((item) => !seen.has(ticketSeenKey(item)))
  const limit = Math.max(0, cap)
  const toTreat = fresh.slice(0, limit)
  return {
    toTreat,
    // On marque TOUS les neufs, y compris les reportes : ils ne doivent pas etre comptes
    // « entrants » a chaque cycle suivant, sinon le cap les rejouerait indefiniment.
    seenAdditions: fresh.map(ticketSeenKey),
    deferred: fresh.length - toTreat.length
  }
}

/** Amorce : marque l'existant comme vu, sans rien traiter (garde-fou 1). */
export function primeSeen(items: readonly TicketItem[]): string[] {
  return items.map(ticketSeenKey)
}

const SEEN_STORAGE_KEY = 'autowin:tickets-auto-seen'
/** Borne du registre : evite une croissance sans fin du localStorage. Les plus recents sont gardes. */
const SEEN_MAX_ENTRIES = 2_000

export function loadSeen(storage: Pick<Storage, 'getItem'>): Set<string> {
  try {
    const raw = storage.getItem(SEEN_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set() // registre illisible : on repart d'un registre vide (l'amorce protege)
  }
}

export function saveSeen(storage: Pick<Storage, 'setItem'>, seen: ReadonlySet<string>): void {
  const entries = [...seen]
  const kept = entries.length > SEEN_MAX_ENTRIES ? entries.slice(-SEEN_MAX_ENTRIES) : entries
  try {
    storage.setItem(SEEN_STORAGE_KEY, JSON.stringify(kept))
  } catch {
    /* quota atteint : le mode auto reste fonctionnel sur la session en cours */
  }
}
