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
        model: 'gpt-5.6-codex',
        execution: {
          phase: 'build',
          agentId: 'builder-1',
          taskId: 'task-a',
          groupId: 'build-panel'
        },
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
    expect(trace.readConversation('conv-1')[0]).toMatchObject({
      provider: { id: 'codex', model: 'gpt-5.6-codex' },
      execution: {
        phase: 'build',
        agentId: 'builder-1',
        taskId: 'task-a',
        groupId: 'build-panel'
      }
    })
  })

  it('ne transforme pas deux membres d’un fan-out en chaîne causale', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-fanout-'))
    const traceStore = new TraceStore(join(root, 'trace'))
    const context = { conversationId: 'conv-fanout', turnId: 'turn-1', iteration: 0 }
    for (const [agentId, provider, model] of [
      ['scout-a', 'codex', 'gpt-5.6-codex'],
      ['scout-b', 'claude', 'claude-opus-4-8']
    ] as const) {
      persistOrchestrationStep(
        {
          step: 'exec',
          role: 'subagent',
          provider,
          model,
          text: `${agentId} terminé`,
          execution: {
            phase: 'scout',
            agentId,
            taskId: agentId,
            groupId: 'scout-panel'
          }
        },
        context,
        join(root, 'prompts'),
        traceStore
      )
    }

    const events = traceStore.readConversation('conv-fanout')
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.parentId)).toEqual([undefined, undefined])
    expect(events.map((event) => `${event.actor.id}:${event.provider?.id}:${event.provider?.model}`)).toEqual([
      'scout-a:codex:gpt-5.6-codex',
      'scout-b:claude:claude-opus-4-8'
    ])
  })
  it('F6 — persiste la décomposition du system (systemBlocks) dans le record', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-blocks-'))
    const trace = new TraceStore(join(root, 'trace'))
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
          limitation: 'opaque',
          systemBlocks: [
            { name: 'skill:frame', chars: 1200 },
            { name: 'discipline', chars: 300 }
          ]
        }
      },
      { conversationId: 'conv-blocks', turnId: 'turn-1', iteration: 0 },
      join(root, 'prompts'),
      trace
    )
    const call = loadPromptCalls('conv-blocks', join(root, 'prompts'))[0]
    expect(call.systemBlocks).toEqual([
      { name: 'skill:frame', chars: 1200 },
      { name: 'discipline', chars: 300 }
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
  it('identifie une agrégation locale sans lui inventer de provider ni de modèle', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orchestration-local-quorum-'))
    const trace = new TraceStore(join(root, 'trace'))
    persistOrchestrationStep(
      {
        step: 'judge',
        role: 'orchestrator',
        text: 'VALIDE',
        execution: {
          phase: 'judge',
          agentId: 'judge:quorum',
          taskId: 'judge:quorum',
          groupId: 'judge:quorum',
          dependencyIds: ['judge:a', 'judge:b']
        }
      },
      { conversationId: 'conv-quorum', turnId: 'turn-1', iteration: 0 },
      join(root, 'prompts'),
      trace
    )

    const event = trace.readConversation('conv-quorum')[0]
    expect(event).toMatchObject({
      type: 'verdict',
      actor: { id: 'judge:quorum', kind: 'system', label: 'orchestrator' }
    })
    expect(event.provider).toBeUndefined()
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
