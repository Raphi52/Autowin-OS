import type { GitGraphCommit, GitGraphRef } from '../../../shared/git-graph'

export interface GitGraphLayoutNode {
  commit: GitGraphCommit
  lane: number
  x: number
  y: number
}

export interface GitGraphLayoutEdge {
  from: GitGraphLayoutNode
  to: GitGraphLayoutNode
  lane: number
}

export interface GitGraphLayout {
  nodes: GitGraphLayoutNode[]
  edges: GitGraphLayoutEdge[]
  width: number
  height: number
}

export function commitsReachableFromRefs(
  commits: GitGraphCommit[],
  refs: GitGraphRef[]
): GitGraphCommit[] {
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const included = new Set<string>()
  const pending = refs.map((ref) => ref.hash)
  while (pending.length > 0) {
    const hash = pending.pop()
    if (!hash || included.has(hash)) continue
    const commit = commitByHash.get(hash)
    if (!commit) continue
    included.add(hash)
    pending.push(...commit.parents)
  }
  return commits.filter((commit) => included.has(commit.hash))
}

export function layoutGitGraph(commits: GitGraphCommit[]): GitGraphLayout {
  const lanes: Array<string | undefined> = []
  const laneByHash = new Map<string, number>()
  const nodes: GitGraphLayoutNode[] = []

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = lanes.findIndex((value) => value === undefined)
      if (lane < 0) lane = lanes.length
    }
    lanes[lane] = commit.parents[0]
    laneByHash.set(commit.hash, lane)
    commit.parents.slice(1).forEach((parent) => {
      if (lanes.includes(parent)) return
      const freeLane = lanes.findIndex((value, index) => index > lane && value === undefined)
      lanes[freeLane < 0 ? lanes.length : freeLane] = parent
    })
    nodes.push({ commit, lane, x: 42 + lane * 64, y: 34 + row * 48 })
  })

  const nodeByHash = new Map(nodes.map((node) => [node.commit.hash, node]))
  const edges = nodes.flatMap((node) =>
    node.commit.parents.flatMap((parent) => {
      const target = nodeByHash.get(parent)
      return target ? [{ from: node, to: target, lane: laneByHash.get(parent) ?? node.lane }] : []
    })
  )
  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1))
  return {
    nodes,
    edges,
    width: Math.max(720, laneCount * 64 + 520),
    height: Math.max(520, nodes.length * 48 + 54)
  }
}
