export type GraphNode = {
  id: string
  label: string
  group: number
  file?: string
  themes?: string[]
  x?: number
  y?: number
  z?: number
}
export type GraphLink = {
  source: string | GraphNode
  target: string | GraphNode
  weight: number
  relation?: string
}
export type GraphData = { nodes: GraphNode[]; links: GraphLink[]; totalNodes?: number }
export type GraphVisualMode = 'serious' | 'galaxy'
export type GraphVisualProfile = {
  modeClass: string
  background: string
  linkBase: string
  linkHighlight: string
  linkOpacity: number
  nodeScale: number
  palette: readonly string[]
}
export type ThemeDefinition = { id: string; label: string }
export type ThemeSummary = ThemeDefinition & { count: number }
export type GraphCatalogSearch = { themes: ThemeSummary[]; nodes: GraphNode[] }
export type ThemeClusterAnchor = ThemeDefinition & {
  x: number
  y: number
  z: number
  count: number
}
export type LinkedNode = { node: GraphNode; direction: 'incoming' | 'outgoing'; relation?: string }
export type GalaxyNodeAppearance = { color: string; opacity: number }

export const GRAPH_PALETTE = [
  '#75d7ff',
  '#8befbd',
  '#f8bd67',
  '#ca9cff',
  '#ff7e7e',
  '#7588ff',
  '#e7dd72'
]

export const GALAXY_PALETTE = GRAPH_PALETTE

export const DEFAULT_GRAPH_NODE_SPACING = 72

export function graphMotionProfile(): { warmupTicks: number; cooldownTicks: number } {
  return { warmupTicks: 80, cooldownTicks: 0 }
}

export function normalizeGraphNodeSpacing(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_GRAPH_NODE_SPACING
  const spacing = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(spacing)) return DEFAULT_GRAPH_NODE_SPACING
  return Math.round(Math.min(240, Math.max(30, spacing)))
}

export function graphForcesForSpacing(value: unknown): {
  linkDistance: number
  chargeStrength: number
} {
  const spacing = normalizeGraphNodeSpacing(value)
  return { linkDistance: spacing, chargeStrength: -spacing * 2 }
}

export function nextGraphFitRequest(currentRequest: number): number {
  return currentRequest + 1
}

export function isCurrentGraphFitRequest(
  scheduledRequest: number,
  currentRequest: number
): boolean {
  return scheduledRequest === currentRequest
}

const GRAPH_VISUAL_PROFILES: Record<GraphVisualMode, GraphVisualProfile> = {
  serious: {
    modeClass: 'graph-observatory--serious',
    background: '#000000',
    linkBase: '#263542',
    linkHighlight: '#5a9f80',
    linkOpacity: 0.45,
    nodeScale: 1,
    palette: GRAPH_PALETTE
  },
  galaxy: {
    modeClass: 'graph-observatory--galaxy',
    background: 'rgba(0,0,0,0)',
    linkBase: '#35336f',
    linkHighlight: '#ff5dde',
    linkOpacity: 0.56,
    nodeScale: 1.18,
    palette: GALAXY_PALETTE
  }
}

export function getGraphVisualProfile(mode: GraphVisualMode): GraphVisualProfile {
  return GRAPH_VISUAL_PROFILES[mode]
}

