import { describe, expect, it } from 'vitest'
import { normalizeTab } from './tabs'

describe('normalizeTab — mapping des onglets (3 vues + legacy)', () => {
  it('conserve les 3 vues canoniques', () => {
    expect(normalizeTab('chat')).toBe('chat')
    expect(normalizeTab('memory')).toBe('memory')
    expect(normalizeTab('agents')).toBe('agents')
  })

  it('mappe les onglets legacy du catalogue précédent', () => {
    expect(normalizeTab('graph')).toBe('memory')
    expect(normalizeTab('roles')).toBe('agents')
  })

  it('replie tout onglet supprimé/inconnu sur chat (jamais de vue morte)', () => {
    for (const legacy of ['orchestration', 'conversations', 'dashboard', 'decisions', 'workflow']) {
      expect(normalizeTab(legacy)).toBe('chat')
    }
    expect(normalizeTab('n-importe-quoi')).toBe('chat')
  })
})
