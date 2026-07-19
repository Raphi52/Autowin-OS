import { describe, expect, it } from 'vitest'
import {
  centerViewBox,
  DEFAULT_HARNESS_FILTERS,
  filterHarness,
  harnessFilterOptions,
  layoutHarness,
  levelVisible,
  type HarnessEdge,
  type HarnessNode,
  type HarnessSnapshot
} from './harness-model'

function node(partial: Partial<HarnessNode> & Pick<HarnessNode, 'id' | 'layer'>): HarnessNode {
  return {
    kind: 'runtime',
    label: partial.id,
    source: 'ipc',
    state: 'unknown',
    runtime: 'autowin-local',
    level: 'both',
    flows: ['orchestration'],
    order: 0,
    evidence: { source: 'ipc', ref: `${partial.id}.ts` },
    roleDesc: '',
    observed: '',
    notObserved: '',
    references: [],
    ...partial
  }
}

function edge(partial: Partial<HarnessEdge> & Pick<HarnessEdge, 'id' | 'from' | 'to'>): HarnessEdge {
  return {
    kind: 'routes',
    flows: ['orchestration'],
    level: 'both',
    ...partial
  }
}

const snapshot: HarnessSnapshot = {
  generatedAt: '2026-07-19T00:00:00.000Z',
  focusModelId: 'claude-opus',
  providers: ['claude', 'codex'],
  runtimes: ['autowin-local', 'provider', 'shared-brain'],
  caps: { maxNodes: 250, maxEdges: 500, nodeCount: 6, edgeCount: 4, truncated: false },
  nodes: [
    node({ id: 'you', layer: 'runtime', kind: 'you', order: 0, flows: ['chat'] }),
    node({
      id: 'orchestrator',
      layer: 'runtime',
      kind: 'orchestrator',
      order: 2,
      provider: 'claude',
      state: 'healthy',
      flows: ['chat', 'orchestration']
    }),
    node({
      id: 'model',
      layer: 'runtime',
      kind: 'model',
      order: 9,
      focal: true,
      runtime: 'provider',
      provider: 'claude',
      flows: ['chat', 'orchestration']
    }),
    node({
      id: 'scout',
      layer: 'runtime',
      kind: 'scout',
      order: 4,
      level: 'expert',
      provider: 'codex',
      flows: ['orchestration']
    }),
    node({
      id: 'brain',
      layer: 'storage',
      kind: 'brain',
      order: 0,
      runtime: 'shared-brain',
      state: 'healthy',
      flows: ['brain']
    }),
    node({
      id: 'cost',
      layer: 'observability',
      kind: 'cost',
      order: 0,
      state: 'warning',
      flows: ['observability']
    })
  ],
  edges: [
    edge({ id: 'e-you-orch', from: 'you', to: 'orchestrator', kind: 'invokes', flows: ['chat'] }),
    edge({ id: 'e-orch-model', from: 'orchestrator', to: 'model', level: 'beginner' }),
    edge({ id: 'e-orch-scout', from: 'orchestrator', to: 'scout', level: 'expert' }),
    edge({ id: 'e-cost-model', from: 'cost', to: 'model', kind: 'observes', flows: ['observability'] })
  ]
}

describe('levelVisible', () => {
  it('shows both at every level, restricts beginner/expert to their mode', () => {
    expect(levelVisible('both', 'beginner')).toBe(true)
    expect(levelVisible('both', 'expert')).toBe(true)
    expect(levelVisible('expert', 'beginner')).toBe(false)
    expect(levelVisible('beginner', 'expert')).toBe(false)
    expect(levelVisible('beginner', 'beginner')).toBe(true)
  })
})

describe('filterHarness — Débutant/Expert', () => {
  it('beginner hides expert-only nodes and prunes their edges', () => {
    const { nodes, edges } = filterHarness(snapshot, DEFAULT_HARNESS_FILTERS)
    expect(nodes.map((n) => n.id)).not.toContain('scout')
    // l'arête simplifiée beginner reste, la variante expert et l'arête vers scout tombent
    expect(edges.map((e) => e.id)).toContain('e-orch-model')
    expect(edges.map((e) => e.id)).not.toContain('e-orch-scout')
  })

  it('expert reveals expert nodes and hides beginner-only simplifications (no double path)', () => {
    const { nodes, edges } = filterHarness(snapshot, {
      ...DEFAULT_HARNESS_FILTERS,
      level: 'expert'
    })
    expect(nodes.map((n) => n.id)).toContain('scout')
    expect(edges.map((e) => e.id)).toContain('e-orch-scout')
    expect(edges.map((e) => e.id)).not.toContain('e-orch-model')
  })
})