export function buildThemeSummaries(
  nodes: GraphNode[],
  declaredThemes: ThemeDefinition[] = []
): ThemeSummary[] {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    for (const theme of nodeThemeIds(node)) counts.set(theme, (counts.get(theme) ?? 0) + 1)
  }
  if (declaredThemes.length > 0) {
    const declaredIds = new Set(declaredThemes.map((theme) => theme.id))
    const dynamicThemes = [...counts.entries()]
      .filter(([id]) => id.startsWith('theme/') && !declaredIds.has(id))
      .map(([id, count]) => ({ id, label: themeLabel(id), count }))
      .sort((a, b) => a.id.localeCompare(b.id))
    return [
      ...declaredThemes.map((theme) => ({ ...theme, count: counts.get(theme.id) ?? 0 })),
      ...dynamicThemes
    ]
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: themeLabel(id), count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

export function searchGraphCatalog(
  rawQuery: string,
  nodes: readonly GraphNode[],
  themes: readonly ThemeSummary[],
  limit = 30
): GraphCatalogSearch {
  const query = rawQuery.trim().toLocaleLowerCase('fr')
  if (!query) return { themes: [...themes], nodes: [] }

  const includesQuery = (value: string): boolean => value.toLocaleLowerCase('fr').includes(query)
  return {
    themes: themes.filter((theme) => includesQuery(`${theme.label} ${theme.id}`)).slice(0, limit),
    nodes: nodes
      .filter((node) => includesQuery(`${node.label} ${node.id} ${node.file ?? ''}`))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
      .slice(0, limit)
  }
}

export function themeClusterAnchors(
  nodes: readonly GraphNode[],
  themes: readonly ThemeDefinition[]
): ThemeClusterAnchor[] {
  return themes.flatMap((theme) => {
    const positioned = nodes.filter(
      (node) =>
        nodeThemeIds(node).includes(theme.id) &&
        typeof node.x === 'number' &&
        typeof node.y === 'number' &&
        typeof node.z === 'number'
    )
    if (positioned.length === 0) return []

    const x = positioned.reduce((sum, node) => sum + (node.x as number), 0) / positioned.length
    const z = positioned.reduce((sum, node) => sum + (node.z as number), 0) / positioned.length
    const sortedY = positioned.map((node) => node.y as number).sort((a, b) => a - b)
    const y = sortedY[Math.min(sortedY.length - 1, Math.floor(sortedY.length * 0.9))] + 12
    return [{ ...theme, x, y, z, count: positioned.length }]
  })
}

export function visibleThemeClusterIds(
  themes: readonly ThemeDefinition[],
  activeThemes: ReadonlySet<string>,
  selectedNode: GraphNode | null
): string[] {
  if (selectedNode) return []
  return themes
    .filter((theme) => activeThemes.size === 0 || activeThemes.has(theme.id))
    .map((theme) => theme.id)
}

export function toggleThemeSelection(current: ReadonlySet<string>, theme: string): Set<string> {
  const next = new Set(current)
  if (next.has(theme)) next.delete(theme)
  else next.add(theme)
  return next
}

export function highlightedNodeIdsForThemes(
  nodes: readonly GraphNode[],
  activeThemes: ReadonlySet<string>
): Set<string> {
  if (activeThemes.size === 0) return new Set(nodes.map((node) => node.id))
  return new Set(
    nodes
      .filter((node) => nodeThemeIds(node).some((theme) => activeThemes.has(theme)))
      .map((node) => node.id)
  )
}

export function nodesForThemesAlphabetically(
  nodes: readonly GraphNode[],
  activeThemes: ReadonlySet<string>
): GraphNode[] {
  if (activeThemes.size === 0) return []
  return nodes
    .filter((node) => nodeThemeIds(node).some((theme) => activeThemes.has(theme)))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }) ||
        left.id.localeCompare(right.id)
    )
}

export function floatingNodeIdsForThemeHighlight(
  highlightedNodeIds: ReadonlySet<string>,
  hoveredNodeIds: ReadonlySet<string>,
  linkedNodeIds: ReadonlySet<string>
): Set<string> {
  return new Set([...highlightedNodeIds, ...hoveredNodeIds, ...linkedNodeIds])
}

/** Les tags flottants représentent un cluster : un clic remplace le filtre, le second le retire. */
export function selectExclusiveTheme(current: ReadonlySet<string>, theme: string): Set<string> {
  return current.size === 1 && current.has(theme) ? new Set() : new Set([theme])
}

export type ProgressiveGraphPhase = 'preview' | 'complete' | 'cached'

/** Le preview lazy sert à afficher vite, jamais à piloter la caméra. */
export function shouldAutoFitGraphPhase(phase: ProgressiveGraphPhase): boolean {
  return phase === 'complete' || phase === 'cached'
}

export function shouldShowFloatingNodeName(
  node: GraphNode,
  hoveredNodeIds: ReadonlySet<string>
): boolean {
  return hoveredNodeIds.has(node.id)
}

export function focusedNodeIdsFor(nodeId: string, graph: GraphData): Set<string> {
  return new Set([nodeId, ...linkedNodesFor(nodeId, graph).map((linked) => linked.node.id)])
}

