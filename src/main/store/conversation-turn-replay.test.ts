import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore, type Conversation } from './conversations'
import { conversationJournalPath, loadConversations } from './conversations-disk'

const dir = mkdtempSync(join(tmpdir(), 'aos-turn-replay-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const TS = 5000

/**
 * DEUX messages assistant partagent le meme `turnId`. C'est le seul cas ou la regle de ciblage
 * compte : ailleurs il n'y a qu'un candidat et les deux regles coincident.
 */
function baseConversation(): Conversation {
  return {
    schemaVersion: 3,
    id: 'conv-1',
    title: 'Deux tours homonymes',
    category: 'claude',
    provider: 'claude',
    messages: [
      { role: 'user', content: 'salut', ts: 1, messageId: 'message-conv-1-1' },
      {
        role: 'assistant',
        content: 'premiere reponse',
        ts: 2,
        messageId: 'message-conv-1-2',
        turnId: 'turn-a',
        status: 'streaming',
        parts: []
      },
      {
        role: 'assistant',
        content: 'seconde reponse',
        ts: 3,
        messageId: 'message-conv-1-3',
        turnId: 'turn-a',
        status: 'streaming',
        parts: []
      }
    ],
    createdAt: 1,
    updatedAt: 3
  } as Conversation
}

describe('reducteur de tour — le rejeu du journal reproduit le direct', () => {
  it('cible le MEME message que le live quand deux messages partagent un turnId', () => {
    const evenements = [
      { kind: 'delta' as const, streamId: 's1', text: 'bonjour' },
      { kind: 'done' as const }
    ]

    // (a) EN DIRECT
    // `resumableTurnIds` neutralise l'avis d'interruption que `hydrate` pose sur un tour laisse
    // `streaming` : c'est un comportement d'HYDRATATION, orthogonal a la regle de ciblage que ce
    // test isole. Sans lui, les deux cotes different pour une raison qui n'est pas le reducteur.
    const reprenables = { resumableTurnIds: new Set(['turn-a']) }
    const live = new ConversationStore(() => TS)
    live.hydrate([baseConversation()], reprenables)
    for (const evenement of evenements) live.applyTurnEvent('conv-1', 'turn-a', evenement)

    // (b) PAR REJEU DU JOURNAL
    const chemin = join(dir, 'conversations.json')
    writeFileSync(chemin, JSON.stringify([baseConversation()], null, 1), 'utf8')
    writeFileSync(
      conversationJournalPath(chemin),
      evenements
        .map((event) =>
          JSON.stringify({
            schema: 'autowin.conversation-change/v1',
            op: 'turn-event',
            id: 'conv-1',
            turnId: 'turn-a',
            event,
            updatedAt: TS
          })
        )
        .join('\n') + '\n',
      'utf8'
    )
    const rejeu = new ConversationStore(() => TS)
    rejeu.hydrate(loadConversations(chemin), reprenables)

    expect(rejeu.get('conv-1')).toEqual(live.get('conv-1'))
  })
})
