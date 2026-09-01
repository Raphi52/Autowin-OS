import { describe, expect, it } from 'vitest'
import { reduceAssistantPilotEvent } from './chat-view-model'

/**
 * Constat utilisateur du 2026-09-01 : le bloc « Réflexion » se remplissait de lignes techniques
 * (« tache de fond en cours », « Bash en cours / 30 s ») qui ne sont PAS le raisonnement du modèle.
 * Elles voyagent désormais sur un canal séparé, qui REMPLACE au lieu d'accumuler.
 */
const base = { turnId: 't1', parts: [], done: false } as unknown as Parameters<
  typeof reduceAssistantPilotEvent
>[0]

describe('chat-view-model — statut provider hors du bloc Réflexion', () => {
  it('range un provider-status dans providerStatus, jamais dans reasoning', () => {
    const apres = reduceAssistantPilotEvent(base, {
      kind: 'provider-status',
      text: 'Bash en cours - 30 s',
      turnId: 't1'
    } as Parameters<typeof reduceAssistantPilotEvent>[1])

    expect(apres.providerStatus).toBe('Bash en cours - 30 s')
    expect(apres.reasoning ?? '').toBe('')
  })

  it('REMPLACE le statut précédent au lieu de l’accumuler', () => {
    const un = reduceAssistantPilotEvent(base, {
      kind: 'provider-status',
      text: 'Bash en cours - 30 s',
      turnId: 't1'
    } as Parameters<typeof reduceAssistantPilotEvent>[1])
    const deux = reduceAssistantPilotEvent(un, {
      kind: 'provider-status',
      text: 'Bash en cours - 1 min',
      turnId: 't1'
    } as Parameters<typeof reduceAssistantPilotEvent>[1])

    expect(deux.providerStatus).toBe('Bash en cours - 1 min')
  })
})