export function nodeFocusForSelectionOrHover(
  selectedNodeId: string | null,
  hoveredNodeId: string | null,
  selectedNodeIds: ReadonlySet<string>,
  hoveredNodeIds: ReadonlySet<string>
): { focusedNodeId: string | null; focusedNodeIds: ReadonlySet<string> } {
  if (selectedNodeId) return { focusedNodeId: selectedNodeId, focusedNodeIds: selectedNodeIds }
  if (hoveredNodeId) return { focusedNodeId: hoveredNodeId, focusedNodeIds: hoveredNodeIds }
  return { focusedNodeId: null, focusedNodeIds: new Set() }
}

export function nodeSelectionEmphasis(
  nodeId: string,
  selectedNodeId: string | null,
  focusedNodeIds: ReadonlySet<string>
): { scale: number; opacity: number } {
  if (!selectedNodeId) return { scale: 1, opacity: 1 }
  if (nodeId === selectedNodeId) return { scale: 1.6, opacity: 1 }
  if (focusedNodeIds.has(nodeId)) return { scale: 1.35, opacity: 1 }
  return { scale: 1, opacity: 0.14 }
}

export function isLinkAttachedToNode(link: GraphLink, nodeId: string): boolean {
  return endpointId(link.source) === nodeId || endpointId(link.target) === nodeId
}

export function filterGraphVisibility(graph: GraphData, showOrphans: boolean): GraphData {
  if (showOrphans) return graph
  const connected = new Set<string>()
  for (const link of graph.links) {
    connected.add(endpointId(link.source))
    connected.add(endpointId(link.target))
  }
  return { nodes: graph.nodes.filter((node) => connected.has(node.id)), links: graph.links }
}

export function nodeColorForTheme(
  node: GraphNode,
  activeThemes: ReadonlySet<string>,
  contextOpacity: number,
  themeOrder: readonly string[] = [],
  palette: readonly string[] = GRAPH_PALETTE,
  themeCounts: ReadonlyMap<string, number> = new Map()
): string {
  const color = nodeThemeColor(node, activeThemes, themeOrder, palette, themeCounts)
  if (activeThemes.size === 0 || nodeThemeIds(node).some((theme) => activeThemes.has(theme)))
    return color
  const [r, g, b] = hexToRgb(color)
  return `rgba(${r},${g},${b},${clamp(contextOpacity, 0.05, 1)})`
}

export function galaxyNodeAppearance(
  node: GraphNode,
  activeThemes: ReadonlySet<string>,
  contextOpacity: number,
  themeOrder: readonly string[],
  palette: readonly string[] = GALAXY_PALETTE,
  themeCounts: ReadonlyMap<string, number> = new Map()
): GalaxyNodeAppearance {
  const isActive =
    activeThemes.size === 0 || nodeThemeIds(node).some((theme) => activeThemes.has(theme))

  return {
    color: nodeThemeColor(node, activeThemes, themeOrder, palette, themeCounts),
    opacity: isActive ? 1 : clamp(contextOpacity, 0.05, 1)
  }
}

export function nodeValueForTheme(
  node: GraphNode,
  activeThemes: ReadonlySet<string>,
  size: number
): number {
  const highlightMultiplier =
    activeThemes.size > 0 && nodeThemeIds(node).some((theme) => activeThemes.has(theme)) ? 2 : 1
  return size * highlightMultiplier
}

export function isHighlightedLink(
  link: GraphLink,
  activeThemes: ReadonlySet<string>,
  nodesById: ReadonlyMap<string, GraphNode>
): boolean {
  if (activeThemes.size === 0) return false
  const source = endpointNode(link.source, nodesById)
  const target = endpointNode(link.target, nodesById)
  return Boolean(
    source &&
    target &&
    nodeThemeIds(source).some((theme) => activeThemes.has(theme)) &&
    nodeThemeIds(target).some((theme) => activeThemes.has(theme))
  )
}

export function nodeThemeIds(node: GraphNode): string[] {
  return node.themes?.length ? node.themes : [`community/${node.group}`]
}

