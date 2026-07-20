import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ConversationPersistenceError,
  loadConversations,
  saveConversations
} from './conversations-disk'

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
          rootBranchId: 'branch-conv-1-root',
          activeBranchId: 'branch-conv-1-root',
          workspaceId: 'workspace-conv-1',
          branches: [{ id: 'branch-conv-1-root', createdAt: 1 }],
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

  it('raises an explicit typed error when an atomic save cannot be completed', () => {
    const directory = join(root, 'directory-as-file')
    mkdirSync(directory)

    expect(() => saveConversations([], directory)).toThrow(ConversationPersistenceError)
  })
})
