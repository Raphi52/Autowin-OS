import { describe, expect, it } from 'vitest'
import {
  buildTimelineMarks,
  formatClock,
  formatDuration,
  formatElapsed,
  turnSpan
} from './observatory-timeline-axis'

const clockOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

describe('axe temporel de la Chronologie', () => {
  it('donne l’heure locale de chaque événement horodaté', () => {
    expect(formatClock('2026-10-11T08:30:05.000Z')).toBe(clockOf('2026-10-11T08:30:05.000Z'))
    expect(formatClock('2026-10-11T08:30:05.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('n’invente aucune heure pour un horodatage absent ou illisible', () => {
    expect(formatClock(undefined)).toBeNull()
    expect(formatClock('')).toBeNull()
    expect(formatClock('pas une date')).toBeNull()
  })

  it('écrit les durées comme on les lit', () => {
    expect(formatDuration(420)).toBe('420 ms')
    expect(formatDuration(2_400)).toBe('2,4 s')
    expect(formatDuration(12_300)).toBe('12 s')
    expect(formatDuration(185_000)).toBe('3 min 05')
    expect(formatDuration(3_720_000)).toBe('1 h 02')
  })

  it('montre un écart négatif au lieu de le lisser', () => {
    expect(formatElapsed(2_400)).toBe('+2,4 s')
    expect(formatElapsed(-1_200)).toBe('−1,2 s')
  })

  it('mesure chaque écart depuis le dernier événement horodaté, trou compris', () => {
    const marks = buildTimelineMarks([
      { id: 'a', timestamp: '2026-10-11T08:30:00.000Z' },
      { id: 'b', timestamp: '2026-10-11T08:30:02.400Z' },
      { id: 'c' },
      { id: 'd', timestamp: '2026-10-11T08:31:00.000Z' }
    ])

    expect(marks.get('a')).toMatchObject({ delta: null, deltaMs: null, pause: false })
    expect(marks.get('b')).toMatchObject({ delta: '+2,4 s', deltaMs: 2_400, pause: false })
    expect(marks.get('c')).toEqual({ clock: null, delta: null, deltaMs: null, pause: false })
    // L'écart de « d » part de « b » : l'événement sans heure ne remet pas l'axe à zéro.
    expect(marks.get('d')).toMatchObject({ delta: '+58 s', deltaMs: 57_600, pause: true })
  })

  it('donne la durée couverte par un tour, ou rien sous deux horodatages', () => {
    expect(
      turnSpan([
        { timestamp: '2026-10-11T08:30:00.000Z' },
        {},
        { timestamp: '2026-10-11T08:30:42.000Z' }
      ])
    ).toBe('42 s')
    expect(turnSpan([{ timestamp: '2026-10-11T08:30:00.000Z' }, {}])).toBeNull()
  })
})
