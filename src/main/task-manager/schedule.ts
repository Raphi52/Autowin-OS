export type RecurrenceUnit = 'none' | 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface StructuredRecurrence {
  unit: RecurrenceUnit
  interval: number
  /** ISO weekday numbers: Monday=1 … Sunday=7. Used only for weekly recurrence. */
  weekDays?: number[]
}

export interface StructuredSchedule {
  startDate: string
  time: string
  timeZone: string
  recurrence: StructuredRecurrence
  endDate?: string
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatterCache.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    formatterCache.set(timeZone, value)
  }
  return value
}

function parseScheduleWall(schedule: StructuredSchedule): WallClock {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.startDate)
  const time = /^(\d{2}):(\d{2})$/.exec(schedule.time)
  if (!date) throw new Error('Date de début invalide (YYYY-MM-DD attendu)')
  if (!time) throw new Error('Heure invalide (HH:mm attendu)')
  const wall = {
    year: Number(date[1]),
    month: Number(date[2]),
    day: Number(date[3]),
    hour: Number(time[1]),
    minute: Number(time[2])
  }
  const normalized = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute))
  if (
    wall.month < 1 ||
    wall.month > 12 ||
    wall.day < 1 ||
    wall.day > 31 ||
    wall.hour < 0 ||
    wall.hour > 23 ||
    wall.minute < 0 ||
    wall.minute > 59 ||
    normalized.getUTCFullYear() !== wall.year ||
    normalized.getUTCMonth() !== wall.month - 1 ||
    normalized.getUTCDate() !== wall.day
  ) {
    throw new Error('Date ou heure structurée invalide')
  }
  validateTimeZone(schedule.timeZone)
  validateRecurrence(schedule.recurrence)
  return wall
}

function validateTimeZone(timeZone: string): void {
  try {
    formatter(timeZone).format(0)
  } catch {
    throw new Error(`Fuseau horaire invalide: ${timeZone}`)
  }
}

function validateRecurrence(recurrence: StructuredRecurrence): void {
  if (
    !Number.isInteger(recurrence.interval) ||
    recurrence.interval < 1 ||
    recurrence.interval > 365
  ) {
    throw new Error('Intervalle de récurrence invalide')
  }
  if (recurrence.unit === 'week') {
    const days = recurrence.weekDays ?? []
    if (
      days.length === 0 ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
      new Set(days).size !== days.length
    ) {
      throw new Error('Au moins un jour hebdomadaire valide est requis')
    }
  }
}

function wallAt(epochMs: number, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(epochMs)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute
  }
}

function sameWall(left: WallClock, right: WallClock): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  )
}

/**
 * Converts a local wall-clock value in an IANA zone to an epoch.
 * The round-trip check deliberately rejects DST gaps instead of silently shifting the task.
 */
function wallToEpoch(wall: WallClock, timeZone: string): number {
  const desiredUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0)
  let candidate = desiredUtc
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const seen = wallAt(candidate, timeZone)
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, 0, 0)
    const next = desiredUtc - (seenAsUtc - candidate)
    if (next === candidate) break
    candidate = next
  }
  if (!sameWall(wallAt(candidate, timeZone), wall)) {
    throw new Error(`Heure locale inexistante dans ${timeZone}`)
  }
  return candidate
}

function addCalendarDays(wall: WallClock, days: number): WallClock {
  const date = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day + days, wall.hour, wall.minute)
  )
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute
  }
}

function addCalendarMonths(wall: WallClock, months: number): WallClock {
  const first = new Date(Date.UTC(wall.year, wall.month - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
  ).getUTCDate()
  return {
    year: first.getUTCFullYear(),
    month: first.getUTCMonth() + 1,
    day: Math.min(wall.day, lastDay),
    hour: wall.hour,
    minute: wall.minute
  }
}

function calendarMonthDistance(from: WallClock, to: WallClock): number {
  return (to.year - from.year) * 12 + to.month - from.month
}

function isoWeekDay(wall: WallClock): number {
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()
  return day === 0 ? 7 : day
}

function localDateNumber(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day)
}

function weekStartNumber(wall: WallClock): number {
  return localDateNumber(wall) - (isoWeekDay(wall) - 1) * 86_400_000
}

