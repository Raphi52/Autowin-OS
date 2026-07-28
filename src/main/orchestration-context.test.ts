import { describe, expect, it } from 'vitest'
import { collectOrchestrationContext } from './orchestration-context'

describe('collecte de contexte d’orchestration', () => {
  it('porte conversation, état et workflows ouverts avant le framing', () => {
    const context = collectOrchestrationContext({
      task: 'implémenter une évolution',
      conversation: { id: 'conv-1', title: 'Paiement', runPaths: ['C:/workflow/RUN.md'] },
      app: { tab: 'workflows', pendingDecisions: [{ id: 'd1', question: 'continuer ?' }] },
      runs: [{ subject: 'paiement', status: 'open', blocked: false }]
    })
    expect(context).toMatch(/^\[COLLECTE DE CONTEXTE/)
    expect(context).toContain('Conversation: conv-1 — Paiement')
    expect(context).toContain('Workflows attachés: 1')
    expect(context).toContain('paiement (open)')
  })

  it('conserve un fallback explicite quand une source est indisponible', () => {
    const context = collectOrchestrationContext({ task: 'tâche', unavailable: ['état application'] })
    expect(context).toContain('Runs en cours/bloqués: aucun observé')
    expect(context).toContain('Sources indisponibles (fallback sûr): état application')
  })
})
