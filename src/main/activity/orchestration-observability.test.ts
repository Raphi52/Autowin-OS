import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPromptCalls } from './prompt-observability'
import { persistOrchestrationStep } from './orchestration-observability'
import { TraceStore } from './trace-store'

describe('observabilite orchestration', () => {
  it('persiste les appels sous-agent et juge dans le journal causal', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-'))
    const trace = new TraceStore(join(root, 'trace'))
    persistOrchestrationStep(
      {
        step: 'exec',
        role: 'subagent',
        provider: 'codex',
        text: 'fait',
        prompt: {
          provider: 'codex',
          transport: 'fetch',
          messages: [{ role: 'user', content: 'tache' }],
          options: {},
          limitation: 'opaque'
        },
        usage: { inputTokens: 5, outputTokens: 2 }
      },
      { conversationId: 'conv-1', turnId: 'turn-1', iteration: 0 },
      join(root, 'prompts'),
      trace
    )
    expect(loadPromptCalls('conv-1', join(root, 'prompts'))).toHaveLength(1)
    expect(trace.readConversation('conv-1').map((event) => event.type)).toEqual([
      'handoff',
      'message',
      'injection',
      'boundary',
      'model-response'
    ])
  })
  it('G1/G3 — persiste les actions reelles (evidence) comme evenements tool-call', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-tools-'))
    const trace = new TraceStore(join(root, 'trace'))
    persistOrchestrationStep(
      {
        step: 'exec',
        role: 'subagent',
        provider: 'codex',
        text: 'fait',
        prompt: {
          provider: 'codex',
          transport: 'fetch',
          messages: [{ role: 'user', content: 'tache' }],
          options: {},
          limitation: 'opaque'
        },
        evidence: [
          { type: 'command_execution', kind: 'verification', status: 'completed', ok: true, summary: 'npm test\nexit=0' },
          { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'apply_patch' }
        ]
      },
      { conversationId: 'conv-tools', turnId: 'turn-1', iteration: 0 },
      join(root, 'prompts'),
      trace
    )
    const events = trace.readConversation('conv-tools')
    const toolEvents = events.filter((e) => e.type === 'tool-call')
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents.every((e) => e.actor.kind === 'tool')).toBe(true)
    expect(toolEvents[0].parentId).toBe(events.find((e) => e.type === 'handoff')?.id)
  })
  it('persiste verdict puis gate meme lorsque le gate ne fait aucun appel provider', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-gate-'))
    const trace = new TraceStore(join(root, 'trace'))
    const context = { conversationId: 'conv-1', turnId: 'turn-1', iteration: 0 }
    persistOrchestrationStep(
      {
        step: 'judge',
        role: 'judge',
        provider: 'codex',
        text: 'DEFAUT: test',
        prompt: {
          provider: 'codex',
          transport: 'fetch',
          messages: [{ role: 'user', content: 'juge' }],
          options: {},
          limitation: 'opaque'
        }
      },
      context,
      join(root, 'prompts'),
      trace
    )
    persistOrchestrationStep(
      { step: 'gate', detail: 'BLOQUE: verdict rouge' },
      { ...context, iteration: 1 },
      join(root, 'prompts'),
      trace
    )
    const events = trace.readConversation('conv-1')
    expect(events.map((event) => event.type)).toEqual([
      'message',
      'injection',
      'boundary',
      'model-response',
      'verdict',
      'gate'
    ])
    expect(events.at(-1)?.parentId).toBe(events.at(-2)?.id)
  })
  it('persiste une tentative provider echouee', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-failed-'))
    const trace = new TraceStore(join(root, 'trace'))
    persistOrchestrationStep(
      {
        step: 'exec',
        role: 'subagent',
        provider: 'claude',
        text: '',
        status: 'failed',
        error: 'CLI exit 1',
        prompt: {
          provider: 'claude',
          transport: 'spawn',
          messages: [{ role: 'user', content: 'tache' }],
          options: {},
          limitation: 'opaque'
        }
      },
      { conversationId: 'conv-1', turnId: 'turn-1', iteration: 0 },
      join(root, 'prompts'),
      trace
    )
    expect(loadPromptCalls('conv-1', join(root, 'prompts'))[0]).toMatchObject({
      status: 'failed',
      error: 'CLI exit 1'
    })
    expect(trace.readConversation('conv-1').at(-1)).toMatchObject({
      type: 'error',
      status: 'failed'
    })
  })
})
