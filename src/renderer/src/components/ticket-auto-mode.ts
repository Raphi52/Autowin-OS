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

/**
 * REGLAGES VISIBLES du mode auto (garde-fou 4). Avant, la concurrence et le plafond etaient deux
 * constantes enfouies dans deux fichiers : personne ne pouvait savoir combien de runs payants une
 * case a cocher allait declencher, ni les reduire sans recompiler.
 */
export interface AutoModeSettings {
  /** Conversations menees EN PARALLELE. */
  concurrency: number
  /** Tickets retenus par cycle de veille. */
  capPerCycle: number
  /** Plafond DUR de runs pour la session : atteint, le mode auto s'arrete de lui-meme. */
  maxRunsPerSession: number
}

export const AUTO_MODE_DEFAULTS: AutoModeSettings = {
  concurrency: 3,
  capPerCycle: AUTO_MODE_CAP_PER_CYCLE,
  maxRunsPerSession: 20
}

/** Bornes DURES : un reglage hors bornes est ramene dedans, jamais applique tel quel. */
export const AUTO_MODE_LIMITS = {
  concurrency: { min: 1, max: 5 },
  capPerCycle: { min: 1, max: 20 },
  maxRunsPerSession: { min: 1, max: 200 }
} as const

function clamp(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(numeric)))
}

export function normalizeAutoModeSettings(value: unknown): AutoModeSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    concurrency: clamp(
      raw.concurrency,
      AUTO_MODE_DEFAULTS.concurrency,
      AUTO_MODE_LIMITS.concurrency
    ),
    capPerCycle: clamp(
      raw.capPerCycle,
      AUTO_MODE_DEFAULTS.capPerCycle,
      AUTO_MODE_LIMITS.capPerCycle
    ),
    maxRunsPerSession: clamp(
      raw.maxRunsPerSession,
      AUTO_MODE_DEFAULTS.maxRunsPerSession,
      AUTO_MODE_LIMITS.maxRunsPerSession
    )
  }
}

const SETTINGS_STORAGE_KEY = 'autowin:tickets-auto-settings'

export function loadAutoModeSettings(storage: Pick<Storage, 'getItem'>): AutoModeSettings {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    return normalizeAutoModeSettings(raw ? JSON.parse(raw) : {})
  } catch {
    return { ...AUTO_MODE_DEFAULTS }
  }
}

export function saveAutoModeSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: AutoModeSettings
): AutoModeSettings {
  const normalized = normalizeAutoModeSettings(settings)
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    /* quota atteint : les reglages restent valables pour la session */
  }
  return normalized
}

/**
 * COUT ANNONCE, avant de lancer quoi que ce soit. Un run = une orchestration payante ; l'utilisateur
 * doit lire le pire cas AVANT de cocher, pas le decouvrir sur sa facture.
 */
export function describeAutoModeCost(settings: AutoModeSettings, pendingRuns: number): string {
  const normalized = normalizeAutoModeSettings(settings)
  const planned = Math.max(0, Math.trunc(pendingRuns))
  return (
    `${planned} run(s) à lancer · ${normalized.concurrency} en parallèle · ` +
    `max ${normalized.capPerCycle}/cycle · plafond session ${normalized.maxRunsPerSession} run(s) payants`
  )
}

/**
 * KILL-SWITCH GLOBAL — un seul point d'arret, consultable de partout et INDEPENDANT de React.
 *
 * Avant, l'arret reposait sur un `ref` interne au composant : decocher la case pendant un cycle,
 * changer de vue ou re-render laissait des workers continuer a piocher. Ici l'etat vit au niveau du
 * module : `shouldContinue` le consulte a chaque boucle, donc l'arret est immediat et irrevocable
 * jusqu'a une reprise EXPLICITE.
 */
let stopped = false
const stopListeners = new Set<() => void>()

export function stopAutoModeNow(): void {
  stopped = true
  for (const listener of [...stopListeners]) listener()
}

/** Reprise EXPLICITE : jamais implicite, sinon le kill-switch ne protegerait rien. */
export function resumeAutoMode(): void {
  stopped = false
}

export function isAutoModeStopped(): boolean {
  return stopped
}

export function onAutoModeStop(listener: () => void): () => void {
  stopListeners.add(listener)
  return () => stopListeners.delete(listener)
}

/**
 * Budget de runs de la SESSION. Retourne le nombre de tickets encore autorises : 0 = plafond
 * atteint, le mode auto doit s'arreter (et le dire), pas ralentir silencieusement.
 */
export function remainingSessionRuns(settings: AutoModeSettings, launched: number): number {
  const { maxRunsPerSession } = normalizeAutoModeSettings(settings)
  return Math.max(0, maxRunsPerSession - Math.max(0, Math.trunc(launched)))
}

export interface IncomingSelection {
  /** Tickets a traiter MAINTENANT (bornes par le cap). */
  toTreat: TicketItem[]
  /** Cles a enregistrer comme vues : uniquement celles retenues pour ce cycle. */
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
  // Kill-switch : arret demande ⇒ AUCUN ticket n'est retenu, et rien n'est marque « vu » (les
  // entrants restent eligibles apres une reprise explicite).
  if (isAutoModeStopped()) return { toTreat: [], seenAdditions: [], deferred: 0 }
  const fresh = items.filter((item) => !seen.has(ticketSeenKey(item)))
  const limit = Math.max(0, cap)
  const toTreat = fresh.slice(0, limit)
  return {
    toTreat,
    // Les tickets reportes doivent rester neufs afin d'etre retenus au cycle suivant.
    // Seuls les tickets effectivement retenus sont marques avant leur traitement.
    seenAdditions: toTreat.map(ticketSeenKey),
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
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    )
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
