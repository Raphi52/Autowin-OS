/**
 * Ce qui empêche d'enregistrer un brouillon PLANIFIÉ, en clair. Rend `undefined` quand tout va bien.
 *
 * Symétrique de `watchdogDraftProblem` : une tâche dont l'horaire est incohérent ne partirait
 * jamais (départ déjà passé, semaine sans jour coché) ou partirait de travers, sans que rien ne le
 * dise. On refuse donc à la saisie plutôt qu'au réveil.
 */

export type ScheduleRecurrenceUnit = 'none' | 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface ScheduleDraftLike {
  startDate: string
  time: string
  recurrence: { unit: ScheduleRecurrenceUnit; interval: number; weekDays?: number[] }
  endDate?: string
}

/** Instant local du départ, ou `null` si la saisie n'est pas une date lisible. */
function startInstant(schedule: ScheduleDraftLike): number | null {
  if (!schedule.startDate?.trim() || !schedule.time?.trim()) return null
  const value = new Date(`${schedule.startDate}T${schedule.time}`).getTime()
  return Number.isFinite(value) ? value : null
}

export function scheduleDraftProblem(
  schedule: ScheduleDraftLike | undefined,
  now: number = Date.now()
): string | undefined {
  if (!schedule) return undefined
  if (!schedule.startDate?.trim() || !schedule.time?.trim())
    return 'Indique une date et une heure de départ.'
  const start = startInstant(schedule)
  if (start === null) return 'Indique une date et une heure de départ.'

  const { unit, interval, weekDays } = schedule.recurrence
  if (unit !== 'none' && (!Number.isFinite(interval) || interval < 1))
    return 'L’intervalle de répétition doit valoir au moins 1.'
  if (unit === 'week' && !(weekDays ?? []).length)
    return 'Coche au moins un jour de la semaine pour une répétition hebdomadaire.'
  if (schedule.endDate?.trim() && schedule.endDate < schedule.startDate)
    return 'La date de fin ne peut pas précéder la date de départ.'
  if (unit === 'none' && start < now)
    return 'La date et l’heure de départ sont déjà passées : choisis un moment à venir.'
  return undefined
}
