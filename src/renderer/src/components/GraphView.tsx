import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import type { BrainGraphRef } from '../../../main/viz/fs-brains'
import { brainSubjectOf } from './graph-brain-categories'
import {
  layoutTree,
  pickVisibleLabels,
  projectTreeVisibility,
  semanticZoomTier,
  shouldLabelTreeNode,
  treeBoundingRadius,
  type SemanticZoomTier
} from './graph-tree-layout'
import {
  focusCameraView,
  rememberViewBeforeFocus,
  restoreView,
  type CameraHandle,
  type CameraView
} from './graph-camera'
import * as THREE from 'three'
import {
  DEFAULT_GRAPH_VISIBILITY_SETTINGS,
  loadGraphVisibilitySettings,
  saveGraphVisibilitySettings,
  loadGraphLayoutMode,
  nextGraphLayoutMode,
  saveGraphLayoutMode,
  loadGraphVisualMode,
  saveGraphVisualMode,
  type GraphLayoutMode,
  loadMemoryDetailWidths,
  saveMemoryDetailWidths,
  type GraphVisibilitySettings,
  type MemoryDetailWidths
} from './graph-settings'
import {
  fitDetailColumnWidth,
  fitNormalColumnWidths,
  GRAPH_COLUMN_LIMITS,
  type GraphColumnWidths
} from './graph-column-layout'
import {
  buildThemeSummaries,
  completeProgressiveGraph,
  dynamicGraphForKey,
  filterGraphVisibility,
  focusedNodeIdsFor,
  galaxyNodeAppearance,
  getGraphVisualProfile,
  graphLinkArrowColor,
  graphLinkColor,
  graphForcesForSpacing,
  graphMotionProfile,
  highlightedNodeIdsForThemes,
  floatingNodeIdsForThemeHighlight,
  isLinkAttachedToNode,
  knowledgeHealthIssues,
  brainScoreChannelLabel,
  brainBusinessError,
  linkedNodesFor,
  mergeGraphDelta,
  nodeColorForTheme,
  nodeFocusForSelectionOrHover,
  nodeSelectionEmphasis,
  nodesForThemesAlphabetically,
  selectExclusiveTheme,
  shouldAutoFitGraphPhase,
  nodeValueForTheme,
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
import {
  createConnectedLabel,
  createGalaxyStar,
  createSeriousNode,
  disposeGraphTextures
} from './graph-three-helpers'
import {
  NodePanel,
  RangeRow,
  SettingsSection,
  ThemeNodesPanel,
  ToggleRow
} from './GraphView.panels'
import { ModuleHeader } from './ModuleHeader'
import { KnowledgeInboxPanel } from './KnowledgeInboxPanel'
import { BrainRetrievalBench } from './BrainRetrievalBench'
import './GraphView.css'

type PanelTab = 'visibility' | 'node' | 'workbench'
type ResizableColumn = 'theme' | 'visibility' | 'detail'
type ColumnWidths = GraphColumnWidths
const EMPTY_THEME_SELECTION = new Set<string>()
/** Couleurs des BANDES radiales — une teinte par famille, du centre vers l'extérieur. */
/** Écart vertical minimal entre deux libellés de couronne, en unités de scène. Calé sur la hauteur
 *  d'une étiquette rendue : en dessous, deux libellés voisins se recouvrent. */
const MIN_LABEL_GAP = 34

/** Hauteur d'une etiquette, en FRACTION de la hauteur du viewport — c'est l'unite des sprites. */
const LABEL_SCREEN_HEIGHT = 0.035

/** Ce que fera le PROCHAIN clic — un bouton doit annoncer sa destination, pas son état. */
const LIBELLE_BASCULE: Record<GraphLayoutMode, string> = {
  force: 'Passer en arborescence (un anneau = un niveau, les branches portent la filiation)',
  tree: 'Repasser en disposition libre (montre la connectivité)'
}

const ICONE_BASCULE: Record<GraphLayoutMode, string> = {
  force: '⁘',
  tree: '⁂'
}

const BAND_COLORS = [
  '#8b5cf6',
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#facc15',
  '#34d399',
  '#60a5fa'
] as const

function initialVisibilitySettings(): GraphVisibilitySettings {
  return loadGraphVisibilitySettings(localStorage)
}

function initialColumnWidths(): ColumnWidths {
  const compact = window.matchMedia('(max-width: 1050px)').matches
  return {
    theme: compact ? 190 : 210,
    visibility: compact ? 220 : 290,
    detail: null
  }
}

/** Observatoire 3D : thèmes en surbrillance, visibilité réglable et lecture du nœud. */
export function GraphView({
  active,
  onCleanMemory
}: {
  active: boolean
  onCleanMemory: (brainLabel: string) => void
}): React.JSX.Element {
  // Mode visuel (sombre vs galaxy) : choisi via le toggle de la toolbar, persisté entre lancements.
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>(() =>
    loadGraphLayoutMode(localStorage)
  )
  const [visualMode, setVisualMode] = useState<GraphVisualMode>(() =>
    loadGraphVisualMode(localStorage)
  )
  const [brains, setBrains] = useState<BrainGraphRef[]>([])
  const [brainsLoading, setBrainsLoading] = useState(true)
  const [selected, setSelected] = useState('')
  const selectedRef = useRef(selected)
  useLayoutEffect(() => {
    selectedRef.current = selected
  }, [selected])
  /** Vue d'avant le premier rapprochement, rendue à la fermeture de la fiche. */
  const viewBeforeFocusRef = useRef<CameraView | undefined>(undefined)
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] })
  const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = useState<Set<string>>(() => new Set())
  const [treeZoomTier, setTreeZoomTier] = useState<SemanticZoomTier>('overview')
  const [graphReload, setGraphReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [themeQuery, setThemeQuery] = useState('')
  const [searchReload, setSearchReload] = useState(0)
  const searchGenerationRef = useRef(0)
  const [benchReset, setBenchReset] = useState(0)
  const [activeThemes, setActiveThemes] = useState<Set<string>>(() => new Set())
  const [themeNodes, setThemeNodes] = useState<GraphNode[]>([])
  const [settings, setSettings] = useState<GraphVisibilitySettings>(initialVisibilitySettings)
  const [panelTab, setPanelTab] = useState<PanelTab>('node')
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(initialColumnWidths)
  // Largeurs de la colonne détail mémorisées PAR MODE (thème vs nœud), persistées entre lancements.
  const [detailWidths, setDetailWidths] = useState<MemoryDetailWidths>(() =>
    loadMemoryDetailWidths(localStorage)
  )
  const [resizingColumn, setResizingColumn] = useState<ResizableColumn | null>(null)
  const [node, setNode] = useState<GraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [vaultSearch, setVaultSearch] = useState<GraphNode[]>([])
  /**
   * Verdict du retrieval pour la recherche courante. `null` = pas de recherche en cours. `failed` est
   * l'échec du CANAL, distinct des quatre états que le serveur sait rendre.
   */
  const [searchRetrieval, setSearchRetrieval] = useState<{
    status: 'found' | 'empty' | 'invalid' | 'unavailable' | 'not-requested' | 'failed'
    note: string
  } | null>(null)
  const [file, setFile] = useState<{ path: string; content: string } | null>(null)
  const [fileErr, setFileErr] = useState('')
  /** Erreurs PAR CANAL : chacune porte son propre réessai, au lieu d'un cul-de-sac global. */
  const [brainsErr, setBrainsErr] = useState('')
  const [themesErr, setThemesErr] = useState('')
  const [themeNodesErr, setThemeNodesErr] = useState('')
  const [themesReload, setThemesReload] = useState(0)
  const [themeNodesReload, setThemeNodesReload] = useState(0)
  /** Candidats en attente dans `inbox/` — comptés SANS ouvrir le poste de travail. */
  const [inboxPending, setInboxPending] = useState(0)
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLElement>(null)
  const themeSidebarRef = useRef<HTMLElement>(null)
  const visibilitySidebarRef = useRef<HTMLElement>(null)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const graphCacheRef = useRef(new Map<string, GraphData>())
  const dynamicGraphRef = useRef<GraphData>({ nodes: [], links: [] })
  const dynamicGraphKeyRef = useRef('')
  const previousNodeSpacingRef = useRef(settings.nodeSpacing)
  const themeLabelsRef = useRef<HTMLDivElement>(null)
  const initialFitTimeoutRef = useRef<number | null>(null)
  const [initialFitRequest, setInitialFitRequest] = useState(0)
  const fileRequestRef = useRef(0)
  const themeNodesRequestRef = useRef(0)
  const brainsRequestRef = useRef(0)
  const columnResizeCleanupRef = useRef<(() => void) | null>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })

  useEffect(() => () => disposeGraphTextures(), [])

  useEffect(() => {
    const graphApi = graphRef.current
    if (!graphApi) return
    if (active) graphApi.resumeAnimation()
    else graphApi.pauseAnimation()
  }, [active])

  // Persiste les largeurs détail (par mode) à chaque changement.
  useEffect(() => {
    saveMemoryDetailWidths(localStorage, detailWidths)
  }, [detailWidths])

  const refreshBrains = useCallback((): void => {
    const request = ++brainsRequestRef.current
    const isCurrent = (): boolean => request === brainsRequestRef.current
    queueMicrotask(() => {
      if (isCurrent()) setBrainsLoading(true)
    })
    window.api
      .listBrains()
      .then((available) => {
        if (!isCurrent()) return
        // Le catalogue fourni par le scan est GLOBAL. Pour un vault, il ne doit jamais servir de
        // valeur provisoire avant que loadBrainThemes applique le corpus du workspace.
        const safeAvailable = available.map((brain) =>
          brain.kind === 'vault' ? { ...brain, themes: [] } : brain
        )
        setBrains(safeAvailable)
        setBrainsErr('')
        setSelected((current) =>
          safeAvailable.some((brain) => brain.path === current)
            ? current
            : (safeAvailable[0]?.path ?? '')
        )
      })
      .catch((error) => {
        if (isCurrent())
          setBrainsErr(
            brainBusinessError('Impossible de lister les graphes de connaissances.', error)
          )
      })
      .finally(() => {
        if (isCurrent()) setBrainsLoading(false)
      })
  }, [])

  const resetPrimaryBrainSearchResults = useCallback((): void => {
    searchGenerationRef.current += 1
    setVaultSearch([])
    setSearchRetrieval(null)
  }, [])

  const resetBrainSearchResults = useCallback((): void => {
    resetPrimaryBrainSearchResults()
    setBenchReset((request) => request + 1)
  }, [resetPrimaryBrainSearchResults])

  const evictGraphCache = useCallback((brainPath: string): void => {
    const brainPrefix = `${brainPath}\u0000`
    for (const key of graphCacheRef.current.keys()) {
      if (key.startsWith(brainPrefix)) graphCacheRef.current.delete(key)
    }
    if (selectedRef.current !== brainPath) return
    dynamicGraphKeyRef.current = ''
    dynamicGraphRef.current = { nodes: [], links: [] }
  }, [])

  const refreshGraph = useCallback((): void | Promise<void> => {
    if (!selected) {
      refreshBrains()
      return
    }

    setLoading(true)
    setErr('')
    resetBrainSearchResults()
    // La promesse est RENDUE : la boîte de réception attend la fin de la réindexation pour dire
    // « trouvable », au lieu de l'annoncer avant que l'index n'ait bougé.
    return window.api
      .refreshBrain(selected)
      .then(() => {
        evictGraphCache(selected)
        setSearchReload((request) => request + 1)
        setThemesReload((request) => request + 1)
        setGraphReload((request) => request + 1)
        refreshBrains()
      })
      .catch((error) => {
        setErr(brainBusinessError('Impossible de rafraîchir le graphe de connaissances.', error))
        setLoading(false)
      })
  }, [evictGraphCache, refreshBrains, resetBrainSearchResults, selected])

  const reloadAfterInboxDecision = useCallback(
    (brainPath: string): void => {
      // Promote/Reject ne résolvent qu'après l'invalidation main. Ici on invalide seulement le cache
      // renderer correspondant, sans refaire un second refresh IPC. Si l'utilisateur a déjà changé
      // de vault, son écran courant ne doit ni clignoter ni relancer sa recherche.
      evictGraphCache(brainPath)
      if (selectedRef.current !== brainPath) return
      setLoading(true)
      setErr('')
      setGraph({ nodes: [], links: [] })
      setSearchReload((request) => request + 1)
      setGraphReload((request) => request + 1)
      refreshBrains()
    },
    [evictGraphCache, refreshBrains]
  )

  /** Réessai : relance le chargement par le MÊME chemin que le chargement initial. */
  const retryGraph = useCallback((): void => {
    setErr('')
    if (!selected) {
      refreshBrains()
      return
    }
    setLoading(true)
    setGraphReload((request) => request + 1)
  }, [refreshBrains, selected])

  useEffect(() => {
    refreshBrains()
  }, [refreshBrains])

  // CANAL THÈMES — sorti de la chaîne du graphe pour pouvoir être réessayé SEUL : une panne des
  // thèmes n'oblige plus à recharger tout le graphe.
  useEffect(() => {
    if (!selected) return
    let current = true
    window.api
      .loadBrainThemes(selected)
      .then((themes) => {
        if (!current) return
        setThemesErr('')
        setBrains((available) =>
          available.map((brain) => (brain.path === selected ? { ...brain, themes } : brain))
        )
      })
      .catch((error) => {
        if (current)
          setThemesErr(brainBusinessError('Impossible de charger les thèmes du workspace.', error))
      })
    return () => {
      current = false
    }
  }, [selected, themesReload])

  // CANAL BOÎTE DE RÉCEPTION — le compte des candidats en attente doit être VISIBLE sans ouvrir le
  // poste de travail : sinon la revue humaine s'accumule sans que rien ne la réclame.
  useEffect(() => {
    const brain = brains.find((candidate) => candidate.path === selected)
    if (!selected || brain?.kind !== 'vault') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInboxPending(0)
      return
    }
    let current = true
    // Le compteur est un CONFORT : un préchargement qui n'expose pas ce canal ne doit pas casser la vue.
    if (typeof window.api.listInbox !== 'function') return
    Promise.resolve(window.api.listInbox(selected))
      .then((found) => {
        if (current) setInboxPending((found as unknown[]).length)
      })
      .catch(() => {
        if (current) setInboxPending(0)
      })
    return () => {
      current = false
    }
  }, [brains, graphReload, selected])

  useEffect(() => {
    const query = themeQuery.trim()
    const selectedBrain = brains.find((brain) => brain.path === selected)
    if (!query || !selectedBrain || selectedBrain.kind !== 'vault') {
      // Une recherche devenue inapplicable doit retirer immédiatement ses anciens résultats.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVaultSearch([])
      // …et son ancien verdict de retrieval avec eux, sinon la note survit à la question.
      setSearchRetrieval(null)
      return
    }
    let current = true
    const searchGeneration = searchGenerationRef.current
    const isCurrentSearch = (): boolean =>
      current && searchGeneration === searchGenerationRef.current
    const timeout = window.setTimeout(() => {
      if (!isCurrentSearch()) return
      window.api
        .searchBrain(selected, query)
        .then((envelope) => {
          if (!isCurrentSearch()) return
          setVaultSearch(envelope.results.map((result) => ({ ...result, group: 0 })))
          // Le STATUT du retrieval était jeté ici : `empty`, `invalid` et `unavailable` produisaient
          // tous une liste vide muette. On le conserve pour pouvoir DIRE lequel des trois c'est.
          setSearchRetrieval({ status: envelope.status, note: envelope.note })
        })
        .catch((error) => {
          if (!isCurrentSearch()) return
          // Une panne du canal n'est PAS « aucun résultat » : c'est le bug qu'on corrige.
          setVaultSearch([])
          setSearchRetrieval({
            status: 'failed',
            note: brainBusinessError('Recherche indisponible.', error)
          })
        })
    }, 200)
    return () => {
      current = false
      window.clearTimeout(timeout)
    }
  }, [brains, searchReload, selected, themeQuery])

  const selectedBrain = useMemo(
    () => brains.find((brain) => brain.path === selected),
    [brains, selected]
  )

  useEffect(() => {
    if (!selected) return
    const cacheKey = `${selected}\u0000${settings.lod}`
    if (selectedBrain?.kind === 'vault') {
      // Le renderer ne reçoit pas l'identité de corpus. Chaque reload du vault invalide donc les
      // voisinages dynamiques et leurs lectures en vol avant de fusionner preview puis graphe complet.
      dynamicGraphRef.current = { nodes: [], links: [] }
      fileRequestRef.current += 1
    } else {
      dynamicGraphRef.current = dynamicGraphForKey(
        dynamicGraphKeyRef.current,
        cacheKey,
        dynamicGraphRef.current
      )
    }
    dynamicGraphKeyRef.current = cacheKey
    // Un vault partage peut changer de corpus lorsque le workspace d'execution change.
    // Le worker possede un cache indexe par corpus ; le renderer ne connait pas cette cle.
    const cached = selectedBrain?.kind === 'vault' ? undefined : graphCacheRef.current.get(cacheKey)
    if (cached) {
      setGraph(cached)
      setLoading(false)
      setErr('')
      if (shouldAutoFitGraphPhase('cached')) setInitialFitRequest((request) => request + 1)
      return
    }
    let current = true
    // Une sélection sans cache ne doit jamais laisser les nœuds du Brain précédent actionnables.
    setGraph({ nodes: [], links: [] })
    queueMicrotask(() => {
      if (!current) return
      setLoading(true)
      setErr('')
    })
    window.api
      .loadBrainGraphPreview(selected, Math.min(settings.lod, 100))
      .then((loaded) => {
        if (current) {
          const next = loaded as GraphData
          setGraph(next)
        }
        return window.api.loadBrainGraph(selected, settings.lod)
      })
      .then((loaded) => {
        if (!current) return
        const next = completeProgressiveGraph(loaded as GraphData, dynamicGraphRef.current)
        if (selectedBrain?.kind !== 'vault') graphCacheRef.current.set(cacheKey, next)
        setGraph(next)
        if (shouldAutoFitGraphPhase('complete')) setInitialFitRequest((request) => request + 1)
      })
      .catch((error) => {
        if (current)
          setErr(brainBusinessError('Impossible de charger le graphe de connaissances.', error))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [graphReload, selected, selectedBrain?.kind, settings.lod])

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

  // Le moteur a besoin de finir son warmup avant un unique cadrage initial.
  // Ne pas dépendre du layout ou des filtres : ils ne doivent jamais déplacer la caméra.
  useEffect(() => {
    if (initialFitRequest === 0 || graph.nodes.length < 2) return
    if (initialFitTimeoutRef.current !== null) window.clearTimeout(initialFitTimeoutRef.current)
    initialFitTimeoutRef.current = window.setTimeout(() => {
      graphRef.current?.zoomToFit(600, 72)
      initialFitTimeoutRef.current = null
    }, 700)
    return () => {
      if (initialFitTimeoutRef.current !== null) window.clearTimeout(initialFitTimeoutRef.current)
      initialFitTimeoutRef.current = null
    }
  }, [graph.nodes.length, initialFitRequest])

  const themeSummaries = useMemo(
    () =>
      selectedBrain?.kind === 'vault' && selectedBrain.themes
        ? selectedBrain.themes.map((theme) => ({ ...theme, count: theme.count ?? 0 }))
        : buildThemeSummaries(graph.nodes, selectedBrain?.themes),
    [graph.nodes, selectedBrain]
  )
  const themeOrder = useMemo(() => themeSummaries.map((theme) => theme.id), [themeSummaries])
  const themeCounts = useMemo(
    () => new Map(themeSummaries.map((theme) => [theme.id, theme.count])),
    [themeSummaries]
  )
  const searchCatalogThemes = useMemo(
    () =>
      selectedBrain?.kind === 'vault' && themeQuery.trim()
        ? buildThemeSummaries(vaultSearch)
        : themeSummaries,
    [selectedBrain?.kind, themeQuery, themeSummaries, vaultSearch]
  )
  const catalogSearch = useMemo(
    () =>
      searchGraphCatalog(
        themeQuery,
        selectedBrain?.kind === 'vault' ? vaultSearch : graph.nodes,
        searchCatalogThemes
      ),
    [graph.nodes, searchCatalogThemes, selectedBrain?.kind, themeQuery, vaultSearch]
  )
  const visibleSearchNodes = selectedBrain?.kind === 'vault' ? vaultSearch : catalogSearch.nodes
  const displayGraph = useMemo(
    () => filterGraphVisibility(graph, settings.orphans),
    [graph, settings.orphans]
  )
  const healthIssues = useMemo(() => knowledgeHealthIssues(graph), [graph])
  const healthRelationByNode = useMemo(() => {
    const relations = new Map<string, 'contradicts' | 'supersedes'>()
    for (const issue of healthIssues) {
      for (const id of [issue.source.id, issue.target.id]) {
        if (issue.relation === 'contradicts' || !relations.has(id))
          relations.set(id, issue.relation)
      }
    }
    return relations
  }, [healthIssues])
  const tree = useMemo(
    () =>
      layoutMode === 'tree'
        ? // Le premier anneau porte l'axe SUJET — « de quoi ça parle ». C'est celui que la campagne
          // d'architecture a désigné : 78 % de premier choix juste et surtout l'étendue la plus
          // FAIBLE (72-83 %), là où l'axe par nature cognitive oscillait de 44 % à 83 % selon le
          // tirage. Une lecture dont le résultat dépend du tirage ne peut pas servir de socle.
          // Toujours une couche de lecture dérivée : aucun fichier n'est déplacé dans le Brain.
          layoutTree(displayGraph.nodes, { groupOf: brainSubjectOf })
        : null,
    [layoutMode, displayGraph.nodes]
  )
  const visibleTree = useMemo(
    () => (tree ? projectTreeVisibility(tree, collapsedTreeNodeIds) : null),
    [collapsedTreeNodeIds, tree]
  )

  const renderedGraph = useMemo(() => {
    if (layoutMode !== 'tree' || !visibleTree) {
      return {
        nodes: displayGraph.nodes.map((graphNode) => ({ ...graphNode })),
        links: displayGraph.links.map((graphLink) => ({ ...graphLink }))
      }
    }
    {
      // Une fiche = une FEUILLE. Les nœuds internes (dossiers) ne sont pas des fiches : ils sont
      // dessinés à part, avec les branches et les anneaux.
      const parNote = new Map(
        visibleTree.nodes.filter((n) => n.noteId !== undefined).map((n) => [String(n.noteId), n])
      )
      return {
        nodes: [
          ...displayGraph.nodes.flatMap((graphNode) => {
            const feuille = parNote.get(String(graphNode.id))
            if (!feuille) return []
            return [
              {
                ...graphNode,
                fx: feuille.fx,
                fy: feuille.fy,
                fz: 0,
                x: feuille.fx,
                y: feuille.fy,
                z: 0
              }
            ]
          }),
          ...visibleTree.nodes
            .filter((treeNode) => !treeNode.isLeaf && treeNode.depth > 0)
            .map((treeNode): GraphNode => ({
              id: `__tree__:${treeNode.id}`,
              label: treeNode.label,
              group: treeNode.depth,
              treeNodeId: treeNode.id,
              treeDepth: treeNode.depth,
              treeLeaves: treeNode.leaves,
              treeCollapsed: collapsedTreeNodeIds.has(treeNode.id),
              fx: treeNode.fx,
              fy: treeNode.fy,
              fz: 4,
              x: treeNode.fx,
              y: treeNode.fy,
              z: 4
            }))
        ],
        // Les liens SÉMANTIQUES restent absents : le commentaire du mode bandes vaut ici aussi, ils
        // traverseraient le disque en tous sens. Ce qui est dessiné, ce sont les branches de
        // FILIATION — un jeu d'arêtes différent, et celui-là a bien un parent unique.
        links: []
      }
    }
  }, [collapsedTreeNodeIds, displayGraph, layoutMode, visibleTree])

  /**
   * DESSIN de l'arborescence : les anneaux de niveau, les branches de filiation, les nœuds internes.
   *
   * Les fiches elles-mêmes sont rendues par le graphe (elles sont épinglées sur leurs feuilles) ;
   * ce qui manque et que rien d'autre ne trace, c'est la STRUCTURE — sans elle on retombe sur des
   * points sans lien, exactement ce que cette vue doit corriger.
   *
   * Étiquetage : seuls les nœuds INTERNES portent un nom. L'utilisateur a demandé l'arbre complet
   * jusqu'à la note, ce qui met ~564 feuilles sur l'anneau externe, à ~0,64° l'une de l'autre. La
   * structure se lit très bien à cette densité, mais 564 étiquettes simultanées seraient une bouillie
   * illisible — c'est une limite physique, pas un choix de goût.
   */
  useEffect(() => {
    const instance = graphRef.current
    if (!instance || layoutMode !== 'tree' || !tree || !visibleTree) return
    const scene = instance.scene()
    if (!scene) return
    const added: THREE.Object3D[] = []

    // Les anneaux de niveau, en pointillé discret : ils disent « ceci est une profondeur ».
    tree.ringRadii.forEach((radius, depth) => {
      if (radius <= 0) return
      const points: THREE.Vector3[] = []
      for (let step = 0; step <= 128; step++) {
        const angle = (step / 128) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, -2))
      }
      const loop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(BAND_COLORS[depth % BAND_COLORS.length]),
          transparent: true,
          opacity: 0.14
        })
      )
      scene.add(loop)
      added.push(loop)
    })

    // Les branches, en UN seul objet : ~700 arêtes en autant d'objets three.js écroulerait le rendu.
    const parId = new Map(visibleTree.nodes.map((n) => [n.id, n]))
    const sommets: number[] = []
    const couleurs: number[] = []
    for (const edge of visibleTree.edges) {
      const from = parId.get(edge.from)
      const to = parId.get(edge.to)
      if (!from || !to) continue
      const teinte = new THREE.Color(BAND_COLORS[edge.depth % BAND_COLORS.length])
      sommets.push(from.fx, from.fy, -1, to.fx, to.fy, -1)
      // Une branche profonde est plus pâle : la hiérarchie se lit d'un coup d'œil.
      const fondu = Math.max(0.25, 1 - edge.depth * 0.16)
      for (let i = 0; i < 2; i += 1)
        couleurs.push(teinte.r * fondu, teinte.g * fondu, teinte.b * fondu)
    }
    if (sommets.length > 0) {
      const geometrie = new THREE.BufferGeometry()
      geometrie.setAttribute('position', new THREE.Float32BufferAttribute(sommets, 3))
      geometrie.setAttribute('color', new THREE.Float32BufferAttribute(couleurs, 3))
      const branches = new THREE.LineSegments(
        geometrie,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 })
      )
      scene.add(branches)
      added.push(branches)
    }

    // Les étiquettes sont décidées AVANT d'être posées : il faut les connaître toutes pour savoir
    // lesquelles se marchent dessus. Mesuré sur le vault réel — les huit dossiers sous `projects`
    // empilaient huit libellés au même endroit, exactement le défaut corrigé sur les couronnes.
    const aNommer = visibleTree.nodes.filter(
      (n) => !n.isLeaf && shouldLabelTreeNode(n, treeZoomTier)
    )
    // CONVERSION D'UNITÉS — c'est tout le sujet des deux corrections ratées avant celle-ci. Les
    // étiquettes sont des sprites en `sizeAttenuation: false` : leur taille est une FRACTION DE
    // L'ÉCRAN (3,5 % de la hauteur), constante quelle que soit la distance. Leur POSITION, elle, est
    // en unités de scène. Écarter de « 34 » revenait donc à écarter de ~17 px au zoom courant —
    // moitié moins qu'une étiquette, d'où des libellés toujours empilés sur la capture.
    //
    // Le facteur se CALCULE, il ne se tâtonne pas : avec un FOV vertical de 50°, la demi-hauteur
    // visible à la distance d vaut d·tan(25°) ≈ 0,466·d. Le champ fait donc 0,932·d unités de haut,
    // et un sprite de 3,5 % d'écran y mesure 0,035 × 0,932 × d unités.
    const distanceCamera = (treeBoundingRadius(tree) + 26 + MIN_LABEL_GAP * 3) * 2.6
    const hauteurEtiquette = LABEL_SCREEN_HEIGHT * 0.932 * distanceCamera

    // On calcule d'abord OÙ chaque étiquette tomberait, puis on décide lesquelles sont dessinées.
    // Les étiquettes de CATÉGORIE sont posées sur le pourtour du disque, pas contre leur nœud. À
    // l'anneau 1 les cinq catégories sont très proches en angle — `Savoir` occupe 83 % du cercle et
    // tasse les autres dans le reste — donc leurs libellés se disputaient le même coin : mesuré sur
    // capture, deux seulement survivaient. Au rayon extérieur, le même écart angulaire donne
    // largement la place, et la catégorie reste alignée sur son propre secteur.
    const rayonPourtour = treeBoundingRadius(tree) + 40
    const poses = aNommer.map((n) => {
      const pousse = n.depth === 1 ? rayonPourtour : n.radius + 26
      return {
        x: Math.cos(n.angle) * pousse,
        y: Math.sin(n.angle) * pousse,
        // Dans la MÊME unité que la position : ~0,55 hauteur par caractère.
        width: `${n.label} · ${n.leaves}`.length * hauteurEtiquette * 0.55,
        height: hauteurEtiquette,
        // Le nombre de fiches sous le nœud fait l'importance — SAUF pour le premier anneau. Les
        // catégories cognitives sont l'ancrage de toute la lecture : sans leurs noms, l'anneau ne
        // dit plus rien. Mesuré sur capture — seule `Savoir · 250` survivait, les trois autres
        // perdant l'arbitrage face à des dossiers voisins plus gros.
        priority: n.depth === 1 ? Number.MAX_SAFE_INTEGER - n.depth : n.leaves
      }
    })
    const visibles = pickVisibleLabels(poses)
    const poseDe = new Map(
      aNommer.flatMap((n, i) => (visibles[i] ? [[n.id, { x: poses[i].x, y: poses[i].y }]] : []))
    )

    // Les disques internes sont rendus par ForceGraph pour rester cliquables ; cette couche ne pose
    // que leurs libellés connectés.
    for (const noeud of visibleTree.nodes) {
      if (noeud.isLeaf) continue
      const pose = poseDe.get(noeud.id)
      if (pose === undefined) continue
      const label = createConnectedLabel(
        `${collapsedTreeNodeIds.has(noeud.id) ? '▸ ' : ''}${noeud.label} · ${noeud.leaves}`,
        new THREE.Color(BAND_COLORS[noeud.depth % BAND_COLORS.length]).getStyle()
      )
      // Poussée vers l'EXTÉRIEUR le long de son propre rayon, puis écartée en Y si elle recouvrait
      // une voisine — l'écartement radial seul ne séparait pas les libellés visant la gauche.
      label.position.set(pose.x, pose.y, 14)
      scene.add(label)
      added.push(label)
    }

    return () => {
      for (const object of added) {
        scene.remove(object)
        const disposable = object as unknown as {
          geometry?: { dispose?: () => void }
          material?: { dispose?: () => void }
        }
        disposable.geometry?.dispose?.()
        disposable.material?.dispose?.()
      }
    }
  }, [collapsedTreeNodeIds, layoutMode, tree, treeZoomTier, visibleTree])

  /**
   * L'arbre est une vue 2D : on coupe la 3ᵉ dimension et on fait converger le zoom vers le CURSEUR.
   *
   * Pourquoi c'est nécessaire : le disque est strictement plat (tous les nœuds à `z = 0`), mais les
   * contrôles par défaut de la bibliothèque sont des trackball, qui tournent librement sur trois
   * axes. Un simple glissement fait donc basculer le disque jusqu'à le voir PAR LA TRANCHE — une
   * ligne. Et la molette zoome vers le centre de l'écran, alors que sur un arbre l'information
   * intéressante est en périphérie : il fallait zoomer puis recadrer à la main, en boucle.
   *
   * `OrbitControls` fait exactement cela nativement — `zoomToCursor` existe pour ça. On ne
   * réimplémente donc rien : on désarme la rotation, on met le panoramique dans le plan de l'écran,
   * et on branche le zoom sur le pointeur.
   */
  useEffect(() => {
    if (layoutMode !== 'tree' || !tree) return
    const controls = graphRef.current?.controls() as
      | {
          enableRotate?: boolean
          screenSpacePanning?: boolean
          zoomToCursor?: boolean
          target?: { x: number; y: number; z: number }
          mouseButtons?: { LEFT?: number; MIDDLE?: number; RIGHT?: number }
          touches?: { ONE?: number; TWO?: number }
          addEventListener?: (type: 'change', listener: () => void) => void
          removeEventListener?: (type: 'change', listener: () => void) => void
          update?: () => void
        }
      | undefined
    if (!controls) return
    controls.enableRotate = false
    controls.screenSpacePanning = true
    controls.zoomToCursor = true
    // Le bouton GAUCHE doit déplacer, pas tourner : c'est le geste naturel sur une carte, et la
    // rotation étant désarmée il ne ferait plus rien du tout.
    if (controls.mouseButtons) {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    }
    if (controls.touches) controls.touches.ONE = THREE.TOUCH.PAN
    const updateSemanticZoom = (): void => {
      const position = (
        graphRef.current as unknown as { cameraPosition(): { x: number; y: number; z: number } }
      )?.cameraPosition?.()
      if (!position) return
      const target = controls.target ?? { x: 0, y: 0, z: 0 }
      const zoomDistance = Math.hypot(
        position.x - target.x,
        position.y - target.y,
        position.z - target.z
      )
      const tier = semanticZoomTier(zoomDistance, treeBoundingRadius(tree))
      if (wrap.current) {
        wrap.current.dataset.treeZoomDistance = String(Math.round(zoomDistance * 100) / 100)
        wrap.current.dataset.cameraZ = String(Math.round(position.z * 100) / 100)
        wrap.current.dataset.cameraSample = 'measured'
      }
      setTreeZoomTier((current) => (current === tier ? current : tier))
    }
    controls.addEventListener?.('change', updateSemanticZoom)
    controls.update?.()
    updateSemanticZoom()
    return () => controls.removeEventListener?.('change', updateSemanticZoom)
  }, [layoutMode, tree])

  /** Recadrage de l'arborescence — même raison qu'en bandes : le disque est plat, donc vu par la tranche. */
  useEffect(() => {
    if (layoutMode !== 'tree' || !tree) return
    // L'ouverture d'une fiche charge ensuite son voisinage, ce qui recrée `tree`. Ce rafraîchissement
    // de données ne doit pas être pris pour une première ouverture de la vue et écraser le gros plan.
    if (viewBeforeFocusRef.current) return
    // Cadrer sur les NŒUDS seuls coupait le haut et la droite : les étiquettes vivent plus loin que
    // le nœud qu'elles nomment, et la colonne de gauche mange encore de la largeur. On cadre donc sur
    // le rayon des nœuds AUGMENTÉ de la portée maximale d'une étiquette.
    const radius = treeBoundingRadius(tree) + 26 + MIN_LABEL_GAP * 3
    if (radius <= 0) return
    const timeout = window.setTimeout(() => {
      graphRef.current?.cameraPosition({ x: 0, y: 0, z: radius * 2.6 }, { x: 0, y: 0, z: 0 }, 600)
    }, 120)
    return () => window.clearTimeout(timeout)
  }, [layoutMode, tree])

  // react-force-graph-3d positionne ses nœuds par mutation. `renderedGraph` est une copie profonde
  // dédiée au moteur impératif : `graph` et `displayGraph`, détenus par React, restent immuables.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const instance = graphRef.current
    if (!instance) return
    const previousSpacing = previousNodeSpacingRef.current
    const positionRatio = settings.nodeSpacing / previousSpacing
    if (positionRatio !== 1) {
      for (const graphNode of renderedGraph.nodes) {
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
  }, [renderedGraph, settings.nodeSpacing])
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    saveGraphVisibilitySettings(localStorage, settings)
  }, [settings])

  const highlightedNodeIds = useMemo(
    () => highlightedNodeIdsForThemes(graph.nodes, activeThemes),
    [activeThemes, graph.nodes]
  )
  const highlightedCount = highlightedNodeIds.size
  const activeThemeNodes = useMemo(
    () => nodesForThemesAlphabetically(themeNodes, activeThemes),
    [activeThemes, themeNodes]
  )
  const visualProfile = getGraphVisualProfile(visualMode)
  const motionProfile = graphMotionProfile()
  const linkedNodes = useMemo(() => (node ? linkedNodesFor(node.id, graph) : []), [graph, node])
  const visualActiveThemes = node ? EMPTY_THEME_SELECTION : activeThemes
  const hoveredNodeIds = useMemo(() => new Set(hoveredNode ? [hoveredNode.id] : []), [hoveredNode])
  const selectedNodeIds = useMemo(
    () => (node ? focusedNodeIdsFor(node.id, graph) : new Set<string>()),
    [graph, node]
  )
  const nodeFocus = useMemo(
    () =>
      nodeFocusForSelectionOrHover(
        node?.id ?? null,
        hoveredNode?.id ?? null,
        selectedNodeIds,
        hoveredNodeIds
      ),
    [hoveredNode, hoveredNodeIds, node, selectedNodeIds]
  )
  const floatingNodeIds = useMemo(
    () =>
      floatingNodeIdsForThemeHighlight(
        visualActiveThemes.size > 0 ? highlightedNodeIds : new Set(),
        node ? new Set() : hoveredNode ? hoveredNodeIds : new Set(),
        new Set(linkedNodes.map((linked) => linked.node.id))
      ),
    [highlightedNodeIds, hoveredNode, hoveredNodeIds, linkedNodes, node, visualActiveThemes]
  )
  useEffect(() => {
    graphRef.current?.refresh()
  }, [activeThemes, floatingNodeIds, highlightedNodeIds, selectedNodeIds, visualMode])
  // Mode galaxy « vivant » : les étoiles scintillent (opacité + taille) — une boucle rAF module
  // les sprites marqués userData.twinkle. Coupée hors mode galaxy (zéro coût en mode sombre).
  useEffect(() => {
    if (!active || visualMode !== 'galaxy') return
    let frame = 0
    const animate = (time: number): void => {
      const scene = graphRef.current?.scene()
      scene?.traverse((object) => {
        const twinkle = object.userData.twinkle as
          | { phase: number; speed: number; baseOpacity: number; baseScale: number; amp: number }
          | undefined
        if (!twinkle || !(object instanceof THREE.Sprite)) return
        const wave = Math.sin(time * 0.0012 * twinkle.speed + twinkle.phase)
        object.material.opacity =
          twinkle.baseOpacity * (1 - twinkle.amp / 2 + (twinkle.amp / 2) * wave)
        const size =
          twinkle.baseScale *
          (1 + 0.06 * twinkle.amp * Math.sin(time * 0.0017 * twinkle.speed + twinkle.phase * 1.7))
        object.scale.set(size, size, 1)
      })
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [active, visualMode])
  const detailOpen = Boolean(node) || activeThemes.size > 0
  const visibleThemeLabelIds = useMemo(
    () => new Set(visibleThemeClusterIds(themeSummaries, activeThemes, node)),
    [activeThemes, node, themeSummaries]
  )
  /**
   * Les pastilles de thème sont MASQUÉES en radial : mesuré sur capture, les ~30 pastilles flottantes se
   * superposaient au disque et noyaient les anneaux qu'elles étaient censées commenter. En radial, la
   * légende est portée par les libellés de BANDE dessinés dans la scène (`FAMILLE · effectif`), qui sont
   * posés à un rayon fixe et ne se recouvrent donc jamais.
   */
  const showThemeClusterLabels = layoutMode !== 'tree' && visibleThemeLabelIds.size > 0

  useEffect(() => {
    const requestId = ++themeNodesRequestRef.current
    const themeIds = [...activeThemes]
    if (!selected || themeIds.length === 0) return
    window.api
      .loadBrainThemeNodes(selected, themeIds)
      .then((loaded) => {
        if (requestId === themeNodesRequestRef.current) {
          setThemeNodes(loaded as GraphNode[])
          setThemeNodesErr('')
        }
      })
      .catch((error) => {
        if (requestId === themeNodesRequestRef.current) {
          setThemeNodes([])
          // Ce canal écrasait l'erreur GLOBALE du graphe : il porte désormais la sienne, réessayable.
          setThemeNodesErr(brainBusinessError('Impossible de charger les notes du thème.', error))
        }
      })
  }, [activeThemes, graphReload, selected, themeNodesReload])

  const syncThemeClusterLabels = useCallback((): void => {
    const graphApi = graphRef.current
    const layer = themeLabelsRef.current
    if (!graphApi) return
    const camera = (
      graphApi as unknown as { cameraPosition(): { x: number; y: number; z: number } }
    ).cameraPosition()
    if (wrap.current && camera) {
      wrap.current.dataset.cameraDistance = String(
        Math.round(Math.hypot(camera.x, camera.y, camera.z) * 100) / 100
      )
      wrap.current.dataset.cameraZ = String(Math.round(camera.z * 100) / 100)
    }
    if (!layer || !showThemeClusterLabels) return
    const anchors = themeClusterAnchors(renderedGraph.nodes, themeSummaries)
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
  }, [renderedGraph.nodes, showThemeClusterLabels, themeSummaries])

  useEffect(() => {
    const frame = requestAnimationFrame(syncThemeClusterLabels)
    return () => cancelAnimationFrame(frame)
  }, [syncThemeClusterLabels])

  useEffect(() => {
    if (!active || !showThemeClusterLabels) return
    let frame = 0
    const followCamera = (): void => {
      syncThemeClusterLabels()
      frame = requestAnimationFrame(followCamera)
    }
    frame = requestAnimationFrame(followCamera)
    return () => cancelAnimationFrame(frame)
  }, [active, showThemeClusterLabels, syncThemeClusterLabels])

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
            const detail = fitDetailColumnWidth(current.detail, contentWidth, current.theme)
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

  function patchSettings(patch: Partial<GraphVisibilitySettings>): void {
    setSettings((current) => ({ ...current, ...patch }))
  }

  function invalidatePendingGraphFit(): void {
    if (initialFitTimeoutRef.current !== null) window.clearTimeout(initialFitTimeoutRef.current)
    initialFitTimeoutRef.current = null
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
          : contentWidth - themeWidth - GRAPH_COLUMN_LIMITS.detailGraph
    const maxWidth = Math.max(limits.min, Math.min(limits.max, availableWidth))
    const width = Math.round(Math.min(maxWidth, Math.max(limits.min, rawWidth)))
    if (column === 'detail') {
      // Sauve dans le slot du mode courant (thème/nœud) → persistance par mode, zéro conflit.
      const mode = node ? 'node' : activeThemes.size > 0 ? 'theme' : null
      if (mode) setDetailWidths((current) => ({ ...current, [mode]: width }))
      return
    }
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
    invalidatePendingGraphFit()
    clearNodeSelection()
    setThemeNodes([])
    setActiveThemes(toggleThemeSelection(activeThemes, theme))
    // Largeur de la colonne détail = pilotée par le mode en CSS (is-theme-detail).
  }

  function activateThemeCluster(theme: string): void {
    invalidatePendingGraphFit()
    clearNodeSelection()
    setThemeNodes([])
    setActiveThemes((current) => selectExclusiveTheme(current, theme))
  }

  function surClicDeFond(): void {
    clearNodeSelection()
  }

  function clearNodeSelection(): void {
    // Rendre le point de vue d'où l'on est parti : c'est ce qui « réintègre » visuellement le nœud
    // dans le graphe. La mémoire est libérée par `restoreView`, jamais rejouée deux fois.
    viewBeforeFocusRef.current = restoreView(
      viewBeforeFocusRef.current,
      graphRef.current as unknown as CameraHandle
    )
    fileRequestRef.current += 1
    setExpandingNodeId(null)
    setNode(null)
    setHoveredNode(null)
    setFile(null)
    setFileErr('')
    setPanelTab('node')
  }

  function focusNode(nextNode: GraphNode): void {
    const treeLeaf =
      layoutMode === 'tree' && tree
        ? tree.nodes.find((treeNode) => String(treeNode.noteId) === String(nextNode.id))
        : undefined
    const coordinates = treeLeaf
      ? { x: treeLeaf.fx, y: treeLeaf.fy, z: 0 }
      : { x: nextNode.x, y: nextNode.y, z: nextNode.z }
    if (
      [coordinates.x, coordinates.y, coordinates.z].some(
        (coordinate) => typeof coordinate !== 'number'
      )
    )
      return
    if (treeLeaf && tree) {
      const parentById = new Map(tree.nodes.map((treeNode) => [treeNode.id, treeNode.parentId]))
      const ancestors = new Set<string>()
      let parentId = treeLeaf.parentId
      while (parentId) {
        ancestors.add(parentId)
        parentId = parentById.get(parentId) ?? null
      }
      // Une alerte de santé peut viser une note masquée dans une branche repliée : l'ouvrir doit la
      // rendre visible, pas seulement déplacer la caméra vers un point absent.
      setCollapsedTreeNodeIds((current) => {
        if (![...ancestors].some((id) => current.has(id))) return current
        const next = new Set(current)
        for (const id of ancestors) next.delete(id)
        return next
      })
    }
    // Mémoriser AVANT de s'approcher : sans ça, refermer la fiche laisse la caméra braquée sur le
    // nœud, qui paraît figé au centre de l'écran, seul, tout le reste hors champ.
    viewBeforeFocusRef.current = rememberViewBeforeFocus(
      viewBeforeFocusRef.current,
      graphRef.current as unknown as CameraHandle
    )
    const x = coordinates.x as number
    const y = coordinates.y as number
    const z = coordinates.z as number
    const treeRadius = layoutMode === 'tree' && tree ? treeBoundingRadius(tree) : undefined
    const focus = focusCameraView(
      { x, y, z },
      layoutMode === 'tree',
      treeRadius === undefined ? undefined : treeRadius * 0.72
    )
    if (layoutMode === 'tree' && tree) {
      // `cameraPosition(..., duration)` anime la caméra sans garantir un événement `change` des
      // contrôles OrbitControls. Le focus piloté par la fiche doit donc publier lui-même le niveau
      // de zoom attendu, sinon les libellés restent bloqués sur « overview » malgré le rapprochement.
      const zoomDistance = Math.hypot(
        focus.position.x - focus.target.x,
        focus.position.y - focus.target.y,
        focus.position.z - focus.target.z
      )
      setTreeZoomTier(semanticZoomTier(zoomDistance, treeRadius ?? treeBoundingRadius(tree)))
      if (wrap.current) wrap.current.dataset.cameraSample = 'pending'
    }
    graphRef.current?.cameraPosition(focus.position, focus.target, 700)
  }

  async function openNode(nextNode: GraphNode): Promise<void> {
    const requestId = ++fileRequestRef.current
    setNode(nextNode)
    setPanelTab('node')
    // Largeur de la colonne détail = pilotée par le mode en CSS (is-node-detail).
    focusNode(nextNode)
    setFile(null)
    setFileErr('')
    setExpandingNodeId(nextNode.id)
    window.api
      .loadBrainNeighborhood(selected, nextNode.id)
      .then((loaded) => {
        if (requestId !== fileRequestRef.current) return
        const delta = loaded as GraphData
        dynamicGraphRef.current = mergeGraphDelta(dynamicGraphRef.current, delta)
        const cacheKey = `${selected}\u0000${settings.lod}`
        setGraph((currentGraph) => {
          const merged = mergeGraphDelta(currentGraph, delta)
          if (selectedBrain?.kind !== 'vault') graphCacheRef.current.set(cacheKey, merged)
          return merged
        })
        const loadedNode = delta.nodes.find((candidate) => candidate.id === nextNode.id)
        if (loadedNode) setNode(loadedNode)
      })
      .catch((error) => {
        if (requestId === fileRequestRef.current)
          setFileErr(brainBusinessError('Impossible de charger le voisinage.', error))
      })
      .finally(() => {
        if (requestId === fileRequestRef.current) setExpandingNodeId(null)
      })
    if (!nextNode.file) {
      setFileErr('Ce nœud n’a pas de fichier source.')
      return
    }
    try {
      const loadedFile = await window.api.readNodeFile(
        nextNode.file,
        selectedBrain?.kind === 'vault' ? selected : undefined
      )
      if (requestId === fileRequestRef.current) setFile(loadedFile)
    } catch (error) {
      if (requestId === fileRequestRef.current)
        setFileErr(brainBusinessError('Impossible de lire la fiche.', error))
    }
  }

  async function retractSelectedKnowledge(): Promise<void> {
    if (!node || !node.id.startsWith('knowledge/') || selectedBrain?.kind !== 'vault') return
    setFileErr('')
    try {
      await window.api.retractKnowledge(selected, node.id)
      clearNodeSelection()
      reloadAfterInboxDecision(selected)
    } catch (error) {
      setFileErr(brainBusinessError('Impossible de retirer cette fiche du Brain.', error))
    }
  }

  async function supersedeSelectedKnowledge(): Promise<void> {
    if (!node || !node.id.startsWith('knowledge/') || selectedBrain?.kind !== 'vault') return
    const replacementId = window.prompt(
      'Identifiant de la fiche canonique de remplacement (knowledge/…)',
      'knowledge/'
    )
    if (!replacementId?.trim()) return
    setFileErr('')
    try {
      await window.api.supersedeKnowledge(selected, node.id, replacementId.trim())
      clearNodeSelection()
      reloadAfterInboxDecision(selected)
    } catch (error) {
      setFileErr(brainBusinessError('Impossible de remplacer cette fiche.', error))
    }
  }

  function activateGraphNode(nextNode: GraphNode): void {
    if (layoutMode === 'tree' && nextNode.treeNodeId) {
      toggleTreeBranch(nextNode.treeNodeId)
      setHoveredNode(null)
      return
    }
    void openNode(nextNode)
  }

  function toggleTreeBranch(treeNodeId: string): void {
    setCollapsedTreeNodeIds((current) => {
      const updated = new Set(current)
      if (updated.has(treeNodeId)) updated.delete(treeNodeId)
      else updated.add(treeNodeId)
      return updated
    })
  }

  const healthColor = useCallback(
    (nextNode: GraphNode): string | undefined => {
      if (!settings.health) return undefined
      const relation = healthRelationByNode.get(nextNode.id)
      return relation === 'contradicts'
        ? '#ff5c8a'
        : relation === 'supersedes'
          ? '#facc15'
          : undefined
    },
    [healthRelationByNode, settings.health]
  )
  const nodeColor = (value: object): string => {
    const nextNode = value as GraphNode
    return (
      healthColor(nextNode) ??
      nodeColorForTheme(
        nextNode,
        visualActiveThemes,
        settings.contextOpacity,
        themeOrder,
        visualProfile.palette,
        themeCounts
      )
    )
  }
  const nodeValue = (value: object): number => {
    const nextNode = value as GraphNode
    return (
      nodeValueForTheme(nextNode, visualActiveThemes, settings.nodeSize) *
      visualProfile.nodeScale *
      (healthColor(nextNode) ? 1.35 : 1)
    )
  }
  const treeBranchObject = useCallback((nextNode: GraphNode): THREE.Object3D => {
    const radius = Math.max(3, Math.min(14, 2.4 * Math.sqrt(nextNode.treeLeaves ?? 1)))
    return new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(
          nextNode.treeCollapsed
            ? '#ff9f43'
            : BAND_COLORS[(nextNode.treeDepth ?? 0) % BAND_COLORS.length]
        ),
        transparent: true,
        opacity: 0.92
      })
    )
  }, [])
  const galaxyNodeObject = useCallback(
    (value: object): THREE.Object3D => {
      const nextNode = value as GraphNode
      if (nextNode.treeNodeId) return treeBranchObject(nextNode)
      const appearance = galaxyNodeAppearance(
        nextNode,
        visualActiveThemes,
        settings.contextOpacity,
        themeOrder,
        visualProfile.palette,
        themeCounts
      )
      appearance.color = healthColor(nextNode) ?? appearance.color
      const emphasis = nodeSelectionEmphasis(
        nextNode.id,
        nodeFocus.focusedNodeId,
        nodeFocus.focusedNodeIds
      )
      appearance.opacity *= emphasis.opacity
      const star = createGalaxyStar(
        nextNode,
        appearance,
        nodeValueForTheme(nextNode, visualActiveThemes, settings.nodeSize) *
          visualProfile.nodeScale *
          emphasis.scale
      )
      if (
        settings.labels &&
        ((layoutMode === 'tree' && treeZoomTier === 'notes') ||
          shouldShowFloatingNodeName(nextNode, floatingNodeIds))
      )
        star.add(createConnectedLabel(nextNode.label, appearance.color, star.scale.x, 0.03))
      return star
    },
    [
      floatingNodeIds,
      healthColor,
      layoutMode,
      nodeFocus,
      settings.contextOpacity,
      settings.labels,
      settings.nodeSize,
      themeCounts,
      themeOrder,
      treeBranchObject,
      treeZoomTier,
      visualActiveThemes,
      visualProfile
    ]
  )
  const seriousNodeObject = useCallback(
    (value: object): THREE.Object3D => {
      const nextNode = value as GraphNode
      if (nextNode.treeNodeId) return treeBranchObject(nextNode)
      const appearance = galaxyNodeAppearance(
        nextNode,
        visualActiveThemes,
        settings.contextOpacity,
        themeOrder,
        visualProfile.palette,
        themeCounts
      )
      appearance.color = healthColor(nextNode) ?? appearance.color
      const emphasis = nodeSelectionEmphasis(
        nextNode.id,
        nodeFocus.focusedNodeId,
        nodeFocus.focusedNodeIds
      )
      appearance.opacity *= emphasis.opacity
      return createSeriousNode(
        nextNode,
        appearance,
        nodeValueForTheme(nextNode, visualActiveThemes, settings.nodeSize) *
          visualProfile.nodeScale *
          emphasis.scale,
        settings.labels &&
          ((layoutMode === 'tree' && treeZoomTier === 'notes') ||
            shouldShowFloatingNodeName(nextNode, floatingNodeIds))
      )
    },
    [
      floatingNodeIds,
      healthColor,
      layoutMode,
      nodeFocus,
      settings.contextOpacity,
      settings.labels,
      settings.nodeSize,
      themeCounts,
      themeOrder,
      treeBranchObject,
      treeZoomTier,
      visualActiveThemes,
      visualProfile
    ]
  )
  const focusedNode = node
  const linkIsHighlighted = (value: object): boolean =>
    Boolean(focusedNode?.id) && isLinkAttachedToNode(value as GraphLink, focusedNode?.id ?? '')
  const linkColor = (value: object): string => {
    return graphLinkColor(visualMode, visualProfile, linkIsHighlighted(value))
  }
  // Mode détail courant → largeur persistée de CE mode (sinon défaut CSS 20%/88% via la classe).
  const detailMode: 'node' | 'theme' | null = node ? 'node' : activeThemes.size > 0 ? 'theme' : null
  const activeDetailWidth = detailMode ? detailWidths[detailMode] : null
  return (
    <section
      ref={layoutRef}
      className={`graph-observatory ${visualProfile.modeClass} ${detailOpen ? 'is-detail-open' : ''} ${node ? 'is-node-detail' : activeThemes.size > 0 ? 'is-theme-detail' : ''} ${resizingColumn ? 'is-column-resizing' : ''}`}
      style={
        {
          '--theme-column-width': `${columnWidths.theme}px`,
          '--visibility-column-width': `${columnWidths.visibility}px`,
          ...(activeDetailWidth == null
            ? {}
            : { '--detail-column-width': `${activeDetailWidth}px` })
        } as React.CSSProperties
      }
    >
      <header className="graph-toolbar">
        <ModuleHeader
          eyebrow="Connaissances connectées"
          title="Memory"
          description="Explore les connaissances reliées de ton Brain."
        />
        <select
          aria-label="Graphe de connaissances"
          value={selected}
          onChange={(event) => {
            resetBrainSearchResults()
            // Les résultats appartiennent au vault quitté : les garder jusqu'à la recherche suivante
            // ferait momentanément passer une fiche de A pour une fiche de B.
            // Second chemin de sortie de la fiche : il dupliquait la remise à plat et oubliait donc
            // la caméra, laissant un gros plan sur un nœud qui n'existe plus dans le graphe suivant.
            clearNodeSelection()
            setSelected(event.target.value)
            setActiveThemes(new Set())
            setCollapsedTreeNodeIds(new Set())
          }}
        >
          {brains.length === 0 && (
            <option value="">
              {brainsLoading ? 'Détection des graphes…' : 'Aucun graphe accessible'}
            </option>
          )}
          {brains.map((brain) => (
            <option key={brain.path} value={brain.path}>
              {brain.label}
              {brain.kind === 'graphify' ? ` · ${brain.sizeMb} Mo` : ''}
            </option>
          ))}
        </select>
        {/* Un catalogue vide ou en panne n'est plus un cul-de-sac : la détection se relance ici. */}
        {!brainsLoading && (brains.length === 0 || brainsErr) && (
          <span className="graph-brains-recovery" role={brainsErr ? 'alert' : undefined}>
            {brainsErr && <span className="graph-brains-recovery__message">{brainsErr}</span>}
            <button
              type="button"
              className="graph-brains-retry"
              onClick={refreshBrains}
              title="Relancer la détection des graphes de connaissances"
            >
              Réessayer la détection
            </button>
          </span>
        )}
        <button
          type="button"
          className="graph-refresh"
          onClick={refreshGraph}
          disabled={loading}
          aria-label="Rafraîchir les graphes"
          title="Rafraîchir les graphes"
        >
          ↻
        </button>
        <button
          type="button"
          role="switch"
          className={`graph-layout-switch${layoutMode === 'tree' ? ' is-tree' : ''}`}
          onClick={() => {
            const next = nextGraphLayoutMode(layoutMode)
            setLayoutMode(next)
            saveGraphLayoutMode(localStorage, next)
          }}
          // Le bouton a TROIS états, donc `aria-checked` ne peut plus valoir « radial ou rien » : en
          // arborescence il aurait annoncé « éteint » à un lecteur d'écran alors qu'un agencement est
          // bien actif. `mixed` est la valeur prévue par ARIA pour un troisième état.
          aria-checked={layoutMode === 'tree'}
          aria-label="Disposition du graphe"
          data-layout-mode={layoutMode}
          title={LIBELLE_BASCULE[layoutMode]}
        >
          {ICONE_BASCULE[layoutMode]}
        </button>
        <button
          type="button"
          role="switch"
          className={`graph-mode-switch${visualMode === 'galaxy' ? ' is-galaxy' : ''}`}
          onClick={() => {
            const next = visualMode === 'galaxy' ? 'serious' : 'galaxy'
            setVisualMode(next)
            saveGraphVisualMode(localStorage, next)
          }}
          aria-checked={visualMode === 'galaxy'}
          title={visualMode === 'galaxy' ? 'Repasser en mode sombre' : 'Passer en mode galaxy'}
        >
          <span className="graph-mode-switch__track" aria-hidden="true">
            <span className="graph-mode-switch__icon">🌑</span>
            <span className="graph-mode-switch__icon">🌌</span>
            <span className="graph-mode-switch__thumb" />
          </span>
        </button>
        <button
          type="button"
          className="graph-clean-memory"
          onClick={() =>
            onCleanMemory(brains.find((brain) => brain.path === selected)?.label ?? 'brain actif')
          }
          disabled={!selected || loading}
          title="Ouvrir une conversation brainwash pour auditer ce brain"
        >
          Clean memory
        </button>
        <div className="graph-toolbar__stats" aria-live="polite">
          <span>
            <strong>
              {graph.nodes.length}
              {graph.totalNodes && graph.totalNodes !== graph.nodes.length
                ? ` / ${graph.totalNodes}`
                : ''}
            </strong>{' '}
            nœuds
          </span>
          <span>
            <strong>{graph.links.length}</strong> relations
          </span>
          <span>
            <strong>{themeSummaries.length}</strong> thèmes
          </span>
          {inboxPending > 0 && (
            <span className="graph-stat-inbox">
              <strong>{inboxPending}</strong> en attente de revue
            </span>
          )}
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
          onChange={(event) => {
            // Retire A dans le même rendu qui affiche la saisie B : aucun verdict/résultat
            // d'une question précédente ne doit survivre pendant le debounce de la suivante.
            resetPrimaryBrainSearchResults()
            setThemeQuery(event.target.value)
          }}
        />
        <button
          className={`theme-filter ${activeThemes.size === 0 ? 'is-active' : ''}`}
          onClick={() => setActiveThemes(new Set())}
        >
          <i style={{ background: visualProfile.palette[0] }} />
          <span>Tous les thèmes</span>
          <small>
            {graph.totalNodes && graph.totalNodes !== graph.nodes.length
              ? `${graph.nodes.length} / ${graph.totalNodes}`
              : graph.nodes.length}
          </small>
        </button>
        {/* Le verdict du Brain, DISTINCT du nombre de fiches locales : un serveur éteint et « le savoir
            ne couvre pas la question » ne se disaient pas, ils se taisaient tous les deux. */}
        {searchRetrieval && (
          <p
            className={`theme-sidebar__retrieval is-${searchRetrieval.status}`}
            data-retrieval-status={searchRetrieval.status}
            role={searchRetrieval.status === 'failed' ? 'alert' : undefined}
          >
            {searchRetrieval.note}
          </p>
        )}
        {themesErr && (
          <p className="theme-sidebar__error" role="alert">
            <span>{themesErr}</span>
            <button
              type="button"
              className="graph-themes-retry"
              onClick={() => setThemesReload((request) => request + 1)}
            >
              Réessayer
            </button>
          </p>
        )}
        {themeNodesErr && (
          <p className="theme-sidebar__error" role="alert">
            <span>{themeNodesErr}</span>
            <button
              type="button"
              className="graph-theme-nodes-retry"
              onClick={() => setThemeNodesReload((request) => request + 1)}
            >
              Réessayer
            </button>
          </p>
        )}
        <div className="theme-list">
          {themeQuery.trim() && visibleSearchNodes.length > 0 && (
            <div className="node-search-results" aria-label="Fiches trouvées">
              <span className="search-results-heading">Fiches</span>
              {visibleSearchNodes.map((resultNode) => (
                <button
                  key={resultNode.id}
                  className="node-search-result"
                  onClick={() => void openNode(resultNode)}
                >
                  <i aria-hidden="true">✦</i>
                  <span>{resultNode.label}</span>
                  <small className="node-search-result__meta">
                    {brainScoreChannelLabel(resultNode)}
                    {' · '}
                    {resultNode.score !== undefined
                      ? `pertinence locale ${Math.round(resultNode.score)}`
                      : 'pertinence locale —'}
                    {(resultNode.relations?.length ?? 0) > 0
                      ? ` · ${resultNode.relations?.length} relation${resultNode.relations?.length === 1 ? '' : 's'}`
                      : ''}
                  </small>
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
        {loading && (
          <div className="graph-loading" role="status" aria-live="polite">
            <span className="graph-loading__spinner" aria-hidden="true" />
            <span className="graph-loading__label">Chargement du graphe…</span>
          </div>
        )}
        {expandingNodeId && !loading && (
          <div className="graph-status">Chargement des connexions…</div>
        )}
        {err && (
          <div className="graph-status graph-status--error" role="alert">
            <span className="graph-status__message">{err}</span>
            <button type="button" className="graph-status__retry" onClick={retryGraph}>
              Réessayer
            </button>
          </div>
        )}
        {!brainsLoading && !loading && !err && selected && graph.nodes.length === 0 && (
          <div className="graph-status graph-status--empty">
            <span>Aucun nœud disponible pour ce graphe.</span>
            {/* Un écran vide sans issue laissait l'utilisateur sans recours : deux sorties concrètes. */}
            <div className="graph-empty-actions">
              <button
                type="button"
                className="graph-empty-reindex"
                onClick={() => void refreshGraph()}
                disabled={!selected}
              >
                Réindexer ce graphe
              </button>
              <button type="button" className="graph-empty-brains" onClick={refreshBrains}>
                Relancer la détection des graphes
              </button>
            </div>
          </div>
        )}
        {!loading &&
          !err &&
          Boolean(graph.totalNodes) &&
          (graph.totalNodes as number) > graph.nodes.length && (
            <div className="graph-truncation" role="status">
              <span>
                Graphe TRONQUÉ : {graph.nodes.length} nœuds affichés sur {graph.totalNodes}. Les
                autres ne sont ni cherchés ni cliquables.
              </span>
              <button
                type="button"
                className="graph-truncation__extend"
                onClick={() =>
                  patchSettings({
                    lod: Math.min(10_000, Math.max(settings.lod * 2, graph.nodes.length * 2))
                  })
                }
                disabled={settings.lod >= 10_000}
              >
                Charger plus de nœuds
              </button>
            </div>
          )}
        <div
          ref={wrap}
          className="graph-canvas"
          data-tree-zoom-tier={layoutMode === 'tree' ? treeZoomTier : undefined}
          data-tree-visible-nodes={layoutMode === 'tree' ? visibleTree?.nodes.length : undefined}
        >
          <ForceGraph3D
            ref={graphRef}
            // `controlType` n'est lu qu'à l'initialisation de la vue : sans une `key` qui change
            // avec le mode, passer en arbre garderait les contrôles trackball déjà en place.
            key={layoutMode === 'tree' ? 'orbit' : 'trackball'}
            controlType={layoutMode === 'tree' ? 'orbit' : 'trackball'}
            width={size.w}
            height={size.h}
            graphData={renderedGraph}
            warmupTicks={motionProfile.warmupTicks}
            cooldownTicks={motionProfile.cooldownTicks}
            backgroundColor={visualProfile.background}
            showNavInfo={false}
            nodeLabel={() => ''}
            nodeColor={nodeColor}
            nodeVal={nodeValue}
            nodeOpacity={1}
            nodeThreeObject={visualMode === 'galaxy' ? galaxyNodeObject : seriousNodeObject}
            nodeThreeObjectExtend={false}
            linkVisibility={(value) => (focusedNode ? linkIsHighlighted(value) : settings.links)}
            linkColor={linkColor}
            linkOpacity={focusedNode ? 1 : visualProfile.linkOpacity}
            linkWidth={(value) => settings.linkWidth * (linkIsHighlighted(value) ? 1.8 : 1)}
            linkDirectionalArrowLength={settings.arrows ? 3.5 : 0}
            linkDirectionalArrowColor={() => graphLinkArrowColor(visualMode)}
            onEngineTick={syncThemeClusterLabels}
            onEngineStop={syncThemeClusterLabels}
            onBackgroundClick={surClicDeFond}
            onNodeHover={(value) => {
              const nextNode = value ? (value as GraphNode) : null
              setHoveredNode(nextNode?.treeNodeId ? null : nextNode)
            }}
            onNodeClick={(value) => activateGraphNode(value as GraphNode)}
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
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    activateThemeCluster(theme.id)
                  }}
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
          {layoutMode === 'tree' && visibleTree && (
            <div className="tree-branch-controls" role="toolbar" aria-label="Branches du Brain">
              {visibleTree.nodes
                .filter((treeNode) => treeNode.depth === 1 && !treeNode.isLeaf)
                .map((treeNode) => (
                  <button
                    key={treeNode.id}
                    type="button"
                    className={collapsedTreeNodeIds.has(treeNode.id) ? 'is-collapsed' : ''}
                    aria-pressed={collapsedTreeNodeIds.has(treeNode.id)}
                    data-tree-leaves={treeNode.leaves}
                    onClick={() => toggleTreeBranch(treeNode.id)}
                    title={`${collapsedTreeNodeIds.has(treeNode.id) ? 'Déplier' : 'Replier'} ${treeNode.label}`}
                  >
                    <span aria-hidden="true">
                      {collapsedTreeNodeIds.has(treeNode.id) ? '▸' : '▾'}
                    </span>
                    {treeNode.label}
                    <small>{treeNode.leaves}</small>
                  </button>
                ))}
            </div>
          )}
          {settings.health && (
            <aside className="graph-health-lens" aria-label="Relations à vérifier">
              <header>
                <strong>Relations à vérifier</strong>
                <span>{healthIssues.length}</span>
              </header>
              {healthIssues.length === 0 ? (
                <p>Aucune contradiction ni connaissance remplacée dans cette vue.</p>
              ) : (
                healthIssues.slice(0, 12).map((issue) => (
                  <div
                    className={`graph-health-issue is-${issue.relation}`}
                    key={`${issue.relation}:${issue.source.id}:${issue.target.id}`}
                  >
                    <span>{issue.relation === 'contradicts' ? 'Contradiction' : 'Remplace'}</span>
                    <button type="button" onClick={() => void openNode(issue.source)}>
                      {issue.source.label}
                    </button>
                    <i aria-hidden="true">→</i>
                    <button type="button" onClick={() => void openNode(issue.target)}>
                      {issue.target.label}
                    </button>
                  </div>
                ))
              )}
            </aside>
          )}
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
        {/* POSTE DE TRAVAIL du savoir : la revue de `inbox/` et le banc d'essai de récupération. Réservé
            aux brains de type vault — un graphe graphify n'a ni boîte de réception ni retrieval. */}
        {selectedBrain?.kind === 'vault' && (
          <button
            type="button"
            className={`graph-workbench-button ${panelTab === 'workbench' ? 'is-active' : ''}`}
            aria-label="Poste de travail du savoir"
            aria-expanded={panelTab === 'workbench'}
            title={
              inboxPending > 0
                ? `${inboxPending} candidat${inboxPending === 1 ? '' : 's'} en attente de revue`
                : 'Boîte de réception et banc d’essai de récupération'
            }
            onClick={() =>
              setPanelTab((current) => (current === 'workbench' ? 'node' : 'workbench'))
            }
          >
            ✦
            {inboxPending > 0 && (
              <span className="graph-workbench-badge" aria-hidden="true">
                {inboxPending}
              </span>
            )}
          </button>
        )}
        {panelTab === 'workbench' && selectedBrain?.kind === 'vault' && (
          <div className="graph-workbench-popover">
            <div className="graph-settings-popover__heading">
              <strong>Savoir</strong>
              <button
                type="button"
                onClick={() => setPanelTab('node')}
                aria-label="Fermer le poste de travail"
              >
                ×
              </button>
            </div>
            <KnowledgeInboxPanel
              brainPath={selected}
              onIndexChangeStarted={resetBrainSearchResults}
              onIndexChanged={reloadAfterInboxDecision}
            />
            <BrainRetrievalBench
              brainPath={selected}
              resetToken={benchReset}
              reloadToken={searchReload}
            />
          </div>
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
                  setSettings(DEFAULT_GRAPH_VISIBILITY_SETTINGS)
                }}
              >
                <ToggleRow
                  label="Libellés au survol"
                  checked={settings.labels}
                  onChange={(labels) => patchSettings({ labels })}
                />
                {layoutMode !== 'tree' && (
                  <ToggleRow
                    label="Liens"
                    checked={settings.links}
                    onChange={(links) => patchSettings({ links })}
                  />
                )}
                <ToggleRow
                  label="Nœuds sans lien"
                  checked={settings.orphans}
                  onChange={(orphans) => patchSettings({ orphans })}
                />
                {layoutMode !== 'tree' && (
                  <ToggleRow
                    label="Flèches de direction"
                    checked={settings.arrows}
                    onChange={(arrows) => patchSettings({ arrows })}
                  />
                )}
                <ToggleRow
                  label="Relations à vérifier"
                  checked={settings.health}
                  onChange={(health) => patchSettings({ health })}
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
                {layoutMode !== 'tree' && (
                  <RangeRow
                    label="Épaisseur des liens"
                    value={settings.linkWidth}
                    min={0.1}
                    max={2}
                    step={0.1}
                    display={settings.linkWidth.toFixed(1)}
                    onChange={(linkWidth) => patchSettings({ linkWidth })}
                  />
                )}
              </SettingsSection>
              {layoutMode !== 'tree' && (
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
              )}
              <SettingsSection title="Nombre de nœuds">
                <RangeRow
                  label="Nœuds affichés"
                  value={settings.lod}
                  min={100}
                  max={10_000}
                  step={100}
                  display={settings.lod.toLocaleString('fr-FR')}
                  onChange={(lod) => patchSettings({ lod })}
                />
                <p className="setting-help">
                  Affiche en priorité les nœuds les plus connectés du graphe.
                </p>
              </SettingsSection>
            </div>
          </div>
        )}
        <div className="graph-hint">
          {layoutMode === 'tree'
            ? 'Glisser : déplacer · molette : zoomer · clic : sélectionner'
            : 'Glisser : pivoter · molette : zoomer · clic : sélectionner'}
        </div>
      </main>

      {detailOpen && (
        <>
          {columnResizer('detail', 'Redimensionner la colonne de droite')}
          <aside ref={visibilitySidebarRef} className="visibility-sidebar is-detail-open">
            {node ? (
              <NodePanel
                node={node}
                file={file}
                fileErr={fileErr}
                linkedNodes={linkedNodes}
                onRetry={() => void openNode(node)}
                onNavigate={(nextNode) => openNode(nextNode)}
                onRetract={
                  selectedBrain?.kind === 'vault' && node.id.startsWith('knowledge/')
                    ? () => void retractSelectedKnowledge()
                    : undefined
                }
                onSupersede={
                  selectedBrain?.kind === 'vault' && node.id.startsWith('knowledge/')
                    ? () => void supersedeSelectedKnowledge()
                    : undefined
                }
              />
            ) : (
              <ThemeNodesPanel
                nodes={activeThemeNodes}
                onNavigate={(nextNode) => openNode(nextNode)}
              />
            )}
          </aside>
        </>
      )}
    </section>
  )
}
