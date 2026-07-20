import { describe, expect, it } from 'vitest'
import { buildCausalPath } from './causal-path-model'
import type { HarnessTimelineEvent } from './harness-timeline-model'

function event(
  id: string,
  durationMs: number | undefined,
  timestamp: string | undefined,
  parentId?: string
): HarnessTimelineEvent {
  return {
    id,
    parentId,
    kind: 'tool-call',
    actor: 'agent',
    label: id,
    content: '',
    detail: '',
    timestamp,
    durationMs,
    payloads: []
  }
}

describe('chemin causal critique', () => {
  it('construit l’arbre et calcule les durées inclusive/exclusive sans compter deux fois les enfants qui se chevauchent', () => {
    const graph = buildCausalPath([
      event('root', 100, '2026-07-20T10:00:00.000Z'),
      event('slow', 60, '2026-07-20T10:00:00.010Z', 'root'),
      event('overlap', 40, '2026-07-20T10:00:00.050Z', 'root'),
      event('leaf', 30, '2026-07-20T10:00:00.020Z', 'slow')
    ])

    expect(graph.roots.map((node) => node.id)).toEqual(['root'])
    expect(graph.byId.get('root')).toMatchObject({
      depth: 0,
      inclusiveDurationMs: 100,
      exclusiveDurationMs: 20
    })
    expect(graph.byId.get('slow')).toMatchObject({
      depth: 1,
      inclusiveDurationMs: 60,
      exclusiveDurationMs: 30
    })
    expect(graph.criticalPathIds).toEqual(['root', 'slow', 'leaf'])
    expect(graph.bottleneckId).toBe('slow')
  })

  it('garde les orphelins visibles et marque les durées non calculables sans les inventer', () => {
    const graph = buildCausalPath([
      event('orphan', 12, '2026-07-20T10:00:00.000Z', 'missing'),
      event('unknown-duration', undefined, '2026-07-20T10:00:00.001Z'),
      event('parent', 50, '2026-07-20T10:00:00.002Z'),
      event('child-without-time', 20, undefined, 'parent')
    ])

    expect(graph.roots.map((node) => node.id)).toEqual(['orphan', 'unknown-duration', 'parent'])
    expect(graph.byId.get('orphan')?.issues).toContain('missing-parent')
    expect(graph.byId.get('unknown-duration')).toMatchObject({
      inclusiveDurationMs: undefined,
      exclusiveDurationMs: undefined,
      issues: ['missing-duration']
    })
    expect(graph.byId.get('parent')?.exclusiveDurationMs).toBeUndefined()
    expect(graph.byId.get('parent')?.issues).toContain('incomplete-child-timing')
  })

  it('isole un cycle invalide au lieu de perdre les événements', () => {
    const graph = buildCausalPath([
      event('a', 10, '2026-07-20T10:00:00.000Z', 'b'),
      event('b', 5, '2026-07-20T10:00:00.001Z', 'a')
    ])

    expect(graph.roots).toHaveLength(2)
    expect(graph.byId.get('a')?.issues).toContain('causal-cycle')
    expect(graph.byId.get('b')?.issues).toContain('causal-cycle')
  })
})