function nodeThemeColor(
  node: GraphNode,
  activeThemes: ReadonlySet<string>,
  themeOrder: readonly string[],
  palette: readonly string[],
  themeCounts: ReadonlyMap<string, number> = new Map()
): string {
  const themes = nodeThemeIds(node)
  const activeTheme = themes.find((theme) => activeThemes.has(theme))
  const overviewTheme = themes.reduce((selected, theme) => {
    const selectedCount = themeCounts.get(selected)
    const themeCount = themeCounts.get(theme)
    if (themeCount === undefined) return selected
    if (selectedCount === undefined || themeCount < selectedCount) return theme
    if (themeCount === selectedCount) {
      const selectedIndex = themeOrder.indexOf(selected)
      const themeIndex = themeOrder.indexOf(theme)
      if (themeIndex >= 0 && (selectedIndex < 0 || themeIndex < selectedIndex)) return theme
    }
    return selected
  }, themes[0])
  const displayedTheme = activeTheme ?? overviewTheme
  const declaredThemeIndex = themeOrder.indexOf(displayedTheme)
  const paletteIndex =
    declaredThemeIndex >= 0
      ? declaredThemeIndex
      : positiveModulo(node.group, Math.max(1, palette.length))
  return palette[positiveModulo(paletteIndex, palette.length)]
}

export function linkedNodesFor(nodeId: string, graph: GraphData): LinkedNode[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const neighbours = new Map<string, LinkedNode>()
  for (const link of graph.links) {
    const sourceId = endpointId(link.source)
    const targetId = endpointId(link.target)
    if (sourceId === nodeId && targetId !== nodeId) {
      const target = nodesById.get(targetId)
      if (target)
        neighbours.set(`outgoing:${target.id}`, {
          node: target,
          direction: 'outgoing',
          relation: link.relation
        })
    }
    if (targetId === nodeId && sourceId !== nodeId) {
      const source = nodesById.get(sourceId)
      if (source)
        neighbours.set(`incoming:${source.id}`, {
          node: source,
          direction: 'incoming',
          relation: link.relation
        })
    }
  }
  return [...neighbours.values()].sort(
    (a, b) => a.direction.localeCompare(b.direction) || a.node.label.localeCompare(b.node.label)
  )
}

/** Fusion additive et idempotente d'un voisinage chargé à la demande. */
export function mergeGraphDelta(graph: GraphData, delta: GraphData): GraphData {
  const nodes = [...graph.nodes]
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const node of delta.nodes) {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id)
      nodes.push(node)
    }
  }

  const links = [...graph.links]
  const linkKeys = new Set(
    links.map(
      (link) =>
        `${endpointId(link.source)}\u0000${endpointId(link.target)}\u0000${link.relation ?? ''}`
    )
  )
  for (const link of delta.links) {
    const key = `${endpointId(link.source)}\u0000${endpointId(link.target)}\u0000${link.relation ?? ''}`
    if (!linkKeys.has(key)) {
      linkKeys.add(key)
      links.push(link)
    }
  }

  return {
    nodes,
    links,
    totalNodes: Math.max(graph.totalNodes ?? nodes.length, delta.totalNodes ?? nodes.length)
  }
}

/** Termine preview→full sans perdre les voisinages chargés pendant l'indexation. */
export function completeProgressiveGraph(fullGraph: GraphData, dynamicGraph: GraphData): GraphData {
  return mergeGraphDelta(fullGraph, dynamicGraph)
}

export function dynamicGraphForKey(
  currentKey: string,
  nextKey: string,
  dynamicGraph: GraphData
): GraphData {
  return currentKey === nextKey ? dynamicGraph : { nodes: [], links: [] }
}

function themeLabel(id: string): string {
  if (id === 'theme/rig') return 'RIG'
  if (id.startsWith('theme/')) {
    const value = id.slice('theme/'.length)
    return value.charAt(0).toUpperCase() + value.slice(1)
  }
  return `Thème ${id.slice('community/'.length)}`
}

function endpointNode(
  endpoint: string | GraphNode,
  nodesById: ReadonlyMap<string, GraphNode>
): GraphNode | undefined {
  return typeof endpoint === 'string' ? nodesById.get(endpoint) : endpoint
}

function endpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
