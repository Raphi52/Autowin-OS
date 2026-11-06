import { describe, expect, it } from 'vitest'
import { APP_DESTINATIONS, normalizeDestination, resolveAppLocation } from './navigation'

describe('registre canonique des destinations Autowin', () => {
  it('expose les dix domaines produit, Accueil en tete', () => {
    expect(APP_DESTINATIONS.map(({ id }) => id)).toEqual([
      'accueil',
      'chat',
      'agent-studio',
      'knowledge',
      'observatory',
      'task-manager',
      'worktree',
      'besoins',
      'tests',
      'settings'
    ])
  })

  // L'ancien écran Tickets : ses tickets externes sont l'onglet « Tickets » du Board, sa
  // veille « Autowin OS » un bloc de Maintenance. Ses noms mènent là, pas en silence sur le chat.
  it.each([
    ['tickets', { destination: 'besoins', section: 'tickets' }],
    ['Tickets', { destination: 'besoins', section: 'tickets' }],
    ['ticket', { destination: 'besoins', section: 'tickets' }],
    ['work items', { destination: 'besoins', section: 'tickets' }],
    ['veille', { destination: 'tests' }]
  ])('« %s » mène à la nouvelle place des tickets', (nom, attendu) => {
    expect(resolveAppLocation(nom)).toEqual(attendu)
  })

  it.each([
    ['chat', 'chat'],
    ['home', 'accueil'],
    ['dashboard', 'accueil'],
    ['memory', 'knowledge'],
    ['graph', 'knowledge'],
    ['brain', 'knowledge'],
    ['agents', 'agent-studio'],
    ['roles', 'agent-studio'],
    ['models', 'agent-studio'],
    ['router', 'settings'],
    ['routage', 'settings'],
    ['capabilities', 'settings'],
    ['skills', 'settings'],
    ['hooks', 'settings'],
    ['tools', 'settings'],
    ['behaviour', 'settings'],
    ['behavior', 'settings'],
    ['observatoire', 'observatory'],
    ['prompt-load', 'observatory'],
    ['tasks', 'task-manager'],
    ['scheduler', 'task-manager'],
    // Les anciens libellés de la vue Board.
    ['Carte du projet', 'besoins'],
    ['carte-du-projet', 'besoins']
  ] as const)('normalise %s vers %s', (input, expected) => {
    expect(normalizeDestination(input)).toBe(expected)
  })

  it('ouvre le Board par son nom affiché comme par ses anciens noms', () => {
    expect(resolveAppLocation('Board')).toEqual({ destination: 'besoins' })
    expect(resolveAppLocation('carte du projet')).toEqual({ destination: 'besoins' })
    expect(resolveAppLocation('besoins')).toEqual({ destination: 'besoins' })
  })

  it('replie une destination inconnue sur Chat plutôt que sur une vue vide', () => {
    expect(normalizeDestination('vue-inconnue')).toBe('chat')
  })

  it.each([
    // Routage vit dans Settings : l'ancien nom y aboutit, plus dans Agent Studio.
    ['router', { destination: 'settings', section: 'routing' }],
    ['routeur', { destination: 'settings', section: 'routing' }],
    ['routage', { destination: 'settings', section: 'routing' }],
    ['models', { destination: 'agent-studio', section: 'topology' }],
    ['capabilities', { destination: 'settings', section: 'capabilities' }],
    // Une section par registre : chaque nom ouvre SON registre.
    ['skills', { destination: 'settings', section: 'capabilities' }],
    ['hooks', { destination: 'settings', section: 'hooks' }],
    ['gates', { destination: 'settings', section: 'gates' }],
    ['mods', { destination: 'settings', section: 'mods' }],
    ['plugins', { destination: 'settings', section: 'mods' }],
    ['tools', { destination: 'settings', section: 'tools' }],
    ['behaviour', { destination: 'settings', section: 'behaviour' }],
    ['workflows', { destination: 'agent-studio', section: 'workflows' }],
    ['workflow', { destination: 'agent-studio', section: 'workflows' }],
    ['runs', { destination: 'agent-studio', section: 'workflows' }]
  ] as const)('préserve la sous-section visée par l’alias %s', (input, expected) => {
    expect(resolveAppLocation(input)).toEqual(expected)
  })
})
