import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendConversationFileTrace,
  appendExecutionEvidenceFileTrace,
  readCurrentConversationPathOwnership,
  readConversationTurnFileMutations,
  readConversationTurnFilePaths,
  readConversationFileTraces
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

    const mutations = readConversationTurnFileMutations('conv-a', 'turn-a', root)
    expect(mutations.paths.map((path) => path.replaceAll('\\', '/'))).toEqual([
      process.platform === 'win32' ? 'c:/repo/src/a.ts' : resolve('C:/repo/src/a.ts'),
      process.platform === 'win32' ? 'c:/repo/src/nested/b.ts' : resolve('C:/repo/src/nested/b.ts')
    ])
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

    expect(
      readCurrentConversationPathOwnership('conv-durable', root).map((item) => item.path)
    ).toEqual(['src/durable.ts'])
  })
})

describe('readConversationFileTraces', () => {
  it('rend les traces de LA conversation demandée, sans celles des autres', () => {
    const base = mkdtempSync(join(tmpdir(), 'file-trace-lecture-'))
    appendConversationFileTrace(
      {
        timestamp: '2026-09-02T10:00:00.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        workspaceRoot: resolve('d:/ws'),
        source: 'edit_file',
        paths: [resolve('d:/ws/src/a.ts')]
      },
      base
    )
    appendConversationFileTrace(
      {
        timestamp: '2026-09-02T10:01:00.000Z',
        conversationId: 'conv-2',
        workspaceRoot: resolve('d:/ws'),
        source: 'subagent',
        paths: [resolve('d:/ws/src/b.ts')]
      },
      base
    )
    const traces = readConversationFileTraces('conv-1', base)
    expect(traces).toHaveLength(1)
    expect(traces[0].turnId).toBe('turn-1')
    expect(traces[0].source).toBe('edit_file')
  })

  it('rend une liste vide quand la conversation n’a rien touché', () => {
    const base = mkdtempSync(join(tmpdir(), 'file-trace-vide-'))
    expect(readConversationFileTraces('conv-inconnue', base)).toEqual([])
  })
})
