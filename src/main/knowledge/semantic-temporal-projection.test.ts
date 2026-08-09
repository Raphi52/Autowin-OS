import { describe, expect, it } from 'vitest'
import type { TraceEventV1 } from '../activity/trace-event'
import type { BrainTrace } from '../activity/brain-trace-spool'
import {
  buildSemanticTemporalProjection,
  causalLearningContext
} from './semantic-temporal-projection'

function event(overrides: Partial<TraceEventV1>): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: 'base',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    timestamp: '2026-08-08T10:00:00.000Z',
    sequence: 0,
    type: 'message',
    status: 'completed',
    actor: { id: 'system', kind: 'system', label: 'System' },
    channel: 'internal',
    payloads: [{ kind: 'app-state', content: 'secret content never projected' }],
    observation: { boundary: 'test', fidelity: 'exact' },
    execution: { runId: 'run-1', phase: 'build' },
    ...overrides
  }
}

describe('semantic temporal projection', () => {
  it('is deterministic, input-order independent and links evidence to its decision', () => {
    const evidence = event({ id: 'tool-1', type: 'tool-result', sequence: 1, parentId: 'base' })
    const decision = event({ id: 'gate-1', type: 'gate', sequence: 2, parentId: 'tool-1' })
    const first = buildSemanticTemporalProjection({ events: [decision, evidence, event({})] })
    const second = buildSemanticTemporalProjection({ events: [event({}), evidence, decision] })

    expect(first).toEqual(second)
    expect(JSON.stringify(first)).not.toContain('secret content never projected')
    const evidenceNode = first.nodes.find((node) => node.source.id === 'tool-1')
    const decisionNode = first.nodes.find((node) => node.source.id === 'gate-1')
    expect(first.edges).toContainEqual(
      expect.objectContaining({
        source: evidenceNode?.id,
        target: decisionNode?.id,
        relation: 'supports'
      })
    )
  })

  it('projects only explicit Brain contradiction and supersession relations', () => {
    const brain: BrainTrace = {
      timestamp: '2026-08-08T11:00:00.000Z',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      kind: 'query',
      query: 'A contradicts B in plain text',
      status: 'found',
      injectedChars: 42,
      navigation: {
        query: 'redacted',
        minDense: 0.4,
        candidates: [
          {
            rank: 1,
            path: 'knowledge/a.md',
            type: 'decision',
            denseCos: 0.9,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/b.md' }]
          },
          {
            rank: 2,
            path: 'knowledge/b.md',
            type: 'decision',
            denseCos: 0.8,
            retained: true
          },
          {
            rank: 3,
            path: 'knowledge/c.md',
            type: 'decision',
            denseCos: 0.7,
            retained: true
          }
        ]
      }
    }
    const projection = buildSemanticTemporalProjection({ events: [], brainTraces: [brain] })

    expect(projection.edges.filter((edge) => edge.relation === 'contradicts')).toHaveLength(1)
    expect(JSON.stringify(projection)).not.toContain('A contradicts B in plain text')
  })

  it('ignore une trace Brain structurellement corrompue et conserve les traces valides', () => {
    const valid: BrainTrace = {
      timestamp: '2026-08-08T12:00:00.000Z',
      conversationId: 'conv-valid',
      query: 'secret jamais projete',
      injectedChars: 42,
      status: 'found'
    }
    const corrupt = {
      timestamp: null,
      conversationId: 'conv-corrupt',
      query: 'ne doit pas faire tomber la projection',
      injectedChars: 1
    } as unknown as BrainTrace

    const projection = buildSemanticTemporalProjection({
      events: [],
      brainTraces: [corrupt, valid]
    })

    expect(projection.nodes.some((node) => node.source.conversationId === 'conv-valid')).toBe(true)
    expect(projection.nodes.some((node) => node.source.conversationId === 'conv-corrupt')).toBe(
      false
    )
  })

  it('ignore un evenement structurellement corrompu et conserve les evenements valides', () => {
    const valid = event({ id: 'valid-event', sequence: 1 })
    const corrupt = {
      schema: 'autowin.trace/v1',
      id: 'corrupt-event',
      conversationId: null
    } as unknown as TraceEventV1

    const projection = buildSemanticTemporalProjection({ events: [corrupt, valid] })

    expect(projection.nodes.some((node) => node.source.id === 'valid-event')).toBe(true)
    expect(projection.nodes.some((node) => node.source.id === 'corrupt-event')).toBe(false)
  })

  it('relie une decision a l outcome reel observe par la chaine causale du workflow', () => {
    const decision = event({ id: 'decision-1', type: 'decision', sequence: 1, parentId: 'base' })
    const evidence = event({
      id: 'result-1',
      type: 'tool-result',
      sequence: 2,
      parentId: decision.id
    })
    const outcome = event({
      id: 'outcome-1',
      type: 'gate',
      sequence: 3,
      parentId: evidence.id,
      status: 'failed',
      observation: { boundary: 'Autowin orchestration outcome', fidelity: 'exact' }
    })

    const projection = buildSemanticTemporalProjection({
      events: [outcome, evidence, decision, event({})]
    })
    const decisionNode = projection.nodes.find((node) => node.source.id === decision.id)
    const outcomeNode = projection.nodes.find((node) => node.source.id === outcome.id)

    expect(outcomeNode?.kind).toBe('outcome')
    expect(projection.edges).toContainEqual(
      expect.objectContaining({
        source: decisionNode?.id,
        target: outcomeNode?.id,
        relation: 'observed'
      })
    )
  })

  it('transforme seulement les liens observes en contexte borne pour le workflow suivant', () => {
    const decision = event({
      id: 'decision-context',
      type: 'decision',
      sequence: 1,
      parentId: 'base',
      provider: { id: 'claude', model: 'fable' }
    })
    const outcome = event({
      id: 'outcome-context',
      type: 'gate',
      sequence: 2,
      parentId: decision.id,
      status: 'failed',
      observation: { boundary: 'Autowin orchestration outcome', fidelity: 'exact' }
    })

    const context = causalLearningContext([decision, outcome])

    expect(context).toContain('build · claude/fable · issue failed')
    expect(context).not.toContain('secret content never projected')
  })
})
