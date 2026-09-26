import { describe, expect, it } from 'vitest'
import { attachPublicationStates } from './runs-scan'
import type { RunEntry } from './runs-scan'

/**
 * Un run peut être VERT, sa DoD complète, et son travail pourtant jamais intégré : l'intégration est
 * retenue (`held`) ou bloquée (`blocked`). Observatory n'avait aucun moyen de le dire — le rail ne
 * connaissait que le statut du RUN.md. Ici on prouve la jointure, et surtout sa RÉSERVE : deux
 * travaux en attente sur la même conversation ne permettent pas de désigner lequel, donc rien n'est
 * affiché plutôt qu'un blocage attribué au mauvais run.
 */
const run = (subject: string, conversationId?: string, session = 'conv-1'): RunEntry => ({
  subject,
  session,
  path: `C:/runs/${subject}/RUN.md`,
  mtime: 1,
  conversationId,
  summary: { status: 'green', dodTotal: 2, dodChecked: 2, journalEvents: 1, defauts: 0 }
})

describe('attachPublicationStates', () => {
  it('nomme en clair l’état de publication retenu du travail de la conversation', () => {
    const [entry] = attachPublicationStates(
      [run('alpha', 'conv-1')],
      [{ conversationId: 'conv-1', publication: 'held' }]
    )
    expect(entry.publication).toBe('held')
    expect(entry.publicationLabel).toBe('retenu')
  })

  it('nomme un travail bloqué avec le vocabulaire de run-interruption', () => {
    const [entry] = attachPublicationStates(
      [run('beta', 'conv-2')],
      [{ conversationId: 'conv-2', publication: 'blocked' }]
    )
    expect(entry.publicationLabel).toBe('bloqué')
  })

  it('retombe sur la session quand le run n’a pas de conversation rattachée', () => {
    const [entry] = attachPublicationStates(
      [run('gamma', undefined, 'conv-3')],
      [{ conversationId: 'conv-3', publication: 'blocked' }]
    )
    expect(entry.publication).toBe('blocked')
  })

  it('n’attache RIEN quand deux travaux de la même conversation attendent', () => {
    const [entry] = attachPublicationStates(
      [run('delta', 'conv-1')],
      [
        { conversationId: 'conv-1', publication: 'held' },
        { conversationId: 'conv-1', publication: 'blocked' }
      ]
    )
    expect(entry.publication).toBeUndefined()
  })

  it('ignore les états de publication qui ne réclament aucune attention', () => {
    const [entry] = attachPublicationStates(
      [run('epsilon', 'conv-1')],
      [{ conversationId: 'conv-1', publication: 'complete' }]
    )
    expect(entry.publicationLabel).toBeUndefined()
  })
})
