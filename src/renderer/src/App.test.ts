import { describe, expect, it } from 'vitest'
import { normalizeTab } from './tabs'

describe('normalizeTab — mapping des vues canoniques et legacy', () => {
  it('conserve les vues canoniques', () => {
    expect(normalizeTab('chat')).toBe('chat')
    expect(normalizeTab('agent-studio')).toBe('agent-studio')
    expect(normalizeTab('knowledge')).toBe('knowledge')
    expect(normalizeTab('observatory')).toBe('observatory')
    expect(normalizeTab('settings')).toBe('settings')
  })

  it('fusionne Models, Topology et OmniRoute dans Agent Studio', () => {
    for (const alias of ['agents', 'roles', 'models', 'router', 'omniroute', 'routeur']) {
      expect(normalizeTab(alias)).toBe('agent-studio')
    }
  })

  it('fusionne Memory, Brain et Graph dans Knowledge', () => {
    for (const alias of ['memory', 'brain', 'graph']) {
      expect(normalizeTab(alias)).toBe('knowledge')
    }
  })

  it('fusionne Capabilities et Behaviour dans Settings', () => {
    for (const alias of ['capabilities', 'skills', 'hooks', 'tools', 'behaviour', 'behavior']) {
      expect(normalizeTab(alias)).toBe('settings')
    }
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
