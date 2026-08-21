import { describe, expect, it } from 'vitest'
import {
  agentNotices,
  nextDepartures,
  relativeDelay,
  unacknowledgedCount
} from './home-widgets-model'

const NOW = Date.parse('2026-08-21T09:00:00.000Z')

describe('departs des routines', () => {
  const tasks = [
    { id: 'tard', title: 'Veille concurrents', enabled: true, nextRunAt: NOW + 3 * 3600_000 },
    { id: 'tot', title: 'Rapport du matin', enabled: true, nextRunAt: NOW + 12 * 60_000 },
    { id: 'off', title: 'Nettoyage', enabled: false, nextRunAt: NOW + 60 * 60_000 },
    { id: 'evenement', title: 'Watchdog rouge', enabled: true, nextRunAt: null, watchdog: {} },
    { id: 'sans-heure', title: 'Tache orpheline', enabled: true, nextRunAt: null }
  ]

  it('classe du depart le plus proche au plus lointain', () => {
    expect(nextDepartures(tasks, NOW).map((entry) => entry.id)).toEqual(['tot', 'off', 'tard'])
  })

  it('ecarte la tache reveillee par evenement, qui n a pas d heure', () => {
    expect(nextDepartures(tasks, NOW).some((entry) => entry.id === 'evenement')).toBe(false)
  })

  it('ecarte aussi une tache horaire sans prochaine occurrence', () => {
    expect(nextDepartures(tasks, NOW).some((entry) => entry.id === 'sans-heure')).toBe(false)
  })

  it('garde la tache desactivee mais la marque suspendue', () => {
    const departs = nextDepartures(tasks, NOW)
    expect(departs.find((entry) => entry.id === 'off')!.suspended).toBe(true)
    expect(departs.find((entry) => entry.id === 'tot')!.suspended).toBe(false)
  })

  it('calcule le delai lisible', () => {
    expect(nextDepartures(tasks, NOW).find((entry) => entry.id === 'tot')!.relative).toBe(
      'dans 12 min'
    )
  })

  it('plafonne la liste', () => {
    expect(nextDepartures(tasks, NOW, 2)).toHaveLength(2)
  })
})

describe('delai lisible', () => {
  it.each([
    [-60_000, 'en retard'],
    [10_000, 'imminent'],
    [12 * 60_000, 'dans 12 min'],
    [2 * 3600_000, 'dans 2 h'],
    [(2 * 60 + 5) * 60_000, 'dans 2 h 5 min'],
    [26 * 3600_000, 'demain'],
    [4 * 24 * 3600_000, 'dans 4 jours']
  ])('%i ms -> %s', (delta, expected) => {
    expect(relativeDelay(delta)).toBe(expected)
  })
})

describe('remontees des agents', () => {
  const tasks = [{ id: 't1', title: 'Rapport du matin' }]
  const alerts = [
    {
      id: 'a-vue',
      taskId: 't1',
      kind: 'failed' as const,
      message: 'run rouge',
      createdAt: NOW,
      acknowledgedAt: NOW
    },
    {
      id: 'a-neuve',
      taskId: 't1',
      kind: 'missed' as const,
      message: 'occurrence ratee',
      createdAt: NOW - 3600_000
    },
    { id: 'a-inconnue', taskId: 'disparue', kind: 'failed' as const, message: 'ko', createdAt: NOW }
  ]

  it('remonte les alertes non acquittees avant les alertes deja vues, meme plus recentes', () => {
    expect(agentNotices(alerts, tasks).map((notice) => notice.id)).toEqual([
      'a-inconnue',
      'a-neuve',
      'a-vue'
    ])
  })

  it('nomme la tache d origine quand elle existe, son identifiant sinon', () => {
    const notices = agentNotices(alerts, tasks)
    expect(notices.find((notice) => notice.id === 'a-neuve')!.origin).toBe('Rapport du matin')
    expect(notices.find((notice) => notice.id === 'a-inconnue')!.origin).toBe('disparue')
  })

  it('compte ce qui reste a lire', () => {
    expect(unacknowledgedCount(agentNotices(alerts, tasks))).toBe(2)
    expect(unacknowledgedCount([])).toBe(0)
  })
})
