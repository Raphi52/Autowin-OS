import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aggregateToolUsage } from './tool-usage'
import { persistOrchestrationStep } from './orchestration-observability'
import { TraceStore } from './trace-store'

describe('aggregateToolUsage', () => {
  it('agrège les tool-call réels par type sur toutes les conversations', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-toolusage-'))
    const traceRoot = join(root, 'causal-trace')
    const trace = new TraceStore(traceRoot)
    const evidence = [
      { type: 'command_execution', kind: 'verification' as const, status: 'completed', ok: true, summary: 'npm test\nexit=0' },
      { type: 'file_change', kind: 'mutation' as const, status: 'completed', ok: true, summary: 'apply_patch' }
    ]
    for (const conversationId of ['conv-a', 'conv-b']) {
      persistOrchestrationStep(
        {
          step: 'exec',
          role: 'subagent',
          provider: 'codex',
          text: 'ok',
          prompt: {
            provider: 'codex',
            transport: 'fetch',
            messages: [{ role: 'user', content: 't' }],
            options: {},
            limitation: 'opaque'
          },
          evidence
        },
        { conversationId, turnId: 'turn-1', iteration: 0 },
        join(root, 'prompts'),
        trace
      )
    }
    const usage = aggregateToolUsage(traceRoot)
    const byId = Object.fromEntries(usage.map((u) => [u.id, u.count]))
    expect(byId.verification).toBe(2) // 1 par conversation
    expect(byId.mutation).toBe(2)
    expect(usage.every((u) => u.mutable === false)).toBe(true) // lecture seule
  })

  it('rend une liste vide si aucune trace', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-toolusage-empty-'))
    expect(aggregateToolUsage(join(root, 'nope'))).toEqual([])
  })
})
