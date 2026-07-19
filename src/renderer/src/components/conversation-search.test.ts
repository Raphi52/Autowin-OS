import { describe, expect, it } from 'vitest'
import { searchConversations, type ConversationSearchSource } from './conversation-search'

const conversations: ConversationSearchSource[] = [
  {
    id: 'recent-message',
    title: 'Revue technique',
    category: 'claude',
    provider: 'claude',
    updatedAt: 30,
    messages: [
      { role: 'user', content: 'Cherche la stratégie de déploiement Windows', ts: 10 },
      { role: 'assistant', content: 'Le déploiement atomique est retenu.', ts: 20 }
    ]
  },
  {
    id: 'title',
    title: 'Déploiement production',
    category: 'codex',
    provider: 'codex',
    updatedAt: 20,
    messages: []
  },
  {
    id: 'other',
    title: 'Interface Agents',
    category: 'hermes',
    provider: 'hermes',
    updatedAt: 40,
    messages: [{ role: 'user', content: 'Améliorer la lisibilité', ts: 40 }]
  }
]

describe('conversation search', () => {
  it('returns the normal list when the query is empty', () => {
    expect(searchConversations(conversations, '').map((hit) => hit.conversation.id)).toEqual([
      'recent-message',
      'title',
      'other'
    ])
  })

  it('searches titles and messages without accents or case sensitivity', () => {
    const hits = searchConversations(conversations, 'DEPLOIEMENT')
    expect(hits.map((hit) => [hit.conversation.id, hit.matchedIn])).toEqual([
      ['title', 'title'],
      ['recent-message', 'message']
    ])
    expect(hits[1].snippet).toContain('déploiement atomique')
  })

  it('requires every query word in one title or one message', () => {
    expect(
      searchConversations(conversations, 'strategie windows').map((hit) => hit.conversation.id)
    ).toEqual(['recent-message'])
    expect(searchConversations(conversations, 'windows atomique')).toEqual([])
  })

  it('bounds results', () => {
    expect(searchConversations(conversations, '', 2)).toHaveLength(2)
  })

  it('ignores malformed persisted fields instead of breaking the search', () => {
    const malformed = {
      ...conversations[0],
      title: undefined,
      messages: [{ role: 'user', content: undefined, ts: 1 }]
    } as unknown as ConversationSearchSource

    expect(() => searchConversations([malformed], 'déploiement')).not.toThrow()
    expect(searchConversations([malformed], 'déploiement')).toEqual([])
  })
})
