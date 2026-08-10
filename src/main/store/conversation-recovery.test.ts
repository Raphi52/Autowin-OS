import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ConversationPersistenceError,
  loadConversations,
  saveConversations
} from './conversations-disk'
import { ConversationStore } from './conversations'

const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-recovery-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('conversation persistence recovery', () => {
  it('recovers an interrupted save from the valid temporary snapshot', () => {
    const path = join(root, 'recover.json')
    writeFileSync(path, '{broken', 'utf8')
    writeFileSync(
      `${path}.tmp`,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-1',
          title: 'Recovered',
          category: 'codex',
          provider: 'codex',
          messages: [],
          workspaceId: 'workspace-conv-1',
          createdAt: 1,
          updatedAt: 1
        }
      ]),
      'utf8'
    )

    expect(loadConversations(path)).toMatchObject([{ id: 'conv-1', title: 'Recovered' }])
  })

  it('raises an explicit typed error instead of converting corruption to empty history', () => {
    const path = join(root, 'unrecoverable.json')
    writeFileSync(path, '{broken', 'utf8')
    writeFileSync(`${path}.tmp`, '{also-broken', 'utf8')

    expect(() => loadConversations(path)).toThrow(ConversationPersistenceError)
  })

  it('recovers from the temporary snapshot when the primary JSON has invalid conversation items', () => {
    const path = join(root, 'structurally-invalid.json')
    writeFileSync(path, JSON.stringify([{}]), 'utf8')
    writeFileSync(
      `${path}.tmp`,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-recovered',
          title: 'Recovered structurally',
          category: 'codex',
          provider: 'codex',
          messages: [],
          workspaceId: 'workspace-conv-recovered',
          createdAt: 1,
          updatedAt: 1
        }
      ]),
      'utf8'
    )

    expect(loadConversations(path)).toMatchObject([
      { id: 'conv-recovered', title: 'Recovered structurally' }
    ])
  })

  it('raises a typed error when conversation items are structurally invalid', () => {
    const path = join(root, 'structurally-invalid-without-recovery.json')
    writeFileSync(path, JSON.stringify([{}]), 'utf8')

    expect(() => loadConversations(path)).toThrow(ConversationPersistenceError)
  })

  it.each([
    ['parts', { parts: [null] }],
    ['attachments', { attachments: [null] }]
  ])('recovers when a message contains invalid nested %s', (_field, invalidNestedField) => {
    const path = join(root, `invalid-nested-${_field}.json`)
    writeFileSync(
      path,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-invalid-primary',
          title: 'Invalid primary',
          category: 'codex',
          provider: 'codex',
          messages: [
            {
              role: 'assistant',
              content: '',
              ts: 1,
              status: 'streaming',
              ...invalidNestedField
            }
          ],
          workspaceId: 'workspace-invalid-primary',
          createdAt: 1,
          updatedAt: 1
        }
      ]),
      'utf8'
    )
    writeFileSync(
      `${path}.tmp`,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-recovered-nested',
          title: 'Recovered nested',
          category: 'codex',
          provider: 'codex',
          messages: [],
          workspaceId: 'workspace-conv-recovered-nested',
          createdAt: 2,
          updatedAt: 2
        }
      ]),
      'utf8'
    )

    expect(loadConversations(path)).toMatchObject([
      { id: 'conv-recovered-nested', title: 'Recovered nested' }
    ])
  })

  it.each([
    [
      'duplicate-conversation-id',
      [
        { id: 'conv-duplicate', title: 'First', messages: [] },
        { id: 'conv-duplicate', title: 'Second', messages: [] }
      ]
    ],
    [
      'duplicate-message-id',
      [
        {
          id: 'conv-primary',
          title: 'Duplicate message',
          messages: [
            { role: 'user', content: 'one', ts: 1, messageId: 'message-same' },
            { role: 'assistant', content: 'two', ts: 2, messageId: 'message-same' }
          ]
        }
      ]
    ]
  ])('recovers when identifiers are incoherent: %s', (name, primaryConversations) => {
    const path = join(root, `${name}.json`)
    const complete = (conversation: (typeof primaryConversations)[number]) => ({
      schemaVersion: 3,
      category: 'codex',
      provider: 'codex',
      workspaceId: `workspace-${conversation.id}`,
      createdAt: 1,
      updatedAt: 1,
      ...conversation
    })
    writeFileSync(path, JSON.stringify(primaryConversations.map(complete)), 'utf8')
    writeFileSync(
      `${path}.tmp`,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-recovered-identifiers',
          title: 'Recovered identifiers',
          category: 'codex',
          provider: 'codex',
          messages: [],
          workspaceId: 'workspace-conv-recovered-identifiers',
          createdAt: 2,
          updatedAt: 2
        }
      ]),
      'utf8'
    )

    expect(loadConversations(path)).toMatchObject([
      { id: 'conv-recovered-identifiers', title: 'Recovered identifiers' }
    ])
  })

  it('loads an old fork with source parent ids and lets hydrate remap its local lineage', () => {
    const path = join(root, 'legacy-fork-parent-ids.json')
    writeFileSync(
      path,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-old-fork',
          title: 'Old fork',
          category: 'codex',
          provider: 'codex',
          messages: [
            { role: 'user', content: 'question', ts: 1, messageId: 'fork-message-1' },
            {
              role: 'assistant',
              content: 'answer',
              ts: 2,
              messageId: 'fork-message-2',
              parentMessageId: 'source-message-1'
            }
          ],
          workspaceId: 'workspace-old-fork',
          createdAt: 1,
          updatedAt: 2
        }
      ]),
      'utf8'
    )

    const store = new ConversationStore()
    expect(store.hydrate(loadConversations(path))).toBe(true)
    expect(store.get('conv-old-fork')?.messages[1].parentMessageId).toBe('fork-message-1')
  })

  it.each([
    ['autoKaizen', { autoKaizen: 42 }],
    ['forkedFrom', { forkedFrom: 42 }]
  ])('recovers when the primary conversation has invalid %s metadata', (name, invalidMetadata) => {
    const path = join(root, `invalid-${name}.json`)
    writeFileSync(
      path,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-invalid-metadata',
          title: 'Invalid metadata',
          category: 'codex',
          provider: 'codex',
          messages: [],
          workspaceId: 'workspace-invalid-metadata',
          createdAt: 1,
          updatedAt: 1,
          ...invalidMetadata
        }
      ]),
      'utf8'
    )
    writeFileSync(
      `${path}.tmp`,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-valid-metadata-recovery',
          title: 'Valid recovery',
          category: 'codex',
          provider: 'codex',
          messages: [],
          workspaceId: 'workspace-valid-metadata-recovery',
          createdAt: 2,
          updatedAt: 2
        }
      ]),
      'utf8'
    )

    expect(loadConversations(path)).toMatchObject([{ id: 'conv-valid-metadata-recovery' }])
  })

  it('raises an explicit typed error when an atomic save cannot be completed', () => {
    const directory = join(root, 'directory-as-file')
    mkdirSync(directory)

    expect(() => saveConversations([], directory)).toThrow(ConversationPersistenceError)
  })
})
