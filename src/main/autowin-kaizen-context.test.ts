import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAutowinKaizenTask, collectAutowinKaizenEvidence } from './autowin-kaizen-context'
import { isMutationTask } from './orchestrator'

describe('buildAutowinKaizenTask', () => {
  it('adapte /kaizen à la conversation et aux preuves Autowin', () => {
    const task = buildAutowinKaizenTask('/kaizen', {
      conversation: {
        id: 'conv-7',
        title: 'Worktrees',
        messages: [
          { role: 'user', content: 'corrige le worktree', ts: 1 },
          { role: 'assistant', content: 'fait', ts: 2 }
        ],
        runPaths: ['C:/Audit/RUN.md']
      },
      activity: [
        {
          ts: '2026-07-27T10:00:00.000Z',
          kind: 'exec',
          label: 'build',
          costUsd: 0.12,
          inputTokens: 100,
          outputTokens: 20
        }
      ],
      brainTraces: [
        {
          timestamp: '2026-07-27T10:00:01.000Z',
          conversationId: 'conv-7',
          query: 'worktree',
          injectedChars: 450
        }
      ],
      causalEvents: [
        {
          timestamp: '2026-07-27T10:00:02.000Z',
          type: 'gate',
          status: 'failed',
          actor: 'judge',
          payload: 'preuve manquante'
        }
      ],
      runs: [{ path: 'C:/Audit/RUN.md', content: '# RUN\nStatus: RED' }]
    })

    expect(task).toContain('/kaizen')
    expect(task).toContain('conv-7')
    expect(task).toContain('corrige le worktree')
    expect(task).toContain('"costUsd":0.12')
    expect(task).toContain('"injectedChars":450')
    expect(task).toContain('preuve manquante')
    expect(task).toContain('Status: RED')
    expect(task).toContain('lecture seule')
    expect(isMutationTask(task)).toBe(false)
  })

  it('ignore les fichiers externes attachés et ne lit que les RUN natifs Autowin', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-runs-'))
    const nativeRun = join(appData, 'runs', 'conv-3', 'native-workspace', 'RUN.md')
    const externalClaude = join(appData, 'CLAUDE.md')
    mkdirSync(join(appData, 'runs', 'conv-3', 'native-workspace'), { recursive: true })
    writeFileSync(nativeRun, 'RUN NATIF AUTOWIN')
    writeFileSync(externalClaude, 'SECRET CLAUDE INTERDIT')
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-3',
          title: 'Audit',
          provider: 'codex',
          messages: [],
          runPaths: [externalClaude],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.runs).toEqual([{ path: nativeRun, content: 'RUN NATIF AUTOWIN' }])
      expect(JSON.stringify(evidence)).not.toContain('SECRET CLAUDE INTERDIT')
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('borne les contenus volumineux', () => {
    const task = buildAutowinKaizenTask('/kaizen cible', {
      conversation: {
        id: 'conv-1',
        title: 'Longue',
        messages: Array.from({ length: 80 }, (_, index) => ({
          role: index % 2 ? ('assistant' as const) : ('user' as const),
          content: `message-${index}-${'x'.repeat(3000)}`,
          ts: index
        }))
      },
      activity: [],
      brainTraces: [],
      causalEvents: [],
      runs: []
    })

    expect(task.length).toBeLessThan(30_000)
    expect(task).toContain('message-79')
    expect(task).not.toContain('message-0-')
  })
})