describe('filterHarness — flux / provider / santé / recherche', () => {
  it('filters nodes by flow and drops edges whose endpoints were removed', () => {
    const { nodes, edges } = filterHarness(snapshot, {
      ...DEFAULT_HARNESS_FILTERS,
      level: 'expert',
      flow: 'brain'
    })
    expect(nodes.map((n) => n.id)).toEqual(['brain'])
    expect(edges).toHaveLength(0)
  })

  it('filters by provider', () => {
    const { nodes } = filterHarness(snapshot, {
      ...DEFAULT_HARNESS_FILTERS,
      level: 'expert',
      provider: 'codex'
    })
    expect(nodes.map((n) => n.id)).toEqual(['scout'])
  })

  it('filters by health state', () => {
    const { nodes } = filterHarness(snapshot, {
      ...DEFAULT_HARNESS_FILTERS,
      level: 'expert',
      health: 'warning'
    })
    expect(nodes.map((n) => n.id)).toEqual(['cost'])
  })

  it('marks matched nodes for the query without removing others', () => {
    const { nodes, matched } = filterHarness(snapshot, {
      ...DEFAULT_HARNESS_FILTERS,
      level: 'expert',
      query: 'orchestrator'
    })
    expect(nodes.length).toBeGreaterThan(1)
    expect(matched.has('orchestrator')).toBe(true)
    expect(matched.has('cost')).toBe(false)
  })
})

describe('harnessFilterOptions', () => {
  it('derives distinct providers and runtimes actually present', () => {
    const options = harnessFilterOptions(snapshot)
    expect(options.providers).toEqual(['claude', 'codex'])
    expect(options.runtimes).toContain('shared-brain')
    expect(options.flows).toContain('brain')
  })
})

describe('layoutHarness — déterministe et borné', () => {
  it('centers the focal model in the runtime lane and keeps every position finite and in-bounds', () => {
    const layout = layoutHarness(snapshot.nodes, { width: 1000 })
    for (const node of snapshot.nodes) {
      const pos = layout.positions[node.id]
      expect(pos).toBeDefined()
      expect(Number.isFinite(pos.x)).toBe(true)
      expect(Number.isFinite(pos.y)).toBe(true)
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.x).toBeLessThanOrEqual(1000)
      expect(pos.y).toBeGreaterThanOrEqual(0)
      expect(pos.y).toBeLessThanOrEqual(layout.height)
    }
    // le focal est plus central en x que les extrémités de son couloir
    const runtimeXs = snapshot.nodes
      .filter((n) => n.layer === 'runtime')
      .map((n) => layout.positions[n.id].x)
    const focalX = layout.positions.model.x
    expect(focalX).toBeGreaterThan(Math.min(...runtimeXs))
    expect(focalX).toBeLessThan(Math.max(...runtimeXs))
  })

  it('stacks the four lanes in canonical order without overlap', () => {
    const layout = layoutHarness(snapshot.nodes)
    expect(layout.lanes.map((l) => l.layer)).toEqual([
      'runtime',
      'configuration',
      'storage',
      'observability'
    ])
    for (let i = 1; i < layout.lanes.length; i++) {
      expect(layout.lanes[i].y).toBeGreaterThanOrEqual(
        layout.lanes[i - 1].y + layout.lanes[i - 1].height - 0.001
      )
    }
  })

  it('is stable: same input yields identical positions', () => {
    const a = layoutHarness(snapshot.nodes, { width: 1200 })
    const b = layoutHarness(snapshot.nodes, { width: 1200 })
    expect(a.positions).toEqual(b.positions)
  })
})

describe('centerViewBox', () => {
  it('returns the top-left corner that centers a point in the viewport', () => {
    expect(centerViewBox({ x: 100, y: 50 }, 40, 20)).toEqual({ x: 80, y: 40 })
  })
})
