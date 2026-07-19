import { describe, expect, it } from 'vitest'
import { normalizeTab } from './tabs'

describe('normalizeTab — mapping des vues canoniques et legacy', () => {
  it('conserve les vues canoniques', () => {
    expect(normalizeTab('chat')).toBe('chat')
    expect(normalizeTab('memory')).toBe('memory')
    expect(normalizeTab('agents')).toBe('agents')
    expect(normalizeTab('observatory')).toBe('observatory')
  })

  it('mappe les onglets legacy du catalogue précédent', () => {
    expect(normalizeTab('graph')).toBe('memory')
    expect(normalizeTab('roles')).toBe('agents')
  })

  it('fusionne tous les anciens accès Harnais et Prompt Load dans Observatoire', () => {
    for (const alias of ['observatoire', 'harness', 'harnais', 'prompt', 'prompt-load']) {
      expect(normalizeTab(alias)).toBe('observatory')
    }
  })

  it('replie tout onglet supprimé/inconnu sur chat (jamais de vue morte)', () => {
    for (const legacy of ['orchestration', 'conversations', 'dashboard', 'decisions', 'workflow']) {
      expect(normalizeTab(legacy)).toBe('chat')
    }
    expect(normalizeTab('n-importe-quoi')).toBe('chat')
  })
})
