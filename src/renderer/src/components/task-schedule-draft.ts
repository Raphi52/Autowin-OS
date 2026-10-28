/**
 * Ce qui empêche d'enregistrer un brouillon PLANIFIÉ, en clair. Rend `undefined` quand tout va bien.
 *
 * Symétrique de `watchdogDraftProblem` : une tâche dont l'horaire est incohérent ne partirait
 * jamais (départ déjà passé, semaine sans jour coché) ou partirait de travers, sans que rien ne le
 * dise. On refuse donc à la saisie plutôt qu'au réveil.
 *
 * Le message suit la langue de l'interface (traduction anglaise, conv-1170) : il est lu au moment de
 * l'appel, pendant le rendu ou l'enregistrement de TaskManagerView.
 */

import { langueCourante } from '../langue'
import { traduireTaskManager, type CleTaskManager } from '../textes-ecrans/task-manager'

const texte = (cle: CleTaskManager): string => traduireTaskManager(cle, langueCourante())

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
  if (!schedule.startDate?.trim() || !schedule.time?.trim()) return texte('brouillon.depart')
  const start = startInstant(schedule)
  if (start === null) return texte('brouillon.depart')

  const { unit, interval, weekDays } = schedule.recurrence
  if (unit !== 'none' && (!Number.isFinite(interval) || interval < 1))
    return texte('brouillon.intervalle')
  if (unit === 'week' && !(weekDays ?? []).length) return texte('brouillon.jourSemaine')
  if (schedule.endDate?.trim() && schedule.endDate < schedule.startDate)
    return texte('brouillon.finAvantDepart')
  if (unit === 'none' && start < now) return texte('brouillon.departPasse')
  return undefined
}
