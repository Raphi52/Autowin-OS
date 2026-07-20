import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationEventStore } from './conversation-event-store'

const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-events-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('ConversationEventStore', () => {
  it('persists an append-only causal chain across restart', () => {
    const first = new ConversationEventStore(root)
    first.append({
      eventId: 'event-1',
      conversationId: 'conv-1',
      branchId: 'branch-conv-1-root',
      turnId: 'turn-1',
      kind: 'turn.started',
      ts: 10
    })
    first.append({
      eventId: 'event-2',
      parentEventId: 'event-1',
      conversationId: 'conv-1',
      branchId: 'branch-conv-1-root',
      turnId: 'turn-1',
      kind: 'turn.completed',
      ts: 11
    })

    const restarted = new ConversationEventStore(root)
    expect(restarted.list('conv-1').map((event) => event.eventId)).toEqual(['event-1', 'event-2'])
  })

  it('rejects duplicate identities and missing causal parents', () => {
    const store = new ConversationEventStore(join(root, 'guards'))
    const rootEvent = {
      eventId: 'event-root',
      conversationId: 'conv-2',
      branchId: 'branch-conv-2-root',
      turnId: 'turn-2',
      kind: 'turn.started',
      ts: 20
    }
    store.append(rootEvent)

    expect(() => store.append(rootEvent)).toThrow('duplicate eventId')
    expect(() =>
      store.append({
        ...rootEvent,
        eventId: 'event-orphan',
        parentEventId: 'event-missing'
      })
    ).toThrow('missing parentEventId')
  })

  it('refuses a conversation identifier that could escape the store root', () => {
    const store = new ConversationEventStore(join(root, 'paths'))
    expect(() =>
      store.append({
        eventId: 'event-escape',
        conversationId: '../escape',
        branchId: 'branch-root',
        kind: 'turn.started',
        ts: 1
      })
    ).toThrow('invalid conversationId')
  })
})
