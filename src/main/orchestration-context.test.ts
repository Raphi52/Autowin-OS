import { describe, expect, it } from 'vitest'
import { collectOrchestrationContext } from './orchestration-context'

describe('collecte de contexte d’orchestration', () => {
  it('porte conversation, état et workflows ouverts avant le framing', () => {
    const context = collectOrchestrationContext({
      task: 'implémenter une évolution',
      conversation: { id: 'conv-1', title: 'Paiement', runPaths: ['C:/workflow/RUN.md'] },
      app: { tab: 'workflows' },
      runs: [{ subject: 'paiement', status: 'open', blocked: false }]
    })
    expect(context).toMatch(/^\[COLLECTE DE CONTEXTE/)
    expect(context).toContain('Conversation: conv-1 — Paiement')
    expect(context).toContain('Workflows attachés: 1')
    expect(context).toContain('paiement (open)')
  })

  /**
   * Défaut mesuré le 2026-08-23 sur conv-1376 : le sous-agent recevait la phrase-tâche NUE, sans une
   * ligne du fil qui l'avait produite — le type d'entrée n'avait même pas de champ `messages`. Il ne
   * pouvait donc pas LIRE l'intention de l'utilisateur, seulement la deviner à partir d'une phrase
   * hors contexte. C'est le mécanisme qui fait exécuter la lettre plutôt que le besoin.
   */
  it('porte les échanges récents de la conversation, pour que l’intention soit lisible', () => {
    const context = collectOrchestrationContext({
      task: 'corrige l’historique',
      conversation: {
        id: 'conv-1376',
        messages: [
          { role: 'user', content: 'quand je reviens dans ma conversation je vois plus l’historique' },
          { role: 'assistant', content: 'Diagnostic : le cache est écrasé avant d’être amorcé.' }
        ]
      }
    })
    expect(context).toContain('je vois plus l’historique')
    expect(context).toContain('le cache est écrasé')
  })

  it('borne le fil repris et n’invente aucune fenêtre à lui', () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({
      role: 'user' as const,
      content: `message numéro ${i} ${'x'.repeat(2000)}`
    }))
    const context = collectOrchestrationContext({ task: 't', conversation: { id: 'c', messages } })
    // La fenêtre est celle du routeur (10 derniers messages, 600 caractères) — pas une seconde vérité.
    expect(context).toContain('message numéro 39')
    expect(context).not.toContain('message numéro 29')
    expect(context.split('\n').every((line) => line.length < 700)).toBe(true)
  })

  it('reste tolérant quand la conversation n’a aucun message', () => {
    const vide = collectOrchestrationContext({ task: 't', conversation: { id: 'c', messages: [] } })
    const absent = collectOrchestrationContext({ task: 't', conversation: { id: 'c' } })
    expect(vide).toContain('Conversation: c')
    expect(absent).toContain('Conversation: c')
    expect(vide).not.toContain('Échanges récents')
    expect(absent).not.toContain('Échanges récents')
  })

  it('conserve un fallback explicite quand une source est indisponible', () => {
    const context = collectOrchestrationContext({ task: 'tâche', unavailable: ['état application'] })
    expect(context).toContain('Runs en cours/bloqués: aucun observé')
    expect(context).toContain('Sources indisponibles (fallback sûr): état application')
  })
})
