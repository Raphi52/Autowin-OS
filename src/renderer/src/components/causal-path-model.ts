import type { HarnessTimelineEvent } from './harness-timeline-model'

export type CausalPathIssue =
  'missing-parent' | 'missing-duration' | 'incomplete-child-timing' | 'causal-cycle'

export interface CausalPathNode {
  id: string
  event: HarnessTimelineEvent
  parentId?: string
  children: CausalPathNode[]
  depth: number
  inclusiveDurationMs?: number
  exclusiveDurationMs?: number
  issues: CausalPathIssue[]
  onCriticalPath: boolean
  isBottleneck: boolean
}

/** Aplatit l'arbre causal en liste préfixe (parent avant ses descendants). */
export function flattenCausalNodes(nodes: readonly CausalPathNode[]): CausalPathNode[] {
  return nodes.flatMap((node) => [node, ...flattenCausalNodes(node.children)])
}

export interface CausalPath {
  roots: CausalPathNode[]
  byId: Map<string, CausalPathNode>
  criticalPathIds: string[]
  bottleneckId?: string
}

function observedDuration(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value >= 0 ? value : undefined
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function cycleMembers(node: CausalPathNode, byId: Map<string, CausalPathNode>): Set<string> {
  const order: string[] = []
  const positions = new Map<string, number>()
  let current: CausalPathNode | undefined = node
  while (current?.parentId) {
    const seenAt = positions.get(current.id)
    if (seenAt != null) return new Set(order.slice(seenAt))
    positions.set(current.id, order.length)
    order.push(current.id)
    current = byId.get(current.parentId)
  }
  return new Set()
}

function coveredChildDuration(parent: CausalPathNode): number | undefined {
  if (parent.children.length === 0) return 0
  const parentStart = timestampMs(parent.event.timestamp)
  const parentDuration = parent.inclusiveDurationMs
  if (parentStart == null || parentDuration == null) return undefined
  const parentEnd = parentStart + parentDuration
  const intervals: Array<[number, number]> = []
  for (const child of parent.children) {
    const start = timestampMs(child.event.timestamp)
    const duration = child.inclusiveDurationMs
    if (start == null || duration == null) return undefined
    const clippedStart = Math.max(parentStart, start)
    const clippedEnd = Math.min(parentEnd, start + duration)
    if (clippedEnd > clippedStart) intervals.push([clippedStart, clippedEnd])
  }
  intervals.sort((a, b) => a[0] - b[0])
  let covered = 0
  let start: number | undefined
  let end: number | undefined
  for (const [nextStart, nextEnd] of intervals) {
    if (start == null || end == null) {
      start = nextStart
      end = nextEnd
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd)
    } else {
      covered += end - start
      start = nextStart
      end = nextEnd
    }
  }
  return start == null || end == null ? 0 : covered + end - start
}

function bestPath(node: CausalPathNode): { score: number; nodes: CausalPathNode[] } {
  const childPaths = node.children.map(bestPath).sort((a, b) => b.score - a.score)
  const child = childPaths[0]
  return {
    score: (node.exclusiveDurationMs ?? 0) + (child?.score ?? 0),
    nodes: [node, ...(child?.nodes ?? [])]
  }
}

export function buildCausalPath(events: readonly HarnessTimelineEvent[]): CausalPath {
  const byId = new Map<string, CausalPathNode>()
  for (const event of events) {
    const duration = observedDuration(event.durationMs)
    byId.set(event.id, {
      id: event.id,
      event,
      parentId: event.parentId,
      children: [],
      depth: 0,
      inclusiveDurationMs: duration,
      exclusiveDurationMs: undefined,
      issues: duration == null ? ['missing-duration'] : [],
      onCriticalPath: false,
      isBottleneck: false
    })
  }

  const cycles = new Set<string>()
  for (const node of byId.values()) for (const id of cycleMembers(node, byId)) cycles.add(id)

  const roots: CausalPathNode[] = []
  for (const node of byId.values()) {
    if (cycles.has(node.id)) {
      node.issues.push('causal-cycle')
      roots.push(node)
      continue
    }
    if (!node.parentId) {
      roots.push(node)
      continue
    }
    const parent = byId.get(node.parentId)
    if (!parent) {
      node.issues.push('missing-parent')
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

  const assignDepth = (node: CausalPathNode, depth: number): void => {
    node.depth = depth
    for (const child of node.children) assignDepth(child, depth + 1)
  }
  for (const root of roots) assignDepth(root, 0)

  for (const node of byId.values()) {
    if (node.inclusiveDurationMs == null) continue
    const covered = coveredChildDuration(node)
    if (covered == null) {
      node.issues.push('incomplete-child-timing')
      continue
    }
    node.exclusiveDurationMs = Math.max(0, node.inclusiveDurationMs - covered)
  }

  const rootPaths = roots.map(bestPath).sort((a, b) => b.score - a.score)
  const critical = rootPaths[0]?.nodes ?? []
  for (const node of critical) node.onCriticalPath = true
  const bottleneck = critical
    .filter((node) => node.exclusiveDurationMs != null)
    .sort((a, b) => (b.exclusiveDurationMs ?? 0) - (a.exclusiveDurationMs ?? 0))[0]
  if (bottleneck) bottleneck.isBottleneck = true

  return {
    roots,
    byId,
    criticalPathIds: critical.map((node) => node.id),
    bottleneckId: bottleneck?.id
  }
}
