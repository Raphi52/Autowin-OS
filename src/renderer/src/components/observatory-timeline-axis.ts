/**
 * Axe temporel de la Chronologie Observatory — demande utilisateur du 2026-10-11 (conv-226) :
 * « mon observatory je le veux en mode timeline dans chronologie ». La vue empilait des cartes
 * numérotées sans aucune heure : on ne voyait ni QUAND un événement avait eu lieu, ni le temps
 * écoulé entre deux d'entre eux — c'est-à-dire précisément ce qu'une frise montre.
 *
 * Ce module ne fait que lire les horodatages déjà portés par la trace (`event.timestamp`) : il
 * n'en invente aucun. Un événement sans horodatage lisible reste SANS heure (`clock: null`) et ne
 * sert pas de point de départ à l'écart suivant — afficher une heure devinée ferait mentir l'axe.
 */

export interface TimelineMark {
  /** Heure locale `HH:MM:SS`, ou null si l'horodatage manque ou est illisible. */
  clock: string | null
  /** Écart signé avec l'événement horodaté PRÉCÉDENT affiché (`+2,4 s`), null pour le premier. */
  delta: string | null
  /** Écart brut en millisecondes, null quand `delta` l'est. */
  deltaMs: number | null
  /** Vrai quand l'écart dépasse le seuil de pause : la frise le fait ressortir. */
  pause: boolean
}

/** Au-delà de 30 s sans événement, le tour a attendu quelque chose : on le signale. */
export const TIMELINE_PAUSE_MS = 30_000

function parseTime(iso: string | undefined): number | null {
  if (!iso) return null
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : null
}

/** Heure locale lisible d'un horodatage ISO, ou null s'il est absent ou illisible. */
export function formatClock(iso: string | undefined): string | null {
  const value = parseTime(iso)
  if (value == null) return null
  return new Date(value).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/** Durée humaine, sans signe : `420 ms`, `2,4 s`, `12 s`, `3 min 05`, `1 h 02`. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1000) return `${Math.round(abs)} ms`
  if (abs < 10_000) return `${(abs / 1000).toFixed(1).replace('.', ',')} s`
  const totalSeconds = Math.round(abs / 1000)
  if (totalSeconds < 60) return `${totalSeconds} s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min ${String(totalSeconds % 60).padStart(2, '0')}`
  return `${Math.floor(totalMinutes / 60)} h ${String(totalMinutes % 60).padStart(2, '0')}`
}

/**
 * Écart signé. Un écart NÉGATIF reste affiché tel quel (`−1,2 s`) : les événements sont rangés par
 * numéro de séquence, et une heure qui recule est une incohérence de trace à montrer, pas à lisser.
 */
export function formatElapsed(ms: number): string {
  return `${ms < 0 ? '−' : '+'}${formatDuration(ms)}`
}

/**
 * Repères de la frise pour une liste d'événements DANS L'ORDRE D'AFFICHAGE. L'écart se mesure
 * toujours depuis le dernier événement horodaté qui précède — un trou d'horodatage ne remet pas
 * l'axe à zéro.
 */
export function buildTimelineMarks(
  events: ReadonlyArray<{ id: string; timestamp?: string }>,
  pauseMs: number = TIMELINE_PAUSE_MS
): Map<string, TimelineMark> {
  const marks = new Map<string, TimelineMark>()
  let previous: number | null = null
  for (const event of events) {
    const value = parseTime(event.timestamp)
    if (value == null) {
      marks.set(event.id, { clock: null, delta: null, deltaMs: null, pause: false })
      continue
    }
    const deltaMs = previous == null ? null : value - previous
    marks.set(event.id, {
      clock: formatClock(event.timestamp),
      delta: deltaMs == null ? null : formatElapsed(deltaMs),
      deltaMs,
      pause: deltaMs != null && deltaMs >= pauseMs
    })
    previous = value
  }
  return marks
}

/** Durée couverte par un tour (premier → dernier horodatage lisible), ou null s'il en a moins de deux. */
export function turnSpan(events: ReadonlyArray<{ timestamp?: string }>): string | null {
  const times = events
    .map((event) => parseTime(event.timestamp))
    .filter((v): v is number => v != null)
  if (times.length < 2) return null
  return formatDuration(Math.max(...times) - Math.min(...times))
}
