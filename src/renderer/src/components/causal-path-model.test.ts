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

  it('ne désigne aucun chemin critique lorsque les racines ne sont pas comparables', () => {
    const graph = buildCausalPath([
      event('opaque-a', undefined, '2026-07-20T10:00:00.000Z'),
      event('opaque-b', undefined, '2026-07-20T10:00:01.000Z')
    ])

    expect(graph.criticalPathIds).toEqual([])
    expect(graph.bottleneckId).toBeUndefined()
    expect([...graph.byId.values()].every((node) => !node.onCriticalPath)).toBe(true)
  })

  it('refuse un classement global si une seule racine candidate reste opaque', () => {
    const graph = buildCausalPath([
      event('known', 10, '2026-07-20T10:00:00.000Z'),
      event('opaque', undefined, '2026-07-20T10:00:01.000Z')
    ])

    expect(graph.criticalPathIds).toEqual([])
    expect(graph.bottleneckId).toBeUndefined()
  })

  it('refuse aussi un classement quand un cycle coexiste avec une racine valide', () => {
    const descendantOpaque = buildCausalPath([
      event('opaque-root', 100, '2026-07-20T10:00:00.000Z'),
      event('opaque-child', 50, '2026-07-20T10:00:00.010Z', 'opaque-root'),
      event('opaque-grandchild', undefined, '2026-07-20T10:00:00.020Z', 'opaque-child')
    ])

    expect(descendantOpaque.byId.get('opaque-child')?.issues).toContain('incomplete-child-timing')
    expect(descendantOpaque.criticalPathIds).toEqual([])
    expect(descendantOpaque.bottleneckId).toBeUndefined()

    const graph = buildCausalPath([
      event('valid', 50, '2026-07-20T10:00:00.000Z'),
      event('a', 10, '2026-07-20T10:00:00.001Z', 'b'),
      event('b', 5, '2026-07-20T10:00:00.002Z', 'a')
    ])

    expect(graph.criticalPathIds).toEqual([])
    expect(graph.bottleneckId).toBeUndefined()
  })

  it('isole un cycle invalide au lieu de perdre les événements', () => {
    const graph = buildCausalPath([
      event('a', 10, '2026-07-20T10:00:00.000Z', 'b'),
      event('b', 5, '2026-07-20T10:00:00.001Z', 'a')
    ])

    expect(graph.roots).toHaveLength(2)
    expect(graph.byId.get('a')?.issues).toContain('causal-cycle')
    expect(graph.byId.get('b')?.issues).toContain('causal-cycle')
    expect(graph.criticalPathIds).toEqual([])
    expect(graph.bottleneckId).toBeUndefined()
  })
})
