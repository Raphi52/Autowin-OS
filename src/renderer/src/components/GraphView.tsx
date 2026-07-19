import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import * as THREE from 'three'
import { autowinStorageKey, readMigratedStorageValue } from '../storage-keys'
import {
  fitNormalColumnWidths,
  GRAPH_COLUMN_LIMITS,
  type GraphColumnWidths
} from './graph-column-layout'
import {
  buildThemeSummaries,
  DEFAULT_GRAPH_NODE_SPACING,
  filterGraphVisibility,
  galaxyNodeAppearance,
  getGraphVisualProfile,
  graphForcesForSpacing,
  isCurrentGraphFitRequest,
  isHighlightedLink,
  linkedNodesFor,
  nodeColorForTheme,
  nodeThemeIds,
  nodeValueForTheme,
  normalizeGraphNodeSpacing,
  nextGraphFitRequest,
  searchGraphCatalog,
  shouldShowFloatingNodeName,
  themeClusterAnchors,
  toggleThemeSelection,
  visibleThemeClusterIds,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type GraphVisualMode
} from './graph-view-model'
import { BrainMarkdown } from './BrainMarkdown'
import './GraphView.css'

type BrainTheme = { id: string; label: string }
type Brain = {
  id: string
  label: string
  path: string
  sizeMb: number
  kind: 'vault' | 'graphify'
  themes?: BrainTheme[]
}
type PanelTab = 'visibility' | 'node'
type ResizableColumn = 'theme' | 'visibility' | 'detail'
type ColumnWidths = GraphColumnWidths
type VisibilitySettings = {
  labels: boolean
  links: boolean
  orphans: boolean
  arrows: boolean
  contextOpacity: number
  nodeSize: number
  linkWidth: number
  nodeSpacing: number
  lod: number
}

const DEFAULT_VISIBILITY: VisibilitySettings = {
  labels: true,
  links: true,
  orphans: true,
  arrows: false,
  contextOpacity: 0.22,
  nodeSize: 1.4,
  linkWidth: 0.7,
  nodeSpacing: DEFAULT_GRAPH_NODE_SPACING,
  lod: 300
}

const GRAPH_NODE_SPACING_SUFFIX = 'graph.node-spacing.v1'

function initialVisibilitySettings(): VisibilitySettings {
  return {
    ...DEFAULT_VISIBILITY,
    nodeSpacing: normalizeGraphNodeSpacing(
      readMigratedStorageValue(localStorage, GRAPH_NODE_SPACING_SUFFIX)
    )
  }
}

function initialColumnWidths(): ColumnWidths {
  const compact = window.matchMedia('(max-width: 1050px)').matches
  return {
    theme: compact ? 190 : 210,
    visibility: compact ? 220 : 290,
    detail: null
  }
}

const galaxyStarTextures = new Map<string, THREE.CanvasTexture>()
const connectedLabelTextures = new Map<
  string,
  { texture: THREE.CanvasTexture; aspectRatio: number }
>()
let seriousNodeTextureCache: THREE.CanvasTexture | null = null

function seriousNodeTexture(): THREE.CanvasTexture {
  if (seriousNodeTextureCache) return seriousNodeTextureCache
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(32, 32, 25, 0, Math.PI * 2)
    context.fill()
  }
  seriousNodeTextureCache = new THREE.CanvasTexture(canvas)
  seriousNodeTextureCache.colorSpace = THREE.SRGBColorSpace
  return seriousNodeTextureCache
}

function createSeriousNode(
  node: GraphNode,
  appearance: { color: string; opacity: number },
  value: number,
  showLabel: boolean
): THREE.Sprite {
  const scale = 8 * Math.sqrt(Math.max(0.5, value))
  const dot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: seriousNodeTexture(),
      color: appearance.color,
      opacity: appearance.opacity,
      transparent: true,
      depthWrite: false
    })
  )
  dot.scale.set(scale, scale, 1)
  dot.renderOrder = appearance.opacity === 1 ? 2 : 1
  dot.userData.nodeId = node.id
  if (showLabel) dot.add(createConnectedLabel(node.label, appearance.color, scale, 0.035))
  return dot
}

function galaxyStarTexture(color: string): THREE.CanvasTexture {
  const cached = galaxyStarTextures.get(color)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return new THREE.CanvasTexture(canvas)

  const center = canvas.width / 2
  context.beginPath()
  for (let point = 0; point < 16; point += 1) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 8
    const radius = point % 4 === 0 ? 61 : point % 2 === 0 ? 30 : 9
    const x = center + Math.cos(angle) * radius
    const y = center + Math.sin(angle) * radius
    if (point === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fillStyle = color
  context.fill()
  context.beginPath()
  context.arc(center, center, 5, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  galaxyStarTextures.set(color, texture)
  return texture
}

function createGalaxyStar(
  node: GraphNode,
  appearance: { color: string; opacity: number },
  value: number
): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: galaxyStarTexture(appearance.color),
    color: '#ffffff',
    opacity: appearance.opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending
  })
  const star = new THREE.Sprite(material)
  const scale = 12 * Math.sqrt(Math.max(0.5, value))
  star.scale.set(scale, scale, 1)
  star.renderOrder = appearance.opacity === 1 ? 2 : 1
  star.userData.nodeId = node.id
  return star
}

