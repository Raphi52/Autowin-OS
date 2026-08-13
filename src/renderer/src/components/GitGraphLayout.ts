import {
  selectGitGraphMainRef,
  type GitGraphCommit,
  type GitGraphRef
} from '../../../shared/git-graph'

export interface GitGraphLayoutNode {
  commit: GitGraphCommit
  lane: number
  x: number
  y: number
  side?: 'closed' | 'main' | 'open'
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

export interface GitGraphLayoutAxes {
  main: ReadonlySet<string>
  ouvertes: ReadonlySet<string>
}

export interface GitGraphReachability {
  mainLineHashes?: readonly string[]
  mergedIntoMainHashes?: readonly string[]
  openBranchHashes?: readonly string[]
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

export function projectGitGraphAxes(
  commits: GitGraphCommit[],
  refs: GitGraphRef[],
  reachability?: GitGraphReachability
): GitGraphLayoutAxes | undefined {
  const selectedMainRef = selectGitGraphMainRef(refs)
  const mainRef =
    selectedMainRef ??
    (reachability?.mainLineHashes?.[0]
      ? {
          name: 'HEAD',
          fullName: 'HEAD',
          kind: 'local' as const,
          hash: reachability.mainLineHashes[0],
          isHead: true
        }
      : undefined)
  if (!mainRef) return undefined

  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const fusionnesDansMain = new Set(
    reachability?.mergedIntoMainHashes ??
      commitsReachableFromRefs(commits, [mainRef]).map((commit) => commit.hash)
  )
  const main = new Set(reachability?.mainLineHashes ?? [])
  if (!reachability?.mainLineHashes) {
    let hash: string | undefined = mainRef.hash
    while (hash && !main.has(hash)) {
      const commit = commitByHash.get(hash)
      if (!commit) break
      main.add(hash)
      hash = commit.parents[0]
    }
  }

  return {
    main,
    ouvertes:
      reachability?.openBranchHashes !== undefined
        ? new Set(reachability.openBranchHashes)
        : new Set(
            commits
              .filter((commit) => !fusionnesDansMain.has(commit.hash))
              .map((commit) => commit.hash)
          )
  }
}

/**
 * Une voie retient un commit ATTENDU. Elle doit donc être rendue dès que cette attente n'a plus de
 * sens, sans quoi le tracé dérive vers la droite comme s'il y avait un second dépôt.
 *
 * MESURÉ sur ce dépôt (271 commits) : 38 voies occupées, largeur 2 952 px, alors que trois voies
 * simultanées suffisent. 35 de ces voies attendaient un commit DÉJÀ placé ailleurs, et 2 un commit
 * absent de la fenêtre de log. Rows 7 et 8 réservaient `c654ea2` que la voie 0 attendait déjà ; row 13
 * l'a placé en voie 0, et les voies 2 et 3 ont gardé ce hash pour toujours.
 *
 * Deux libérations, et rien de plus : pas de compactage, pas de renumérotation. Une voie qui garde sa
 * position garde la lisibilité verticale d'une branche.
 */
export function layoutGitGraph(
  commits: GitGraphCommit[],
  axes?: GitGraphLayoutAxes
): GitGraphLayout {
  const lanes: Array<string | undefined> = []
  const laneByHash = new Map<string, number>()
  const nodes: GitGraphLayoutNode[] = []
  // Ce qui n'est pas dans la fenêtre lue n'arrivera jamais : inutile de lui garder une voie.
  const presents = new Set(commits.map((commit) => commit.hash))
  const attendable = (hash: string | undefined): string | undefined =>
    hash !== undefined && presents.has(hash) ? hash : undefined

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = lanes.findIndex((value) => value === undefined)
      if (lane < 0) lane = lanes.length
    }
    // LIBÉRATION 1 : toute AUTRE voie qui attendait ce commit ne l'attendra jamais — il est ici.
    lanes.forEach((value, index) => {
      if (index !== lane && value === commit.hash) lanes[index] = undefined
    })
    const premierParent = attendable(commit.parents[0])
    // LIBÉRATION 2 : ne pas réserver DEUX voies pour le même parent. La voie existante le portera ;
    // dupliquer l'attente est exactement ce qui perdait 35 voies.
    const dejaAttendu =
      premierParent !== undefined &&
      lanes.some((value, index) => index !== lane && value === premierParent)
    lanes[lane] = dejaAttendu ? undefined : premierParent
    laneByHash.set(commit.hash, lane)
    commit.parents.slice(1).forEach((parent) => {
      if (!presents.has(parent) || lanes.includes(parent)) return
      const freeLane = lanes.findIndex((value, index) => index > lane && value === undefined)
      lanes[freeLane < 0 ? lanes.length : freeLane] = parent
    })
    nodes.push({ commit, lane, x: 42 + lane * 64, y: 34 + row * 48 })
  })

  const closedLanes = [
    ...new Set(
      nodes
        .filter(
          (node) => !axes?.main.has(node.commit.hash) && !axes?.ouvertes.has(node.commit.hash)
        )
        .map((node) => node.lane)
    )
  ].sort((a, b) => a - b)
  const openLanes = [
    ...new Set(
      nodes.filter((node) => axes?.ouvertes.has(node.commit.hash)).map((node) => node.lane)
    )
  ].sort((a, b) => a - b)
  const mainX = 280 + Math.max(1, closedLanes.length) * 64
  if (axes) {
    nodes.forEach((node) => {
      if (axes.main.has(node.commit.hash)) {
        node.side = 'main'
        node.x = mainX
        return
      }
      if (axes.ouvertes.has(node.commit.hash)) {
        node.side = 'open'
        node.x = mainX + (openLanes.indexOf(node.lane) + 1) * 64
        return
      }
      node.side = 'closed'
      node.x = mainX - (closedLanes.indexOf(node.lane) + 1) * 64
    })
  }

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
    width: axes
      ? Math.max(720, mainX + Math.max(1, openLanes.length) * 64 + 480)
      : Math.max(720, laneCount * 64 + 520),
    height: Math.max(520, nodes.length * 48 + 54)
  }
}
