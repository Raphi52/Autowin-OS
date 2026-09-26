/**
 * LE JOURNAL DES ACTIONS SURVIT AU RECHARGEMENT, comme le raisonnement.
 *
 * Défaut mesuré le 2026-09-12 : les lignes du bloc « Actions » ne vivaient que le temps du stream.
 * À la réouverture d'une conversation, le bloc était vide — alors que c'est la seule trace lisible
 * du travail quand la pensée du modèle arrive chiffrée.
 *
 * Entrée qui ferait échouer une correction fausse : un tour DÉJÀ CLOS (`completed`) qui reçoit son
 * journal à la clôture — il doit le garder SANS repasser en `streaming`.
 */
import { describe, expect, it } from 'vitest'
import { reduceChatTurn } from '../../shared/chat-turn'
import { hydrateStoredAssistant } from '../../renderer/src/components/chat-view-model'

describe('journal des actions — conservé par le tour', () => {
  it('entre dans le tour sans changer son statut', () => {
    const apres = reduceChatTurn(
      { turnId: 't1', status: 'completed', parts: [] },
      { kind: 'actions-log', lines: ['Read · src/a.ts', '', '  Bash · npm test  '] }
    )
    expect(apres.actionsLog).toEqual(['Read · src/a.ts', 'Bash · npm test'])
    expect(apres.status).toBe('completed')
  })

  it('réapparaît dans le bloc Actions à la relecture du fil', () => {
    const hydrate = hydrateStoredAssistant({
      content: 'réponse',
      status: 'completed',
      parts: [{ kind: 'text', text: 'réponse' }],
      actionsLog: ['Read · src/a.ts', 'Bash · npm test']
    } as never)
    expect(hydrate.providerStatusLog).toEqual(['Read · src/a.ts', 'Bash · npm test'])
    expect(hydrate.providerStatus).toBe('Bash · npm test')
  })
})