function isBeyondEnd(schedule: StructuredSchedule, wall: WallClock): boolean {
  if (!schedule.endDate) return false
  return (
    `${wall.year.toString().padStart(4, '0')}-${wall.month
      .toString()
      .padStart(2, '0')}-${wall.day.toString().padStart(2, '0')}` > schedule.endDate
  )
}

function firstWeeklyWall(schedule: StructuredSchedule, start: WallClock): WallClock {
  const selected = new Set(schedule.recurrence.weekDays)
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addCalendarDays(start, offset)
    if (selected.has(isoWeekDay(candidate))) return candidate
  }
  throw new Error('Récurrence hebdomadaire sans jour sélectionné')
}

export function resolveFirstOccurrence(schedule: StructuredSchedule): number {
  const start = parseScheduleWall(schedule)
  const first = schedule.recurrence.unit === 'week' ? firstWeeklyWall(schedule, start) : start
  if (isBeyondEnd(schedule, first)) throw new Error('La date de fin précède la première échéance')
  return wallToEpoch(first, schedule.timeZone)
}

export function resolveFirstOccurrenceAtOrAfter(
  schedule: StructuredSchedule,
  threshold: number
): number | null {
  if (!Number.isFinite(threshold)) throw new Error('Seuil temporel invalide')
  let occurrence: number | null = resolveFirstOccurrence(schedule)
  const fixedIntervalMs =
    schedule.recurrence.unit === 'minute'
      ? schedule.recurrence.interval * 60_000
      : schedule.recurrence.unit === 'hour'
        ? schedule.recurrence.interval * 3_600_000
        : null
  if (fixedIntervalMs !== null && occurrence < threshold) {
    occurrence += Math.ceil((threshold - occurrence) / fixedIntervalMs) * fixedIntervalMs
    return isBeyondEnd(schedule, wallAt(occurrence, schedule.timeZone)) ? null : occurrence
  }
  for (let scanned = 0; occurrence !== null && scanned < 200_000; scanned += 1) {
    if (occurrence >= threshold) return occurrence
    occurrence = resolveNextOccurrence(schedule, occurrence)
  }
  if (occurrence === null) return null
  throw new Error('Première échéance future introuvable')
}

export function resolveNextOccurrence(
  schedule: StructuredSchedule,
  currentOccurrence: number
): number | null {
  const start = parseScheduleWall(schedule)
  const current = wallAt(currentOccurrence, schedule.timeZone)
  let next: WallClock

  switch (schedule.recurrence.unit) {
    case 'none':
      return null
    case 'minute':
    case 'hour': {
      const unitMs = schedule.recurrence.unit === 'minute' ? 60_000 : 3_600_000
      const nextOccurrence = currentOccurrence + schedule.recurrence.interval * unitMs
      return isBeyondEnd(schedule, wallAt(nextOccurrence, schedule.timeZone))
        ? null
        : nextOccurrence
    }
    case 'day':
      next = addCalendarDays(current, schedule.recurrence.interval)
      break
    case 'month':
      next = addCalendarMonths(
        start,
        (Math.floor(calendarMonthDistance(start, current) / schedule.recurrence.interval) + 1) *
          schedule.recurrence.interval
      )
      break
    case 'week': {
      const selected = new Set(schedule.recurrence.weekDays)
      const anchorWeek = weekStartNumber(start)
      next = addCalendarDays(current, 1)
      let found = false
      for (let scanned = 0; scanned < 3_700; scanned += 1) {
        const weekDistance = Math.floor((weekStartNumber(next) - anchorWeek) / (7 * 86_400_000))
        if (
          weekDistance >= 0 &&
          weekDistance % schedule.recurrence.interval === 0 &&
          selected.has(isoWeekDay(next))
        ) {
          found = true
          break
        }
        next = addCalendarDays(next, 1)
      }
      if (!found) throw new Error('Prochaine échéance hebdomadaire introuvable')
      break
    }
  }

  if (isBeyondEnd(schedule, next)) return null
  return wallToEpoch(next, schedule.timeZone)
}

export function occurrenceIdFor(taskId: string, scheduledFor: number): string {
  return `${taskId}@${scheduledFor}`
}
