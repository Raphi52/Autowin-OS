import { describe, expect, it } from 'vitest'
import { ShadowRoutingTraceObserver, type RoutingObservation } from './model-routing-shadow'
import type { TraceEventV1 } from './activity/trace-event'
import { promptCallToTraceEvents } from './activity/prompt-call-trace'
import type { PromptCallRecord } from './activity/prompt-observability'

const now = Date.parse('2026-08-08T12:00:00.000Z')

describe('shadow model router', () => {
  it('n’apprend une réussite qu’après un gate vérifié du même run', () => {
    const appended: RoutingObservation[] = []
    const observer = new ShadowRoutingTraceObserver({
      append: (observation) => {
        appended.push(observation)
        return true
      }
    })
    const modelEvent = {
      schema: 'autowin.trace/v1',
      id: 'model-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      timestamp: '2026-08-08T10:00:00.000Z',
      sequence: 1,
      type: 'model-response',
      status: 'completed',
      actor: { id: 'codex', kind: 'provider', label: 'Codex' },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
      channel: 'assistant',
      payloads: [{ kind: 'model-response', content: 'contenu privé' }],
      observation: { boundary: 'provider', fidelity: 'exact' },
      execution: { runId: 'run-1', phase: 'build' },
      provider: { id: 'codex', model: 'gpt' },
      metrics: { durationMs: 25, costUsd: 0.01 }
    } satisfies TraceEventV1
    observer.observe(modelEvent)
    expect(appended).toEqual([])

    observer.observe({
      ...modelEvent,
      id: 'gate-1',
      sequence: 2,
      type: 'gate',
      status: 'completed',
      provider: undefined,
      execution: { runId: 'run-1' },
      payloads: [{ kind: 'app-state', content: 'green' }]
    })

    expect(appended).toEqual([
      expect.objectContaining({
        phase: 'build',
        provider: 'codex',
        model: 'gpt',
        outcome: 'verified-success',
        durationMs: 25,
        costUsd: 0.01
      })
    ])
  })

  it('compte un appel provider une seule fois malgré ses quatre evenements de trace', () => {
    const appended: RoutingObservation[] = []
    const observer = new ShadowRoutingTraceObserver({
      append: (observation) => {
        appended.push(observation)
        return true
      }
    })
    const call: PromptCallRecord = {
      id: 'call-1',
      ts: '2026-08-08T10:00:00.000Z',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      iteration: 0,
      actor: 'orchestrator',
      provider: 'codex',
      model: 'gpt',
      transport: 'test',
      boundary: 'provider',
      limitation: 'opaque',
      messages: [{ role: 'user', content: 'prive' }],
      options: {},
      response: 'prive'
    }
    const traced = promptCallToTraceEvents(call).map((event) => ({
      ...event,
      execution: { runId: 'run-1', phase: 'build' as const }
    }))
    for (const event of traced) observer.observe(event)
    observer.observe({
      ...traced.at(-1)!,
      id: 'gate-1',
      sequence: 4,
      type: 'gate',
      status: 'completed',
      provider: undefined,
      execution: { runId: 'run-1' },
      payloads: [{ kind: 'app-state', content: 'green' }]
    })

    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({ provider: 'codex', model: 'gpt' })
  })

  it('conserve chaque modele d un fan-out dans la meme phase jusqu au gate', () => {
    const appended: RoutingObservation[] = []
    const observer = new ShadowRoutingTraceObserver({
      append: (observation) => {
        appended.push(observation)
        return true
      }
    })
    const first = {
      schema: 'autowin.trace/v1',
      id: 'model-a',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      timestamp: '2026-08-08T10:00:00.000Z',
      sequence: 1,
      type: 'model-response',
      status: 'completed',
      actor: { id: 'codex', kind: 'provider', label: 'Codex' },
      channel: 'assistant',
      payloads: [{ kind: 'model-response', content: 'prive' }],
      observation: { boundary: 'provider', fidelity: 'exact' },
      execution: { runId: 'run-1', phase: 'build' },
      provider: { id: 'codex', model: 'a' }
    } satisfies TraceEventV1
    observer.observe(first)
    observer.observe({
      ...first,
      id: 'model-b',
      sequence: 2,
      provider: { id: 'claude', model: 'b' }
    })
    observer.observe({
      ...first,
      id: 'gate-1',
      sequence: 3,
      type: 'gate',
      status: 'completed',
      provider: undefined,
      execution: { runId: 'run-1' },
      payloads: [{ kind: 'app-state', content: 'green' }]
    })

    expect(appended.map(({ provider, model }) => `${provider}/${model}`).sort()).toEqual([
      'claude/b',
      'codex/a'
    ])
  })

  it('ne transforme pas l echec d un membre du fan-out en succes du gate global', () => {
    const appended: RoutingObservation[] = []
    const observer = new ShadowRoutingTraceObserver({
      append: (observation) => {
        appended.push(observation)
        return true
      }
    })
    const success = {
      schema: 'autowin.trace/v1',
      id: 'model-ok',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      timestamp: '2026-08-08T10:00:00.000Z',
      sequence: 1,
      type: 'model-response',
      status: 'completed',
      actor: { id: 'codex', kind: 'provider', label: 'Codex' },
      channel: 'assistant',
      payloads: [{ kind: 'model-response', content: 'prive' }],
      observation: { boundary: 'provider', fidelity: 'exact' },
      execution: { runId: 'run-1', phase: 'build' },
      provider: { id: 'codex', model: 'ok' }
    } satisfies TraceEventV1
    observer.observe(success)
    observer.observe({
      ...success,
      id: 'model-ko',
      sequence: 2,
      type: 'error',
      status: 'failed',
      actor: { id: 'claude', kind: 'provider', label: 'Claude' },
      provider: { id: 'claude', model: 'ko' },
      payloads: [{ kind: 'error', content: 'provider unavailable' }]
    })
    observer.observe({
      ...success,
      id: 'gate-1',
      sequence: 3,
      type: 'gate',
      provider: undefined,
      execution: { runId: 'run-1' },
      payloads: [{ kind: 'app-state', content: 'green' }]
    })

    expect(appended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'ok', outcome: 'verified-success' }),
        expect.objectContaining({ model: 'ko', outcome: 'call-failure' })
      ])
    )
  })

  it('evacue les runs sans gate selon une capacite et une TTL bornees', () => {
    const appended: RoutingObservation[] = []
    let clock = now
    const observer = new ShadowRoutingTraceObserver(
      {
        append: (observation) => {
          appended.push(observation)
          return true
        }
      },
      { maxPendingRuns: 2, pendingTtlMs: 100, now: () => clock }
    )
    const modelEvent = {
      schema: 'autowin.trace/v1',
      id: 'model-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      timestamp: '2026-08-08T10:00:00.000Z',
      sequence: 1,
      type: 'model-response',
      status: 'completed',
      actor: { id: 'codex', kind: 'provider', label: 'Codex' },
      channel: 'assistant',
      payloads: [{ kind: 'model-response', content: 'prive' }],
      observation: { boundary: 'provider', fidelity: 'exact' },
      execution: { runId: 'run-1', phase: 'build' },
      provider: { id: 'codex', model: 'gpt' }
    } satisfies TraceEventV1
    observer.observe(modelEvent)
    observer.observe({
      ...modelEvent,
      id: 'model-2',
      execution: { ...modelEvent.execution, runId: 'run-2' }
    })
    observer.observe({
      ...modelEvent,
      id: 'model-3',
      execution: { ...modelEvent.execution, runId: 'run-3' }
    })
    observer.observe({
      ...modelEvent,
      id: 'gate-1',
      type: 'gate',
      provider: undefined,
      execution: { runId: 'run-1' }
    })
    expect(appended).toEqual([])

    clock += 101
    observer.observe({
      ...modelEvent,
      id: 'model-4',
      execution: { ...modelEvent.execution, runId: 'run-4' }
    })
    observer.observe({
      ...modelEvent,
      id: 'gate-2',
      type: 'gate',
      provider: undefined,
      execution: { runId: 'run-2' }
    })
    expect(appended).toEqual([])
  })

  it('borne aussi les routes en attente dans un meme run', () => {
    const appended: RoutingObservation[] = []
    const observer = new ShadowRoutingTraceObserver(
      {
        append: (observation) => {
          appended.push(observation)
          return true
        }
      },
      { maxRoutesPerRun: 2 }
    )
    const base = {
      schema: 'autowin.trace/v1',
      id: 'model-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      timestamp: '2026-08-08T10:00:00.000Z',
      sequence: 1,
      type: 'model-response',
      status: 'completed',
      actor: { id: 'codex', kind: 'provider', label: 'Codex' },
      channel: 'assistant',
      payloads: [{ kind: 'model-response', content: 'prive' }],
      observation: { boundary: 'provider', fidelity: 'exact' },
      execution: { runId: 'run-cap', phase: 'build' },
      provider: { id: 'codex', model: 'gpt' }
    } satisfies TraceEventV1
    observer.observe(base)
    observer.observe({ ...base, id: 'model-2', sequence: 2 })
    observer.observe({ ...base, id: 'model-3', sequence: 3 })
    observer.observe({
      ...base,
      id: 'gate-cap',
      sequence: 4,
      type: 'gate',
      provider: undefined,
      execution: { runId: 'run-cap' }
    })

    expect(appended).toHaveLength(2)
  })
})
