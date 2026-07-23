import { describe, expect, it } from 'vitest'
import { APP_DESTINATIONS, normalizeDestination, resolveAppLocation } from './navigation'

describe('registre canonique des destinations Autowin', () => {
  it('expose exactement les cinq domaines produit décidés', () => {
    expect(APP_DESTINATIONS.map(({ id }) => id)).toEqual([
      'chat',
      'agent-studio',
      'knowledge',
      'observatory',
      'settings'
    ])
  })

  it.each([
    ['chat', 'chat'],
    ['memory', 'knowledge'],
    ['graph', 'knowledge'],
    ['brain', 'knowledge'],
    ['agents', 'agent-studio'],
    ['roles', 'agent-studio'],
    ['models', 'agent-studio'],
    ['router', 'agent-studio'],
    ['omniroute', 'agent-studio'],
    ['capabilities', 'settings'],
    ['skills', 'settings'],
    ['hooks', 'settings'],
    ['tools', 'settings'],
    ['behaviour', 'settings'],
    ['behavior', 'settings'],
    ['observatoire', 'observatory'],
    ['prompt-load', 'observatory']
  ] as const)('normalise %s vers %s', (input, expected) => {
    expect(normalizeDestination(input)).toBe(expected)
  })

  it('replie une destination inconnue sur Chat plutôt que sur une vue vide', () => {
    expect(normalizeDestination('vue-inconnue')).toBe('chat')
  })

  it.each([
    ['router', { destination: 'agent-studio', section: 'routing' }],
    ['omniroute', { destination: 'agent-studio', section: 'routing' }],
    ['models', { destination: 'agent-studio', section: 'topology' }],
    ['capabilities', { destination: 'settings', section: 'capabilities' }],
    ['behaviour', { destination: 'settings', section: 'behaviour' }]
  ] as const)('préserve la sous-section visée par l’alias %s', (input, expected) => {
    expect(resolveAppLocation(input)).toEqual(expected)
  })
})
