import { describe, expect, it } from 'vitest'
import { ConversationStore, type Conversation } from './conversations'

const legacyConversation = (): Conversation =>
  ({
    id: 'conv-7',
    title: 'Legacy',
    category: 'codex',
    provider: 'codex',
    messages: [
      { role: 'user', content: 'Question', ts: 10 },
      { role: 'assistant', content: 'Réponse', ts: 11, turnId: 'turn-legacy' }
    ],
    createdAt: 9,
    updatedAt: 11
  }) as Conversation

describe('conversation schema v3', () => {
  it('migrates v2 deterministically with stable branch, workspace and message identities', () => {
    const first = new ConversationStore(() => 100)
    expect(first.hydrate([legacyConversation()])).toBe(true)
    const migrated = structuredClone(first.get('conv-7')!)

    expect(migrated).toMatchObject({
      schemaVersion: 3,
      rootBranchId: 'branch-conv-7-root',
      activeBranchId: 'branch-conv-7-root',
      workspaceId: 'workspace-conv-7',
      authorityMode: 'auto'
    })
    expect(migrated.branches).toEqual([
      { id: 'branch-conv-7-root', createdAt: 9 }
    ])
    expect(migrated.messages.map((message) => message.messageId)).toEqual([
      'message-conv-7-1',
      'message-conv-7-2'
    ])
    expect(migrated.messages.map((message) => message.branchId)).toEqual([
      'branch-conv-7-root',
      'branch-conv-7-root'
    ])
    expect(migrated.messages[1].parentMessageId).toBe('message-conv-7-1')

    const restarted = new ConversationStore(() => 200)
    expect(restarted.hydrate([migrated])).toBe(false)
    expect(restarted.get('conv-7')).toEqual(migrated)
  })

  it('creates new conversations and turns directly in v3 with immutable lineage', () => {
    let now = 1000
    const store = new ConversationStore(() => now++)
    const conversation = store.create({ title: 'Neuve', category: 'codex', provider: 'codex' })
    store.beginTurn(conversation.id, { content: 'Go' }, { turnId: 'turn-new' })

    expect(conversation.schemaVersion).toBe(3)
    expect(conversation.authorityMode).toBe('auto')
    expect(conversation.branches).toHaveLength(1)
    expect(conversation.messages[0]).toMatchObject({
      messageId: 'message-conv-1-1',
      branchId: conversation.rootBranchId
    })
    expect(conversation.messages[1]).toMatchObject({
      messageId: 'message-conv-1-2',
      parentMessageId: 'message-conv-1-1',
      branchId: conversation.rootBranchId,
      turnId: 'turn-new'
    })
  })
})