function connectedLabelTexture(
  label: string,
  color: string
): { texture: THREE.CanvasTexture; aspectRatio: number } {
  const cacheKey = `${color}:${label}`
  const cached = connectedLabelTextures.get(cacheKey)
  if (cached) return cached

  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  const font = '600 20px Inter, system-ui, sans-serif'
  if (measureContext) measureContext.font = font
  const measuredWidth = measureContext?.measureText(label).width ?? label.length * 11
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(Math.min(560, Math.max(120, measuredWidth + 30)))
  canvas.height = 54
  const context = canvas.getContext('2d')
  if (context) {
    context.font = font
    context.fillStyle = 'rgba(4, 9, 17, 0.94)'
    context.strokeStyle = color
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 10)
    context.fill()
    context.stroke()
    context.fillStyle = '#f7fbff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 24)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  const result = { texture, aspectRatio: canvas.width / canvas.height }
  connectedLabelTextures.set(cacheKey, result)
  return result
}

function createConnectedLabel(
  label: string,
  color: string,
  parentScale = 1,
  screenHeight = 0.035
): THREE.Sprite {
  const { texture, aspectRatio } = connectedLabelTexture(label, color)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: '#ffffff',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false
    })
  )
  const height = screenHeight / parentScale
  sprite.position.set(0, 0, 0)
  sprite.scale.set(height * aspectRatio, height, 1)
  sprite.center.set(0.5, -0.16)
  sprite.renderOrder = 20
  sprite.raycast = () => undefined
  sprite.userData.connectedNodeLabel = label
  return sprite
}

