import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitReadResult } from '../../shared/git-read'
import {
  appendConversationFileTrace,
  appendExecutionEvidenceFileTrace,
  filterConversationGitState,
  readCurrentConversationPathOwnership,
  readConversationFilePaths
} from './conversation-file-trace-spool'

describe('conversation file trace spool', () => {
  it('isole strictement les chemins par conversation et déduplique leur ordre', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-files-'))
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        workspaceRoot: 'C:/repo-a',
        source: 'edit_file',
        paths: ['src/a.ts']
      },
      root
    )
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:01:00.000Z',
        conversationId: 'conv-b',
        workspaceRoot: 'C:/repo-a',
        source: 'subagent',
        paths: ['src/b.ts']
      },
      root
    )
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:02:00.000Z',
        conversationId: 'conv-a',
        workspaceRoot: 'C:/repo-a',
        source: 'subagent',
        paths: ['src/a.ts', 'src/new.ts']
      },
      root
    )

    expect(readConversationFilePaths('conv-a', root)).toEqual(['src/a.ts', 'src/new.ts'])
    expect(readConversationFilePaths('conv-b', root)).toEqual(['src/b.ts'])
    expect(readConversationFilePaths('conv-new', root)).toEqual([])
  })

  it('ne mélange pas deux dépôts qui ont le même chemin relatif', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-repos-'))
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        workspaceRoot: 'C:/repo-a',
        source: 'edit_file',
        paths: ['src/shared.ts']
      },
      root
    )
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:01:00.000Z',
        conversationId: 'conv-a',
        workspaceRoot: 'C:/repo-b',
        source: 'edit_file',
        paths: ['src/shared.ts', 'src/repo-b.ts']
      },
      root
    )

    expect(readConversationFilePaths('conv-a', root, 'C:/repo-a')).toEqual(['src/shared.ts'])
    expect(readConversationFilePaths('conv-a', root, 'C:/repo-b')).toEqual([
      'src/shared.ts',
      'src/repo-b.ts'
    ])
    expect(readConversationFilePaths('conv-a', root, 'C:/repo-c')).toEqual([])
  })

  it('révoque A quand B remodifie ensuite le même chemin', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-owner-'))
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        workspaceRoot: 'C:/repo',
        source: 'edit_file',
        paths: ['src/foo.ts'],
        pathFingerprints: { 'src/foo.ts': 'fingerprint-a' }
      },
      root
    )
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:01:00.000Z',
        conversationId: 'conv-b',
        workspaceRoot: 'C:/repo',
        source: 'edit_file',
        paths: ['SRC/foo.ts'],
        pathFingerprints: { 'SRC/foo.ts': 'fingerprint-b' }
      },
      root
    )

    expect(readCurrentConversationPathOwnership('conv-a', root)).toEqual([])
    expect(readCurrentConversationPathOwnership('conv-b', root)).toEqual([
      expect.objectContaining({ path: 'SRC/foo.ts', fingerprint: 'fingerprint-b' })
    ])
  })

  it('croise l’attribution avec le diff Git courant et exclut les changements étrangers', () => {
    const git: GitReadResult = {
      available: true,
      state: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [
          { path: 'legacy.ts', status: 'modified', staged: false },
          { path: 'src/a.ts', status: 'modified', staged: false },
          { path: 'src/new.ts', status: 'untracked', staged: false }
        ]
      }
    }

    const filtered = filterConversationGitState(git, ['src/a.ts', 'src/reverted.ts'])
    expect(filtered.state?.changes).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: false }
    ])
    expect(filtered.state?.branch).toBe('main')
  })

  it('compare les chemins sans tenir compte de la casse sur Windows', () => {
    const git: GitReadResult = {
      available: true,
      state: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [{ path: 'src/Foo.ts', status: 'modified', staged: false }]
      }
    }

    expect(filterConversationGitState(git, ['SRC/foo.ts']).state?.changes).toHaveLength(
      process.platform === 'win32' ? 1 : 0
    )
  })

  it('préserve tous les statuts Git courants des chemins attribués', () => {
    const changes = [
      { path: 'created.ts', status: 'untracked' as const, staged: false },
      { path: 'modified.ts', status: 'modified' as const, staged: false },
      { path: 'deleted.ts', status: 'deleted' as const, staged: true },
      { path: 'renamed.ts', status: 'renamed' as const, staged: true }
    ]
    const git: GitReadResult = {
      available: true,
      state: { branch: 'main', ahead: 0, behind: 0, changes }
    }

    expect(
      filterConversationGitState(
        git,
        changes.map((change) => change.path)
      ).state?.changes
    ).toEqual(changes)
  })

  it('conserve les chemins structurés des mutations réussies du sous-agent', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-evidence-'))
    appendExecutionEvidenceFileTrace(
      [
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'deux fichiers',
          paths: ['src/a.ts', 'src/nested/b.ts']
        },
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'failed',
          ok: false,
          summary: 'échec',
          paths: ['src/failed.ts']
        }
      ],
      { conversationId: 'conv-a', turnId: 'turn-a', workspaceRoot: 'C:/repo' },
      root
    )

    expect(readConversationFilePaths('conv-a', root)).toEqual(['src/a.ts', 'src/nested/b.ts'])
  })

  it('conserve une trace active après trois rotations', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-rotations-'))
    appendConversationFileTrace(
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-durable',
        workspaceRoot: 'C:/repo',
        source: 'edit_file',
        paths: ['src/durable.ts']
      },
      root
    )
    const current = join(root, 'conversation-file-trace-spool', 'events.jsonl')
    for (let index = 0; index < 3; index += 1) {
      appendFileSync(current, `${'x'.repeat(4 * 1024 * 1024 + 1)}\n`, 'utf8')
      appendConversationFileTrace(
        {
          timestamp: `2026-07-30T20:0${index + 1}:00.000Z`,
          conversationId: `conv-rotation-${index}`,
          workspaceRoot: 'C:/repo',
          source: 'subagent',
          paths: [`src/rotation-${index}.ts`]
        },
        root
      )
    }

    expect(readConversationFilePaths('conv-durable', root)).toEqual(['src/durable.ts'])
  })
})
