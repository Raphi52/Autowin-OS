import { describe, expect, it } from 'vitest'
import {
  occurrenceIdFor,
  resolveFirstOccurrence,
  resolveFirstOccurrenceAtOrAfter,
  resolveNextOccurrence,
  type StructuredSchedule
} from './schedule'

const PARIS = 'Europe/Paris'

function schedule(overrides: Partial<StructuredSchedule> = {}): StructuredSchedule {
  return {
    startDate: '2026-08-03',
    time: '09:30',
    timeZone: PARIS,
    recurrence: { unit: 'none', interval: 1 },
    ...overrides
  }
}

describe('Task Manager — planification structurée', () => {
  it('convertit une échéance locale non ambiguë vers un instant UTC', () => {
    expect(resolveFirstOccurrence(schedule())).toBe(Date.parse('2026-08-03T07:30:00.000Z'))
  })

  it('calcule une récurrence quotidienne avec intervalle utilisateur', () => {
    const everyTwoDays = schedule({ recurrence: { unit: 'day', interval: 2 } })
    const first = resolveFirstOccurrence(everyTwoDays)
    expect(resolveNextOccurrence(everyTwoDays, first)).toBe(Date.parse('2026-08-05T07:30:00.000Z'))
  })

  it('conserve le jour mensuel ancre apres un mois plus court, y compris avec intervalle 2', () => {
    const monthly = schedule({
      startDate: '2026-01-31',
      timeZone: 'UTC',
      recurrence: { unit: 'month', interval: 1 }
    })
    const january = resolveFirstOccurrence(monthly)
    const february = resolveNextOccurrence(monthly, january)
    const march = resolveNextOccurrence(monthly, february!)

    expect(february).toBe(Date.parse('2026-02-28T09:30:00.000Z'))
    expect(march).toBe(Date.parse('2026-03-31T09:30:00.000Z'))

    const everyTwoMonths = schedule({
      startDate: '2025-12-31',
      timeZone: 'UTC',
      recurrence: { unit: 'month', interval: 2 }
    })
    const december = resolveFirstOccurrence(everyTwoMonths)
    const februaryAfterTwoMonths = resolveNextOccurrence(everyTwoMonths, december)
    const aprilAfterTwoMonths = resolveNextOccurrence(everyTwoMonths, februaryAfterTwoMonths!)

    expect(februaryAfterTwoMonths).toBe(Date.parse('2026-02-28T09:30:00.000Z'))
    expect(aprilAfterTwoMonths).toBe(Date.parse('2026-04-30T09:30:00.000Z'))
  })

  it('calcule les récurrences en minutes et en heures', () => {
    const everyFifteenMinutes = schedule({ recurrence: { unit: 'minute', interval: 15 } })
    const everyTwoHours = schedule({ recurrence: { unit: 'hour', interval: 2 } })
    const first = resolveFirstOccurrence(everyFifteenMinutes)

    expect(resolveNextOccurrence(everyFifteenMinutes, first)).toBe(
      Date.parse('2026-08-03T07:45:00.000Z')
    )
    expect(resolveNextOccurrence(everyTwoHours, first)).toBe(Date.parse('2026-08-03T09:30:00.000Z'))
  })

  it('retrouve directement une échéance future pour une récurrence à la minute', () => {
    const everyFiveMinutes = schedule({ recurrence: { unit: 'minute', interval: 5 } })

    expect(
      resolveFirstOccurrenceAtOrAfter(everyFiveMinutes, Date.parse('2028-08-03T07:32:00.000Z'))
    ).toBe(Date.parse('2028-08-03T07:35:00.000Z'))
  })

  it('respecte les jours choisis pour une récurrence hebdomadaire', () => {
    const mondayAndWednesday = schedule({
      recurrence: { unit: 'week', interval: 1, weekDays: [1, 3] }
    })
    const monday = resolveFirstOccurrence(mondayAndWednesday)
    const wednesday = resolveNextOccurrence(mondayAndWednesday, monday)
    const nextMonday = resolveNextOccurrence(mondayAndWednesday, wednesday!)

    expect(wednesday).toBe(Date.parse('2026-08-05T07:30:00.000Z'))
    expect(nextMonday).toBe(Date.parse('2026-08-10T07:30:00.000Z'))
  })

  it('conserve l’heure murale lors du passage à l’heure d’hiver', () => {
    const daily = schedule({
      startDate: '2026-10-24',
      recurrence: { unit: 'day', interval: 1 }
    })
    const saturday = resolveFirstOccurrence(daily)
    const sunday = resolveNextOccurrence(daily, saturday)
    const monday = resolveNextOccurrence(daily, sunday!)

    expect(saturday).toBe(Date.parse('2026-10-24T07:30:00.000Z'))
    expect(sunday).toBe(Date.parse('2026-10-25T08:30:00.000Z'))
    expect(monday).toBe(Date.parse('2026-10-26T08:30:00.000Z'))
  })

  it('refuse une heure locale inexistante au changement d’heure', () => {
    expect(() =>
      resolveFirstOccurrence(
        schedule({
          startDate: '2026-03-29',
          time: '02:30'
        })
      )
    ).toThrow(/heure locale inexistante/i)
  })

  it('génère une clé d’occurrence stable et indépendante de l’heure de traitement', () => {
    const scheduledFor = Date.parse('2026-08-03T07:30:00.000Z')
    expect(occurrenceIdFor('task-7', scheduledFor)).toBe('task-7@1785742200000')
  })
})