/** Observatoire 3D : thèmes en surbrillance, visibilité réglable et lecture du nœud. */
export function GraphView(): React.JSX.Element {
  const [brains, setBrains] = useState<Brain[]>([])
  const [selected, setSelected] = useState('')
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [themeQuery, setThemeQuery] = useState('')
  const [activeThemes, setActiveThemes] = useState<Set<string>>(() => new Set())
  const [settings, setSettings] = useState<VisibilitySettings>(initialVisibilitySettings)
  const [visualMode, setVisualMode] = useState<GraphVisualMode>('serious')
  const [panelTab, setPanelTab] = useState<PanelTab>('node')
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(initialColumnWidths)
  const [resizingColumn, setResizingColumn] = useState<ResizableColumn | null>(null)
  const [node, setNode] = useState<GraphNode | null>(null)
  const [file, setFile] = useState<{ path: string; content: string } | null>(null)
  const [fileErr, setFileErr] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLElement>(null)
  const themeSidebarRef = useRef<HTMLElement>(null)
  const visibilitySidebarRef = useRef<HTMLElement>(null)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const previousNodeSpacingRef = useRef(settings.nodeSpacing)
  const themeLabelsRef = useRef<HTMLDivElement>(null)
  const fitOnEngineStopRef = useRef(false)
  const deferredFitRequestRef = useRef(0)
  const fileRequestRef = useRef(0)
  const columnResizeCleanupRef = useRef<(() => void) | null>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })

  useEffect(
    () => () => {
      for (const texture of galaxyStarTextures.values()) texture.dispose()
      galaxyStarTextures.clear()
      for (const { texture } of connectedLabelTextures.values()) texture.dispose()
      connectedLabelTextures.clear()
    },
    []
  )

  useEffect(() => {
    window.api
      .listBrains()
      .then((available) => {
        setBrains(available)
        if (available[0]) setSelected(available[0].path)
      })
      .catch((error) => setErr(String(error)))
  }, [])

  useEffect(() => {
    if (!selected) return
    let current = true
    queueMicrotask(() => {
      if (!current) return
      setLoading(true)
      setErr('')
    })
    window.api
      .loadBrainGraph(selected, settings.lod)
      .then((loaded) => {
        if (current) setGraph(loaded as GraphData)
      })
      .catch((error) => {
        if (current) setErr(String(error))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [selected, settings.lod])

  useEffect(() => {
    const element = wrap.current
    if (!element) return
    const updateSize = (): void => setSize({ w: element.clientWidth, h: element.clientHeight })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      columnResizeCleanupRef.current?.()
    },
    []
  )

  useEffect(() => {
    if (resizingColumn) return
    const scheduledRequest = nextGraphFitRequest(deferredFitRequestRef.current)
    deferredFitRequestRef.current = scheduledRequest
    const timeout = window.setTimeout(() => {
      if (!isCurrentGraphFitRequest(scheduledRequest, deferredFitRequestRef.current)) return
      const padding = Math.min(72, Math.max(48, size.w * 0.12))
      graphRef.current?.zoomToFit(420, padding)
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [resizingColumn, size.h, size.w, visualMode])

  const selectedBrain = useMemo(
    () => brains.find((brain) => brain.path === selected),
    [brains, selected]
  )
  const themeSummaries = useMemo(
    () => buildThemeSummaries(graph.nodes, selectedBrain?.themes),
    [graph.nodes, selectedBrain]
  )
  const themeOrder = useMemo(() => themeSummaries.map((theme) => theme.id), [themeSummaries])
  const themeCounts = useMemo(
    () => new Map(themeSummaries.map((theme) => [theme.id, theme.count])),
    [themeSummaries]
  )
  const catalogSearch = useMemo(
    () => searchGraphCatalog(themeQuery, graph.nodes, themeSummaries),
    [graph.nodes, themeQuery, themeSummaries]
  )
  const displayGraph = useMemo(
    () => filterGraphVisibility(graph, settings.orphans),
    [graph, settings.orphans]
  )

  useEffect(() => {
    const instance = graphRef.current
    if (!instance) return
    const previousSpacing = previousNodeSpacingRef.current
    const positionRatio = settings.nodeSpacing / previousSpacing
    if (positionRatio !== 1) {
      for (const graphNode of displayGraph.nodes) {
        if (typeof graphNode.x === 'number') graphNode.x *= positionRatio
        if (typeof graphNode.y === 'number') graphNode.y *= positionRatio
        if (typeof graphNode.z === 'number') graphNode.z *= positionRatio
      }
    }
    previousNodeSpacingRef.current = settings.nodeSpacing
    const { linkDistance, chargeStrength } = graphForcesForSpacing(settings.nodeSpacing)
    const linkForce = instance.d3Force('link') as
      { distance?: (distance: number) => unknown } | undefined
    const chargeForce = instance.d3Force('charge') as
      { strength?: (strength: number) => unknown } | undefined
    linkForce?.distance?.(linkDistance)
    chargeForce?.strength?.(chargeStrength)
    if (positionRatio !== 1) instance.d3ReheatSimulation()
    localStorage.setItem(autowinStorageKey(GRAPH_NODE_SPACING_SUFFIX), String(settings.nodeSpacing))
  }, [displayGraph, settings.nodeSpacing])

  useEffect(() => {
    fitOnEngineStopRef.current = true
  }, [displayGraph])
  const nodesById = useMemo(
    () => new Map(displayGraph.nodes.map((item) => [item.id, item])),
    [displayGraph.nodes]
  )
  const highlightedCount = useMemo(
    () =>
      activeThemes.size === 0
        ? graph.nodes.length
        : graph.nodes.filter((item) => nodeThemeIds(item).some((theme) => activeThemes.has(theme)))
            .length,
    [activeThemes, graph.nodes]
  )
  const visualProfile = getGraphVisualProfile(visualMode)
  const linkedNodes = useMemo(() => (node ? linkedNodesFor(node.id, graph) : []), [graph, node])
  const connectedNodeIds = useMemo(
    () => new Set(linkedNodes.map((linked) => linked.node.id)),
    [linkedNodes]
  )
  const detailOpen = Boolean(node)
  const visibleThemeLabelIds = useMemo(
    () => new Set(visibleThemeClusterIds(themeSummaries, activeThemes, node)),
    [activeThemes, node, themeSummaries]
  )
  const showThemeClusterLabels = visibleThemeLabelIds.size > 0

  const syncThemeClusterLabels = useCallback((): void => {
    const graphApi = graphRef.current
    const layer = themeLabelsRef.current
    if (!graphApi || !layer || !showThemeClusterLabels) return
    const anchors = themeClusterAnchors(displayGraph.nodes, themeSummaries)
    const labels = new Map(
      [...layer.querySelectorAll<HTMLElement>('[data-theme-id]')].map((label) => [
        label.dataset.themeId,
        label
      ])
    )
    const processedThemes = new Set<string>()
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = []

    for (const anchor of anchors) {
      const label = labels.get(anchor.id)
      if (!label) continue
      processedThemes.add(anchor.id)
      label.style.display = 'flex'
      const screen = graphApi.graph2ScreenCoords(anchor.x, anchor.y, anchor.z)
      if (
        !Number.isFinite(screen.x) ||
        !Number.isFinite(screen.y) ||
        screen.x < 0 ||
        screen.x > layer.clientWidth ||
        screen.y < 0 ||
        screen.y > layer.clientHeight
      ) {
        label.style.display = 'none'
        continue
      }
      const width = label.offsetWidth
      const height = label.offsetHeight
      const baseLeft = screen.x - width / 2
      const baseTop = screen.y - height - 7
      let position: { left: number; top: number } | undefined

      for (let row = 0; row < 10 && !position; row += 1) {
        for (const column of [0, -1, 1, -2, 2]) {
          const left = Math.min(
            layer.clientWidth - width - 8,
            Math.max(8, baseLeft + column * (width * 0.56 + 8))
          )
          const top = Math.min(
            layer.clientHeight - height - 8,
            Math.max(8, baseTop - row * (height + 4))
          )
          const candidate = { left, top, right: left + width, bottom: top + height }
          const collides = placed.some(
            (item) =>
              candidate.left < item.right + 4 &&
              candidate.right + 4 > item.left &&
              candidate.top < item.bottom + 4 &&
              candidate.bottom + 4 > item.top
          )
          if (!collides) {
            position = { left, top }
            placed.push(candidate)
            break
          }
        }
      }

      if (!position) {
        label.style.display = 'none'
        continue
      }
      label.style.transform = `translate3d(${Math.round(position.left)}px, ${Math.round(position.top)}px, 0)`
    }
    for (const [themeId, label] of labels) {
      if (!themeId || !processedThemes.has(themeId)) label.style.display = 'none'
    }
  }, [displayGraph.nodes, showThemeClusterLabels, themeSummaries])

  useEffect(() => {
    let frame = 0
    const update = (): void => {
      syncThemeClusterLabels()
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [syncThemeClusterLabels])

  useEffect(() => {
    if (resizingColumn) return
    const layout = layoutRef.current
    if (!layout) return
    let frame = 0
    const reconcileWidths = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const contentWidth = layout.clientWidth
        if (!contentWidth || window.matchMedia('(max-width: 760px)').matches) return
        setColumnWidths((current) => {
          if (detailOpen) {
            if (current.detail === null) return current
            const detail = Math.round(
              Math.min(
                GRAPH_COLUMN_LIMITS.detail.max,
                Math.max(
                  GRAPH_COLUMN_LIMITS.detail.min,
                  Math.min(current.detail, contentWidth - GRAPH_COLUMN_LIMITS.detailGraph)
                )
              )
            )
            return detail === current.detail ? current : { ...current, detail }
          }
          const fitted = fitNormalColumnWidths(current, contentWidth)
          return fitted.theme === current.theme && fitted.visibility === current.visibility
            ? current
            : { ...current, ...fitted }
        })
      })
    }
    reconcileWidths()
    const observer = new ResizeObserver(reconcileWidths)
    observer.observe(layout)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [detailOpen, resizingColumn])

  useEffect(() => {
    if (!detailOpen || columnWidths.detail !== null) return
    const frame = requestAnimationFrame(() => {
      const width = visibilitySidebarRef.current?.getBoundingClientRect().width
      if (width) setColumnWidths((current) => ({ ...current, detail: Math.round(width) }))
    })
    return () => cancelAnimationFrame(frame)
  }, [columnWidths.detail, detailOpen])

  function patchSettings(patch: Partial<VisibilitySettings>): void {
    setSettings((current) => ({ ...current, ...patch }))
  }

  function invalidatePendingGraphFit(): void {
    fitOnEngineStopRef.current = false
    deferredFitRequestRef.current = nextGraphFitRequest(deferredFitRequestRef.current)
  }

  function resizeColumn(column: ResizableColumn, clientX: number): void {
    const layout = layoutRef.current
    if (!layout) return
    const bounds = layout.getBoundingClientRect()
    const contentWidth = layout.clientWidth
    const themeWidth = themeSidebarRef.current?.getBoundingClientRect().width ?? columnWidths.theme
    const visibilityWidth =
      visibilitySidebarRef.current?.getBoundingClientRect().width ?? columnWidths.visibility
    const rawWidth = column === 'theme' ? clientX - bounds.left : bounds.right - clientX
    const limits = GRAPH_COLUMN_LIMITS[column]
    const availableWidth =
      column === 'theme'
        ? contentWidth - visibilityWidth - GRAPH_COLUMN_LIMITS.graph
        : column === 'visibility'
          ? contentWidth - themeWidth - GRAPH_COLUMN_LIMITS.graph
          : contentWidth - GRAPH_COLUMN_LIMITS.detailGraph
    const maxWidth = Math.max(limits.min, Math.min(limits.max, availableWidth))
    const width = Math.round(Math.min(maxWidth, Math.max(limits.min, rawWidth)))
    setColumnWidths((current) => ({ ...current, [column]: width }))
  }

  function startColumnResize(
    column: ResizableColumn,
    event: React.PointerEvent<HTMLDivElement>
  ): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    columnResizeCleanupRef.current?.()
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizingColumn(column)
    resizeColumn(column, event.clientX)
    const move = (moveEvent: PointerEvent): void => resizeColumn(column, moveEvent.clientX)
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      columnResizeCleanupRef.current = null
      setResizingColumn(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    columnResizeCleanupRef.current = finish
  }

  function resizeColumnWithKeyboard(
    column: ResizableColumn,
    event: React.KeyboardEvent<HTMLDivElement>
  ): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const layout = layoutRef.current
    if (!layout) return
    const bounds = layout.getBoundingClientRect()
    const currentWidth =
      column === 'theme'
        ? (themeSidebarRef.current?.getBoundingClientRect().width ?? columnWidths.theme)
        : (visibilitySidebarRef.current?.getBoundingClientRect().width ??
          columnWidths[column] ??
          columnWidths.visibility)
    const boundaryDelta = event.key === 'ArrowRight' ? 16 : -16
    const clientX =
      column === 'theme'
        ? bounds.left + currentWidth + boundaryDelta
        : bounds.right - currentWidth + boundaryDelta
    resizeColumn(column, clientX)
  }

  function columnResizer(column: ResizableColumn, label: string): React.JSX.Element {
    const value = columnWidths[column] ?? columnWidths.visibility
    return (
      <div
        className={`column-resizer column-resizer--${column}`}
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={GRAPH_COLUMN_LIMITS[column].min}
        aria-valuemax={GRAPH_COLUMN_LIMITS[column].max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={(event) => startColumnResize(column, event)}
        onKeyDown={(event) => resizeColumnWithKeyboard(column, event)}
      />
    )
  }

  function toggleTheme(theme: string): void {
    setActiveThemes((current) => toggleThemeSelection(current, theme))
  }

  function fitLoadedGraph(): void {
    syncThemeClusterLabels()
    if (!fitOnEngineStopRef.current) return
    fitOnEngineStopRef.current = false
    graphRef.current?.zoomToFit(500, 48)
  }

  function clearNodeSelection(): void {
    fileRequestRef.current += 1
    setNode(null)
    setFile(null)
    setFileErr('')
    setPanelTab('visibility')
  }

  function focusNode(nextNode: GraphNode): void {
    if ([nextNode.x, nextNode.y, nextNode.z].some((coordinate) => typeof coordinate !== 'number'))
      return
    const x = nextNode.x as number
    const y = nextNode.y as number
    const z = nextNode.z as number
    const distance = Math.hypot(x, y, z) || 1
    const ratio = 1 + 220 / distance
    graphRef.current?.cameraPosition({ x: x * ratio, y: y * ratio, z: z * ratio }, { x, y, z }, 700)
  }

  async function openNode(nextNode: GraphNode, expandDetail = false): Promise<void> {
    const requestId = ++fileRequestRef.current
    setNode(nextNode)
    if (expandDetail) setPanelTab('node')
    focusNode(nextNode)
    setFile(null)
    setFileErr('')
    if (!nextNode.file) {
      setFileErr('Ce nœud n’a pas de fichier source.')
      return
    }
    try {
      const loadedFile = await window.api.readNodeFile(nextNode.file)
      if (requestId === fileRequestRef.current) setFile(loadedFile)
    } catch (error) {
      if (requestId === fileRequestRef.current) setFileErr(String(error))
    }
  }

  const nodeColor = (value: object): string =>
    nodeColorForTheme(
      value as GraphNode,
      activeThemes,
      settings.contextOpacity,
      themeOrder,
      visualProfile.palette,
      themeCounts
    )
  const nodeValue = (value: object): number =>
    nodeValueForTheme(value as GraphNode, activeThemes, settings.nodeSize) * visualProfile.nodeScale
  const galaxyNodeObject = useCallback(
    (value: object): THREE.Object3D => {
      const nextNode = value as GraphNode
      const appearance = galaxyNodeAppearance(
        nextNode,
        activeThemes,
        settings.contextOpacity,
        themeOrder,
        visualProfile.palette
      )
      const star = createGalaxyStar(
        nextNode,
        appearance,
        nodeValueForTheme(nextNode, activeThemes, settings.nodeSize) * visualProfile.nodeScale
      )
      if (shouldShowFloatingNodeName(nextNode, activeThemes, connectedNodeIds))
        star.add(createConnectedLabel(nextNode.label, appearance.color, star.scale.x, 0.03))
      return star
    },
    [
      activeThemes,
      connectedNodeIds,
      settings.contextOpacity,
      settings.nodeSize,
      themeOrder,
      visualProfile
    ]
  )
  const seriousNodeObject = useCallback(
    (value: object): THREE.Object3D => {
      const nextNode = value as GraphNode
      const appearance = galaxyNodeAppearance(
        nextNode,
        activeThemes,
        settings.contextOpacity,
        themeOrder,
        visualProfile.palette
      )
      return createSeriousNode(
        nextNode,
        appearance,
        nodeValueForTheme(nextNode, activeThemes, settings.nodeSize) * visualProfile.nodeScale,
        shouldShowFloatingNodeName(nextNode, activeThemes, connectedNodeIds)
      )
    },
    [
      activeThemes,
      connectedNodeIds,
      settings.contextOpacity,
      settings.nodeSize,
      themeOrder,
      visualProfile
    ]
  )
  const linkIsHighlighted = (value: object): boolean =>
    isHighlightedLink(value as GraphLink, activeThemes, nodesById)
  const linkColor = (value: object): string => {
    if (visualMode === 'serious')
      return linkIsHighlighted(value) ? visualProfile.linkHighlight : visualProfile.linkBase
    const link = value as GraphLink
    const source = typeof link.source === 'string' ? nodesById.get(link.source) : link.source
    if (!source) return visualProfile.linkBase
    return visualProfile.palette[Math.abs(source.group) % visualProfile.palette.length]
  }
  return (
    <section
      ref={layoutRef}
      className={`graph-observatory ${visualProfile.modeClass} ${detailOpen ? 'is-detail-open' : ''} ${resizingColumn ? 'is-column-resizing' : ''}`}
      style={
        {
          '--theme-column-width': `${columnWidths.theme}px`,
          '--visibility-column-width': `${columnWidths.visibility}px`,
          ...(columnWidths.detail === null
            ? {}
            : { '--detail-column-width': `${columnWidths.detail}px` })
        } as React.CSSProperties
      }
    >
      <header className="graph-toolbar">
        <div className="graph-toolbar__title">
          <span>Observatoire</span>
          <strong>Graphe de connaissances</strong>
        </div>
        <select
          aria-label="Graphe de connaissances"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value)
            setActiveThemes(new Set())
            setNode(null)
            setPanelTab('node')
          }}
        >
          {brains.length === 0 && <option value="">Aucun graphe accessible</option>}
          {brains.map((brain) => (
            <option key={brain.path} value={brain.path}>
              {brain.label}
              {brain.kind === 'graphify' ? ` · ${brain.sizeMb} Mo` : ''}
            </option>
          ))}
        </select>
        <div className="view-mode-switch" aria-label="Style du graphe">
          <button
            type="button"
            aria-pressed={visualMode === 'serious'}
            onClick={() => setVisualMode('serious')}
          >
            Noir
          </button>
          <button
            type="button"
            aria-pressed={visualMode === 'galaxy'}
            onClick={() => setVisualMode('galaxy')}
          >
            <span aria-hidden="true">✦</span> Galaxy
          </button>
        </div>
        <div className="graph-toolbar__stats" aria-live="polite">
          <span>
            <strong>{graph.nodes.length}</strong> nœuds
          </span>
          <span>
            <strong>{graph.links.length}</strong> relations
          </span>
          <span>
            <strong>{themeSummaries.length}</strong> thèmes
          </span>
        </div>
      </header>

      <aside ref={themeSidebarRef} className="theme-sidebar" aria-label="Filtres de thèmes">
        <div className="sidebar-heading">
          <span>Rechercher</span>
          <button onClick={() => setActiveThemes(new Set())}>Effacer</button>
        </div>
        <input
          aria-label="Rechercher un thème ou une fiche"
          placeholder="Thème ou fiche…"
          value={themeQuery}
          onChange={(event) => setThemeQuery(event.target.value)}
        />
        <button
          className={`theme-filter ${activeThemes.size === 0 ? 'is-active' : ''}`}
          onClick={() => setActiveThemes(new Set())}
        >
          <i style={{ background: visualProfile.palette[0] }} />
          <span>Tous les thèmes</span>
          <small>{graph.nodes.length}</small>
        </button>
        <div className="theme-list">
          {themeQuery.trim() && catalogSearch.nodes.length > 0 && (
            <div className="node-search-results" aria-label="Fiches trouvées">
              <span className="search-results-heading">Fiches</span>
              {catalogSearch.nodes.map((resultNode) => (
                <button
                  key={resultNode.id}
                  className="node-search-result"
                  onClick={() => void openNode(resultNode, true)}
                >
                  <i aria-hidden="true">✦</i>
                  <span>{resultNode.label}</span>
                  <small>Ouvrir</small>
                </button>
              ))}
            </div>
          )}
          {themeQuery.trim() && catalogSearch.themes.length > 0 && (
            <span className="search-results-heading">Thèmes</span>
          )}
          {catalogSearch.themes.map((theme) => {
            const colorIndex = themeSummaries.findIndex((item) => item.id === theme.id)
            return (
              <button
                key={theme.id}
                data-theme-id={theme.id}
                className={`theme-filter ${activeThemes.has(theme.id) ? 'is-active' : ''}`}
                aria-pressed={activeThemes.has(theme.id)}
                onClick={() => toggleTheme(theme.id)}
              >
                <i
                  style={{
                    background: visualProfile.palette[colorIndex % visualProfile.palette.length]
                  }}
                />
                <span>{theme.label}</span>
                <small>{theme.count}</small>
              </button>
            )
          })}
        </div>
        <p className="theme-sidebar__note">
          <strong>Mode surbrillance</strong>
          {activeThemes.size === 0
            ? ' Tous les nœuds sont actifs.'
            : ` ${highlightedCount} nœuds actifs. Le reste demeure visible comme contexte.`}
        </p>
      </aside>

      {columnResizer('theme', 'Redimensionner la colonne Thèmes')}

      <main className="graph-stage">
        <div className="graph-stage__heading">
          <span>{activeThemes.size === 0 ? 'Tous les thèmes' : 'Thèmes actifs'}</span>
          <strong>
            {activeThemes.size === 0
              ? 'Vue d’ensemble'
              : [...activeThemes]
                  .map((theme) => themeSummaries.find((item) => item.id === theme)?.label ?? theme)
                  .join(' + ')}
          </strong>
          <small>
            {highlightedCount} nœuds mis en évidence · {graph.nodes.length - highlightedCount} de
            contexte
          </small>
        </div>
        {loading && <div className="graph-status">Chargement du graphe…</div>}
        {err && <div className="graph-status graph-status--error">{err}</div>}
        {!loading && !err && graph.nodes.length === 0 && (
          <div className="graph-status">Aucun nœud disponible pour ce graphe.</div>
        )}
        <div ref={wrap} className="graph-canvas">
          <ForceGraph3D
            ref={graphRef}
            width={size.w}
            height={size.h}
            graphData={displayGraph}
            backgroundColor={visualProfile.background}
            showNavInfo={false}
            nodeLabel={settings.labels ? 'label' : () => ''}
            nodeColor={nodeColor}
            nodeVal={nodeValue}
            nodeOpacity={1}
            nodeThreeObject={visualMode === 'galaxy' ? galaxyNodeObject : seriousNodeObject}
            nodeThreeObjectExtend={false}
            linkVisibility={() => settings.links}
            linkColor={linkColor}
            linkOpacity={
              activeThemes.size === 0 ? visualProfile.linkOpacity : visualProfile.linkOpacity * 0.72
            }
            linkWidth={(value) => settings.linkWidth * (linkIsHighlighted(value) ? 1.8 : 1)}
            linkDirectionalArrowLength={settings.arrows ? 3.5 : 0}
            linkDirectionalArrowColor={() => '#6f8193'}
            onEngineTick={syncThemeClusterLabels}
            onEngineStop={fitLoadedGraph}
            onBackgroundClick={clearNodeSelection}
            onNodeClick={(value) => openNode(value as GraphNode)}
          />
          <div
            ref={themeLabelsRef}
            className="theme-cluster-labels"
            hidden={!showThemeClusterLabels}
          >
            {themeSummaries.map((theme, index) =>
              theme.count > 0 && visibleThemeLabelIds.has(theme.id) ? (
                <button
                  key={theme.id}
                  type="button"
                  className={`theme-cluster-label ${activeThemes.has(theme.id) ? 'is-active' : ''}`}
                  data-theme-id={theme.id}
                  aria-label={`Filtrer par ${theme.label}`}
                  aria-pressed={activeThemes.has(theme.id)}
                  onClick={() => toggleTheme(theme.id)}
                  style={
                    {
                      '--theme-color': visualProfile.palette[index % visualProfile.palette.length]
                    } as React.CSSProperties
                  }
                >
                  <i />
                  {theme.label}
                </button>
              ) : null
            )}
          </div>
        </div>
        {node && (
          <button className="selected-node" onClick={() => setPanelTab('node')}>
            <i
              style={{
                background: nodeColorForTheme(
                  node,
                  activeThemes,
                  1,
                  themeOrder,
                  visualProfile.palette,
                  visualMode === 'serious' ? themeCounts : undefined
                )
              }}
            />
            <strong>{node.label}</strong>
            <span>Ouvrir le détail →</span>
          </button>
        )}
        <button
          type="button"
          className={`graph-settings-button ${panelTab === 'visibility' ? 'is-active' : ''}`}
          aria-label="Réglages de visibilité"
          aria-expanded={panelTab === 'visibility'}
          title="Réglages de visibilité"
          onClick={() =>
            setPanelTab((current) => (current === 'visibility' ? 'node' : 'visibility'))
          }
        >
          ⚙
        </button>
        {panelTab === 'visibility' && (
          <div className="graph-settings-popover">
            <div className="graph-settings-popover__heading">
              <strong>Visibilité</strong>
              <button
                type="button"
                onClick={() => setPanelTab('node')}
                aria-label="Fermer les réglages"
              >
                ×
              </button>
            </div>
            <div className="visibility-settings">
              <SettingsSection
                title="Contenu affiché"
                onReset={() => {
                  invalidatePendingGraphFit()
                  setSettings(DEFAULT_VISIBILITY)
                }}
              >
                <ToggleRow
                  label="Libellés au survol"
                  checked={settings.labels}
                  onChange={(labels) => patchSettings({ labels })}
                />
                <ToggleRow
                  label="Liens"
                  checked={settings.links}
                  onChange={(links) => patchSettings({ links })}
                />
                <ToggleRow
                  label="Nœuds sans lien"
                  checked={settings.orphans}
                  onChange={(orphans) => patchSettings({ orphans })}
                />
                <ToggleRow
                  label="Flèches de direction"
                  checked={settings.arrows}
                  onChange={(arrows) => patchSettings({ arrows })}
                />
              </SettingsSection>
              <SettingsSection title="Lisibilité">
                <RangeRow
                  label="Opacité du contexte"
                  value={settings.contextOpacity}
                  min={0.05}
                  max={0.8}
                  step={0.01}
                  display={`${Math.round(settings.contextOpacity * 100)}%`}
                  onChange={(contextOpacity) => patchSettings({ contextOpacity })}
                />
                <RangeRow
                  label="Taille des nœuds"
                  value={settings.nodeSize}
                  min={0.5}
                  max={3}
                  step={0.1}
                  display={`${Math.round(settings.nodeSize * 100)}%`}
                  onChange={(nodeSize) => patchSettings({ nodeSize })}
                />
                <RangeRow
                  label="Épaisseur des liens"
                  value={settings.linkWidth}
                  min={0.1}
                  max={2}
                  step={0.1}
                  display={settings.linkWidth.toFixed(1)}
                  onChange={(linkWidth) => patchSettings({ linkWidth })}
                />
              </SettingsSection>
              <SettingsSection title="Disposition">
                <RangeRow
                  label="Espacement des nœuds"
                  value={settings.nodeSpacing}
                  min={30}
                  max={240}
                  step={6}
                  display={String(settings.nodeSpacing)}
                  onChange={(nodeSpacing) => {
                    invalidatePendingGraphFit()
                    patchSettings({ nodeSpacing })
                  }}
                />
                <p className="setting-help">
                  Augmentez cette valeur pour étaler le Brain et distinguer les relations.
                </p>
              </SettingsSection>
              <SettingsSection title="Densité">
                <div className="lod-presets">
                  {[100, 300, 600].map((lod) => (
                    <button
                      key={lod}
                      className={settings.lod === lod ? 'is-active' : ''}
                      onClick={() => patchSettings({ lod })}
                    >
                      {lod}
                    </button>
                  ))}
                </div>
                <p className="setting-help">
                  Le LOD recharge les nœuds les plus connectés du graphe.
                </p>
              </SettingsSection>
            </div>
          </div>
        )}
        <div className="graph-hint">Glisser : pivoter · molette : zoomer · clic : sélectionner</div>
      </main>

      {columnResizer(detailOpen ? 'detail' : 'visibility', 'Redimensionner la colonne du nœud')}

      <aside
        ref={visibilitySidebarRef}
        className={`visibility-sidebar ${detailOpen ? 'is-detail-open' : ''}`}
      >
        <NodePanel
          node={node}
          file={file}
          fileErr={fileErr}
          linkedNodes={linkedNodes}
          onNavigate={(nextNode) => openNode(nextNode, true)}
        />
      </aside>
    </section>
  )
}

function SettingsSection({
  title,
  onReset,
  children
}: {
  title: string
  onReset?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="settings-section">
      <div className="settings-section__heading">
        <span>{title}</span>
        {onReset && <button onClick={onReset}>Réinitialiser</button>}
      </div>
      {children}
    </section>
  )
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  )
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="range-row">
      <span>
        {label} <strong>{display}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function NodePanel({
  node,
  file,
  fileErr,
  linkedNodes,
  onNavigate
}: {
  node: GraphNode | null
  file: { path: string; content: string } | null
  fileErr: string
  linkedNodes: Array<{ node: GraphNode; direction: 'incoming' | 'outgoing' }>
  onNavigate: (node: GraphNode) => void
}): React.JSX.Element {
  if (!node)
    return <div className="node-panel node-panel--empty">Sélectionnez un nœud dans le graphe.</div>
  return (
    <div className="node-panel">
      <nav className="node-links" aria-label="Nœuds reliés">
        <div className="node-links__heading">
          <strong>Liens</strong>
          <span>{linkedNodes.length}</span>
        </div>
        {linkedNodes.length === 0 && <p>Aucun nœud relié dans cette vue.</p>}
        {linkedNodes.map((linked) => (
          <button
            key={`${linked.direction}:${linked.node.id}`}
            type="button"
            onClick={() => onNavigate(linked.node)}
          >
            <span aria-hidden="true">{linked.direction === 'outgoing' ? '→' : '←'}</span>
            <strong>{linked.node.label}</strong>
          </button>
        ))}
      </nav>
      <article className="node-content">
        <span className="node-panel__theme">{nodeThemeIds(node).join(' · ')}</span>
        <h2>{node.label}</h2>
        <div className="node-panel__path">{node.file ?? 'Aucun fichier associé'}</div>
        {fileErr && <div className="node-panel__error">{fileErr}</div>}
        {!file && !fileErr && <div className="node-panel__loading">Chargement du contenu…</div>}
        {file &&
          (/\.md$/i.test(file.path) ? (
            <BrainMarkdown source={file.content} />
          ) : (
            <pre>{file.content}</pre>
          ))}
      </article>
    </div>
  )
}
