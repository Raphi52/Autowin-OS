import { describe, expect, it } from 'vitest'
import { appelsDeLOutil } from './appels-outil-detail'

describe('appelsDeLOutil — ce que chaque appel a envoyé et reçu', () => {
  it('rattache chaque retour à l’appel qui le précède, dans l’ordre', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: 'note A' },
        { kind: 'tool-result', content: 'texte A' },
        { kind: 'tool-call', content: 'note B' },
        { kind: 'error', content: 'introuvable' }
      ])
    ).toEqual([
      { envoye: 'note A', retour: 'texte A' },
      { envoye: 'note B', retour: 'introuvable', erreur: true }
    ])
  })

  it('n’invente rien pour un geste écrit sans contenu', () => {
    expect(appelsDeLOutil([{ kind: 'tool-call', content: '' }])).toEqual([])
  })

  it('garde un retour dont l’appel n’a pas de contenu, et ignore les autres genres', () => {
    expect(
      appelsDeLOutil([
        { kind: 'tool-call', content: '' },
        { kind: 'reasoning', content: 'pensée' },
        { kind: 'tool-result', content: 'sortie' }
      ])
    ).toEqual([{ retour: 'sortie' }])
  })
})
