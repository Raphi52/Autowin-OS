import { describe, expect, it } from 'vitest'
import {
  buildThemeSummaries,
  filterGraphVisibility,
  galaxyNodeAppearance,
  getGraphVisualProfile,
  graphForcesForSpacing,
  isCurrentGraphFitRequest,
  isHighlightedLink,
  linkedNodesFor,
  searchGraphCatalog,
  nodeColorForTheme,
  shouldShowFloatingNodeName,
  themeClusterAnchors,
  toggleThemeSelection,
  visibleThemeClusterIds,
  nodeValueForTheme,
  normalizeGraphNodeSpacing,
  nextGraphFitRequest,
  type GraphLink,
  type GraphNode
} from './graph-view-model'

const nodes: GraphNode[] = [
  { id: 'a', label: 'Accueil', group: 2, themes: ['theme/rig', 'theme/architecture'] },
  { id: 'b', label: 'Borne', group: 2, themes: ['theme/rig'] },
  { id: 'c', label: 'SQL', group: 7 },
  { id: 'orphan', label: 'Isolé', group: 9 }
]
const links: GraphLink[] = [
  { source: 'a', target: 'b', weight: 1 },
  { source: 'b', target: 'c', weight: 1 }
]

describe('graph view presentation model', () => {
  it('maps a bounded spacing setting to link distance and repulsion', () => {
    expect(normalizeGraphNodeSpacing('120')).toBe(120)
    expect(normalizeGraphNodeSpacing(-20)).toBe(30)
    expect(normalizeGraphNodeSpacing(900)).toBe(240)
    expect(normalizeGraphNodeSpacing('invalid')).toBe(72)
    expect(normalizeGraphNodeSpacing(null)).toBe(72)
    expect(graphForcesForSpacing(120)).toEqual({ linkDistance: 120, chargeStrength: -240 })
  })

  it('invalidates a deferred graph fit when spacing changes before the timeout', () => {
    const scheduledRequest = nextGraphFitRequest(0)
    const requestAfterSpacingChange = nextGraphFitRequest(scheduledRequest)

    expect(isCurrentGraphFitRequest(scheduledRequest, requestAfterSpacingChange)).toBe(false)
    expect(isCurrentGraphFitRequest(requestAfterSpacingChange, requestAfterSpacingChange)).toBe(
      true
    )
  })

  it('searches both themes and node labels or paths with a bounded result set', () => {
    const result = searchGraphCatalog('accueil', nodes, [
      { id: 'theme/rig', label: 'Accueil RIG', count: 2 },
      { id: 'theme/sql', label: 'SQL', count: 1 }
    ])

    expect(result.themes.map((theme) => theme.id)).toEqual(['theme/rig'])
    expect(result.nodes.map((node) => node.id)).toEqual(['a'])
    expect(searchGraphCatalog('sql', nodes, []).nodes.map((node) => node.id)).toEqual(['c'])
    expect(searchGraphCatalog('', nodes, []).nodes).toEqual([])
  })

  it('defines distinct serious and galaxy rendering profiles', () => {
    const serious = getGraphVisualProfile('serious')
    expect(serious).toMatchObject({
      background: '#000000',
      modeClass: 'graph-observatory--serious'
    })
    expect(serious).not.toHaveProperty('particles')
    const galaxy = getGraphVisualProfile('galaxy')
    expect(galaxy).toMatchObject({
      background: 'rgba(0,0,0,0)',
      palette: ['#56f3ff', '#ff4fd8', '#9a7cff', '#ffb84d', '#ff647c', '#4f8cff', '#7dffb2'],
      modeClass: 'graph-observatory--galaxy'
    })
    expect(galaxy).not.toHaveProperty('particles')
  })

  it('summarises communities by size then id', () => {
    expect(buildThemeSummaries(nodes)).toEqual([
      { id: 'theme/rig', label: 'RIG', count: 2 },
      { id: 'community/7', label: 'Thème 7', count: 1 },
      { id: 'community/9', label: 'Thème 9', count: 1 },
      { id: 'theme/architecture', label: 'Architecture', count: 1 }
    ])
  })

  it('exposes the seven Amitel themes in refactor order, including empty themes', () => {
    const declared = [
      { id: 'theme/rig', label: 'RIG' },
      { id: 'theme/architecture', label: 'Architecture' },
      { id: 'theme/donnees', label: 'Données' },
      { id: 'theme/integrations', label: 'Intégrations' },
      { id: 'theme/operations', label: 'Opérations' },
      { id: 'theme/ia', label: 'IA' },
      { id: 'theme/gouvernance', label: 'Gouvernance' }
    ]
    expect(buildThemeSummaries(nodes, declared).map(({ id, label }) => ({ id, label }))).toEqual(
      declared
    )
  })

  it('places each non-empty theme label above its positioned cluster', () => {
    const positioned: GraphNode[] = [
      { id: 'a', label: 'A', group: 0, themes: ['theme/rig'], x: -10, y: 4, z: 8 },
      { id: 'b', label: 'B', group: 0, themes: ['theme/rig'], x: 6, y: 12, z: -2 },
      { id: 'c', label: 'C', group: 1, themes: ['theme/ia'], x: 30, y: -5, z: 10 },
      { id: 'pending', label: 'Pending', group: 1, themes: ['theme/ia'] }
    ]

    expect(
      themeClusterAnchors(positioned, [
        { id: 'theme/rig', label: 'RIG' },
        { id: 'theme/ia', label: 'IA' },
        { id: 'theme/empty', label: 'Vide' }
      ])
    ).toEqual([
      { id: 'theme/rig', label: 'RIG', x: -2, y: 24, z: 3, count: 2 },
      { id: 'theme/ia', label: 'IA', x: 30, y: 7, z: 10, count: 1 }
    ])
  })

  it('keeps floating theme tags visible and toggles the same theme off on the second click', () => {
    const firstClick = toggleThemeSelection(new Set(), 'theme/rig')
    const secondClick = toggleThemeSelection(firstClick, 'theme/rig')
    const themes = [
      { id: 'theme/rig', label: 'RIG' },
      { id: 'theme/architecture', label: 'Architecture' }
    ]

    expect(visibleThemeClusterIds(themes, new Set(), null)).toEqual([
      'theme/rig',
      'theme/architecture'
    ])
    expect(visibleThemeClusterIds(themes, firstClick, null)).toEqual(['theme/rig'])
    expect(visibleThemeClusterIds(themes, firstClick, nodes[0])).toEqual([])
    expect(firstClick).toEqual(new Set(['theme/rig']))
    expect(secondClick).toEqual(new Set())
  })

  it('shows floating names only for active-theme nodes or selected-node neighbours', () => {
    const activeThemes = new Set(['theme/rig'])
    const connectedNodeIds = new Set(['c'])

    expect(shouldShowFloatingNodeName(nodes[0], activeThemes, connectedNodeIds)).toBe(true)
    expect(shouldShowFloatingNodeName(nodes[1], activeThemes, connectedNodeIds)).toBe(true)
    expect(shouldShowFloatingNodeName(nodes[2], activeThemes, connectedNodeIds)).toBe(true)
    expect(shouldShowFloatingNodeName(nodes[3], activeThemes, connectedNodeIds)).toBe(false)
    expect(shouldShowFloatingNodeName(nodes[0], new Set(), new Set())).toBe(false)
  })

  it('keeps the whole graph when orphans are visible', () => {
    expect(filterGraphVisibility({ nodes, links }, true).nodes).toHaveLength(4)
  })

  it('removes only orphan nodes when they are hidden', () => {
    const filtered = filterGraphVisibility({ nodes, links }, false)
    expect(filtered.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])
    expect(filtered.links).toHaveLength(2)
  })

  it('preserves normal theme colors when no filter is active', () => {
    expect(nodeColorForTheme(nodes[0], new Set(), 0.2)).toBe('#f8bd67')
  })

  it('maps serious nodes to the declared theme colors, including an active secondary theme', () => {
    const themeOrder = ['theme/architecture', 'theme/rig', 'theme/donnees']
    const palette = ['#aa0000', '#00bb00', '#0000cc']

    expect(nodeColorForTheme(nodes[0], new Set(), 0.2, themeOrder, palette)).toBe('#00bb00')
    expect(
      nodeColorForTheme(nodes[0], new Set(['theme/architecture']), 0.2, themeOrder, palette)
    ).toBe('#aa0000')
  })

  it('uses the least-common node theme in serious overview while an active filter still wins', () => {
    const multiThemeNode: GraphNode = {
      id: 'inscription',
      label: 'Inscription RCS',
      group: 1,
      themes: ['category/rig', 'category/documentation', 'category/rcs']
    }
    const themeOrder = ['category/rig', 'category/documentation', 'category/rcs']
    const palette = ['#00bb00', '#ff9900', '#3355ff']
    const counts = new Map([
      ['category/rig', 264],
      ['category/documentation', 154],
      ['category/rcs', 15]
    ])

    expect(nodeColorForTheme(multiThemeNode, new Set(), 0.2, themeOrder, palette, counts)).toBe(
      '#3355ff'
    )
    expect(
      nodeColorForTheme(
        multiThemeNode,
        new Set(['category/documentation']),
        0.2,
        themeOrder,
        palette,
        counts
      )
    ).toBe('#ff9900')
  })

  it('breaks equal-frequency serious themes by their declared order', () => {
    const multiThemeNode: GraphNode = {
      id: 'shared',
      label: 'Shared themes',
      group: 1,
      themes: ['theme/b', 'theme/a']
    }
    const themeOrder = ['theme/a', 'theme/b']
    const palette = ['#aa0000', '#0000bb']
    const counts = new Map([
      ['theme/a', 4],
      ['theme/b', 4]
    ])

    expect(nodeColorForTheme(multiThemeNode, new Set(), 0.2, themeOrder, palette, counts)).toBe(
      '#aa0000'
    )
  })

  it('dims context nodes without hiding them', () => {
    expect(nodeColorForTheme(nodes[2], new Set(['theme/rig']), 0.22)).toBe('rgba(117,215,255,0.22)')
  })

  it('maps galaxy stars to the declared theme order and dims only context stars', () => {
    const themeOrder = ['theme/architecture', 'theme/rig', 'theme/donnees']
    const palette = ['#aa0000', '#00bb00', '#0000cc']

    expect(galaxyNodeAppearance(nodes[0], new Set(), 0.22, themeOrder, palette)).toEqual({
      color: '#00bb00',
      opacity: 1
    })
    expect(
      galaxyNodeAppearance(nodes[0], new Set(['theme/donnees']), 0.22, themeOrder, palette)
    ).toEqual({ color: '#00bb00', opacity: 0.22 })
    expect(
      galaxyNodeAppearance(nodes[0], new Set(['theme/architecture']), 0.22, themeOrder, palette)
    ).toEqual({ color: '#aa0000', opacity: 1 })
  })

  it('enlarges highlighted nodes only', () => {
    expect(nodeValueForTheme(nodes[0], new Set(['theme/rig']), 1.5)).toBe(3)
    expect(nodeValueForTheme(nodes[2], new Set(['theme/rig']), 1.5)).toBe(1.5)
  })

  it('highlights links contained in an active theme', () => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    expect(isHighlightedLink(links[0], new Set(['theme/rig']), byId)).toBe(true)
    expect(isHighlightedLink(links[1], new Set(['theme/rig']), byId)).toBe(false)
  })

  it('accepts object endpoints after ForceGraph mutates the link', () => {
    const link = { source: nodes[0], target: nodes[1], weight: 1 }
    expect(isHighlightedLink(link, new Set(['theme/rig']), new Map())).toBe(true)
  })

  it('builds deterministic neighbour navigation with incoming and outgoing relations', () => {
    const graph = { nodes, links }
    expect(linkedNodesFor('b', graph)).toEqual([
      { node: nodes[0], direction: 'incoming' },
      { node: nodes[2], direction: 'outgoing' }
    ])
  })

  it('never returns the selected node as its own neighbour for a self relation', () => {
    const graph = { nodes, links: [...links, { source: 'b', target: 'b', weight: 1 }] }
    expect(linkedNodesFor('b', graph)).toEqual([
      { node: nodes[0], direction: 'incoming' },
      { node: nodes[2], direction: 'outgoing' }
    ])
  })
})
