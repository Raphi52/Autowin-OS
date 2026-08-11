import { describe, expect, it } from 'vitest'
import { scheduleDraftProblem, type ScheduleDraftLike } from './task-schedule-draft'

const NOW = new Date('2026-08-11T10:00:00').getTime()

function schedule(patch: Partial<ScheduleDraftLike> = {}): ScheduleDraftLike {
  return {
    startDate: '2026-08-12',
    time: '09:00',
    recurrence: { unit: 'none', interval: 1 },
    ...patch
  }
}

describe('scheduleDraftProblem', () => {
  const cases: Array<{ name: string; draft: ScheduleDraftLike; expected: RegExp | undefined }> = [
    { name: 'départ futur sans répétition', draft: schedule(), expected: undefined },
    {
      name: 'départ déjà passé sans répétition',
      draft: schedule({ startDate: '2026-08-10', time: '09:00' }),
      expected: /déjà passé/i
    },
    {
      name: 'départ passé mais répétition quotidienne',
      draft: schedule({
        startDate: '2026-08-10',
        recurrence: { unit: 'day', interval: 1 }
      }),
      expected: undefined
    },
    {
      name: 'date de fin avant le départ',
      draft: schedule({
        recurrence: { unit: 'day', interval: 1 },
        endDate: '2026-08-11'
      }),
      expected: /date de fin/i
    },
    {
      name: 'date de fin égale au départ',
      draft: schedule({
        recurrence: { unit: 'day', interval: 1 },
        endDate: '2026-08-12'
      }),
      expected: undefined
    },
    {
      name: 'semaine sans jour coché',
      draft: schedule({ recurrence: { unit: 'week', interval: 1, weekDays: [] } }),
      expected: /jour de la semaine/i
    },
    {
      name: 'semaine avec un jour coché',
      draft: schedule({ recurrence: { unit: 'week', interval: 1, weekDays: [3] } }),
      expected: undefined
    },
    {
      name: 'intervalle nul',
      draft: schedule({ recurrence: { unit: 'hour', interval: 0 } }),
      expected: /au moins 1/i
    },
    {
      name: 'intervalle négatif',
      draft: schedule({ recurrence: { unit: 'month', interval: -3 } }),
      expected: /au moins 1/i
    },
    {
      name: 'date de départ absente',
      draft: schedule({ startDate: '' }),
      expected: /date et une heure de départ/i
    },
    {
      name: 'heure absente',
      draft: schedule({ time: '' }),
      expected: /date et une heure de départ/i
    }
  ]

  for (const { name, draft, expected } of cases) {
    it(name, () => {
      const problem = scheduleDraftProblem(draft, NOW)
      if (expected === undefined) expect(problem).toBeUndefined()
      else expect(problem).toMatch(expected)
    })
  }

  it('ne juge pas un brouillon sans horaire (règle de réveil)', () => {
    expect(scheduleDraftProblem(undefined, NOW)).toBeUndefined()
  })

  it('rend un message en français lisible sans jargon technique', () => {
    const problem = scheduleDraftProblem(schedule({ startDate: '2026-08-01' }), NOW)
    expect(problem).toBe(
      'La date et l’heure de départ sont déjà passées : choisis un moment à venir.'
    )
  })
})
