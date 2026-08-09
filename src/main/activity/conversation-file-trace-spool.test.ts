import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitReadResult } from '../../shared/git-read'
import {
  appendConversationFileTrace,
  appendExecutionEvidenceFileTrace,
  filterConversationGitState,
  readCurrentConversationPathOwnership,
  readConversationFilePaths,
  readConversationTurnFileMutations,
  readConversationTurnFilePaths
} from './conversation-file-trace-spool'
import { lineFingerprint } from '../task-manager/watchdog-line'

describe('conversation file trace spool', () => {
  it('deduplique une publication rejouee apres crash par identifiant durable', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-idempotent-publication-'))
    const evidence = [
      {
        type: 'workspace_delta' as const,
        kind: 'mutation' as const,
        status: 'completed' as const,
        ok: true,
        summary: 'delta publie',
        paths: ['logs/app.log'],
        writtenLineFingerprintsByPath: {
          'logs/app.log': [lineFingerprint('ERROR publiee')]
        }
      }
    ]
    const context = {
      conversationId: 'conv-replay',
      turnId: 'turn-replay',
      workspaceRoot: 'C:/repo',
      published: true,
      eventId: `worktree-publication:run-1:${'a'.repeat(40)}`
    }

    expect(appendExecutionEvidenceFileTrace(evidence, context, root)).toBe('appended')
    expect(appendExecutionEvidenceFileTrace(evidence, context, root)).toBe('duplicate')
    expect(
      Object.values(
        readConversationTurnFileMutations('conv-replay', 'turn-replay', root).lineFingerprintsByPath
      )
    ).toEqual([[lineFingerprint('ERROR publiee')]])
  })

  it('conserve un lot causal au dela de 256 empreintes', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-large-claims-'))
    const fingerprints = Array.from({ length: 257 }, (_, index) => lineFingerprint(`line ${index}`))
    appendConversationFileTrace(
      {
        timestamp: '2026-08-08T09:00:00.000Z',
        conversationId: 'conv-large',
        turnId: 'turn-large',
        workspaceRoot: 'C:/repo-large',
        source: 'subagent',
        paths: ['logs/app.log'],
        pathLineFingerprints: { 'logs/app.log': fingerprints }
      },
      root
    )

    const mutations = readConversationTurnFileMutations('conv-large', 'turn-large', root)

    expect(Object.values(mutations.lineFingerprintsByPath)[0]).toEqual(fingerprints)
  })

  it('attribue les chemins absolus au tour exact qui les a modifies', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-turn-files-'))
    appendConversationFileTrace(
      {
        timestamp: '2026-08-08T09:00:00.000Z',
        conversationId: 'conv-a',
        turnId: 'turn-a',
        workspaceRoot: 'C:/repo-a',
        source: 'subagent',
        paths: ['logs/app.log']
      },
      root
    )
    appendConversationFileTrace(
      {
        timestamp: '2026-08-08T09:01:00.000Z',
        conversationId: 'conv-a',
        turnId: 'turn-b',
        workspaceRoot: 'C:/repo-a',
        source: 'subagent',
        paths: ['logs/other.log']
      },
      root
    )
    const expected = resolve('C:/repo-a/logs/app.log').replaceAll('\\', '/')

    expect(readConversationTurnFilePaths('conv-a', 'turn-a', root)).toEqual([
      process.platform === 'win32' ? expected.toLowerCase() : expected
    ])
  })

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
          paths: ['src/a.ts', 'src/nested/b.ts'],
          writtenLineFingerprints: [
            lineFingerprint('ERROR écrite par l’agent'),
            lineFingerprint('ERROR écrite par l’agent')
          ]
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
    const mutations = readConversationTurnFileMutations('conv-a', 'turn-a', root)
    expect(Object.values(mutations.lineFingerprintsByPath)).toEqual([
      [lineFingerprint('ERROR écrite par l’agent'), lineFingerprint('ERROR écrite par l’agent')],
      [lineFingerprint('ERROR écrite par l’agent'), lineFingerprint('ERROR écrite par l’agent')]
    ])
  })

  it('remappe une preuve de worktree sur la base seulement apres publication verte', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-published-'))
    appendExecutionEvidenceFileTrace(
      [
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'revendication outil non validée',
          paths: ['logs/app.log'],
          workspaceRoot: 'C:/worktrees/run-1',
          writtenLineFingerprints: [lineFingerprint('ERROR fantôme')]
        },
        {
          type: 'workspace_delta',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'delta réel',
          paths: ['logs/app.log'],
          workspaceRoot: 'C:/worktrees/run-1',
          writtenLineFingerprintsByPath: {
            'logs/app.log': [lineFingerprint('ERROR publiée')]
          }
        }
      ],
      {
        conversationId: 'conv-published',
        turnId: 'turn-published',
        workspaceRoot: 'C:/repo',
        published: true
      },
      root
    )

    const mutations = readConversationTurnFileMutations('conv-published', 'turn-published', root)
    const basePath = resolve('C:/repo/logs/app.log').replaceAll('\\', '/')
    expect(mutations.lineFingerprintsByPath).toEqual({
      [process.platform === 'win32' ? basePath.toLowerCase() : basePath]: [
        lineFingerprint('ERROR publiée')
      ]
    })
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
