import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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

describe('dossier de preuve /kaizen — intégrité', () => {
  function conversationEvent(id: string, sequence: number, content: string): unknown {
    return {
      schema: 'autowin.trace/v1',
      id,
      conversationId: 'conv-9',
      turnId: 'turn-1',
      timestamp: new Date(1_000 + sequence).toISOString(),
      sequence,
      type: 'message',
      status: 'completed',
      actor: { id: 'human', kind: 'human', label: 'Vous' },
      recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
      channel: 'user',
      payloads: [{ kind: 'user-message', content }],
      observation: { boundary: 'renderer', fidelity: 'exact' }
    }
  }

  it('reste relisible en JSON même saturé, et garde la consigne finale', () => {
    const task = buildAutowinKaizenTask('/kaizen ' + 'z'.repeat(5_000), {
      conversation: {
        id: 'conv-8',
        title: 'Saturée',
        messages: Array.from({ length: 60 }, (_, index) => ({
          role: index % 2 ? ('assistant' as const) : ('user' as const),
          content: `message-${index}-${'x'.repeat(4000)}`,
          ts: index
        }))
      },
      activity: Array.from({ length: 60 }, (_, index) => ({
        ts: `2026-07-27T10:00:${String(index).padStart(2, '0')}.000Z`,
        kind: 'exec',
        label: `label-${index}`,
        text: 'y'.repeat(2000)
      })),
      brainTraces: Array.from({ length: 40 }, (_, index) => ({
        timestamp: `2026-07-27T11:00:${String(index).padStart(2, '0')}.000Z`,
        conversationId: 'conv-8',
        query: 'q'.repeat(1500),
        injectedChars: index
      })),
      causalEvents: Array.from({ length: 90 }, (_, index) => ({
        timestamp: `2026-07-27T12:00:00.000Z`,
        type: 'gate',
        status: 'failed',
        actor: 'judge',
        payload: `payload-${index}-${'p'.repeat(800)}`
      })),
      runs: Array.from({ length: 4 }, (_, index) => ({
        path: `C:/runs/run-${index}/RUN.md`,
        content: 'r'.repeat(4000)
      }))
    })

    expect(task.length).toBeLessThanOrEqual(28_000)
    const debut = task.indexOf('=== DOSSIER DE PREUVE AUTOWIN OS ===\n')
    const fin = task.indexOf('\n=== FIN DU DOSSIER ===')
    const json = task.slice(debut + '=== DOSSIER DE PREUVE AUTOWIN OS ===\n'.length, fin)
    const dossier = JSON.parse(json) as { source: string; conversation: { id: string } }
    expect(dossier.source).toBe('autowin-os')
    expect(dossier.conversation.id).toBe('conv-8')
    expect(task.trimEnd().endsWith('approuver.')).toBe(true)
    expect(isMutationTask(task)).toBe(false)
  })

  it('garde les événements causaux valides malgré une ligne corrompue au milieu', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-trace-'))
    mkdirSync(join(appData, 'causal-trace'), { recursive: true })
    writeFileSync(
      join(appData, 'causal-trace', 'conv-9.jsonl'),
      [
        JSON.stringify(conversationEvent('evt-0', 0, 'un')),
        JSON.stringify({ schema: 'autowin.trace/v1' }),
        JSON.stringify(conversationEvent('evt-1', 1, 'deux')),
        JSON.stringify(conversationEvent('evt-2', 2, 'trois'))
      ].join('\n') + '\n'
    )
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-9',
          title: 'Trace',
          provider: 'codex',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.causalEvents.map((event) => event.payload)).toEqual([
        'user-message: un',
        'user-message: deux',
        'user-message: trois'
      ])
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('garde les RUN natifs les plus récents, pas les premiers par ordre alphabétique', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-recents-'))
    // Ordre alphabétique volontairement INVERSE de l'ordre chronologique.
    const noms = ['a-recent', 'b-plus', 'c-moyen', 'd-ancien', 'e-vieux']
    noms.forEach((nom, index) => {
      const dossier = join(appData, 'runs', 'conv-4', `${nom}-workspace`)
      mkdirSync(dossier, { recursive: true })
      const fichier = join(dossier, 'RUN.md')
      writeFileSync(fichier, `RUN ${nom}`)
      const date = new Date(1_000_000_000_000 - index * 60_000)
      utimesSync(fichier, date, date)
      utimesSync(dossier, date, date)
    })
    try {
      const evidence = collectAutowinKaizenEvidence(
        {
          id: 'conv-4',
          title: 'Runs',
          provider: 'codex',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        },
        appData
      )
      expect(evidence.runs.map((run) => run.content)).toEqual([
        'RUN d-ancien',
        'RUN c-moyen',
        'RUN b-plus',
        'RUN a-recent'
      ])
    } finally {
      rmSync(appData, { recursive: true, force: true })
    }
  })
})
