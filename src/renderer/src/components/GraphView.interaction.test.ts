import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('floating note labels', () => {
  it('keeps label sprites in the graph raycast so their node can be opened', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('sprite.raycast = () => undefined')
    expect(source).toContain('onNodeClick={(value) => openNode(value as GraphNode)}')
  })

  it('limits hover emphasis to the hovered node without taking over link focus', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')
    expect(source).toContain('new Set(hoveredNode ? [hoveredNode.id] : [])')
    expect(source).toContain('const focusedNode = node')
    expect(source).not.toContain('const focusedNode = hoveredNode ?? node')
  })

  it('gives an opened node visual priority over an active theme', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')
    expect(source).toContain(
      'const visualActiveThemes = node ? EMPTY_THEME_SELECTION : activeThemes'
    )
    expect(source).toContain('visualActiveThemes.size > 0 ? highlightedNodeIds : new Set()')
    expect(source).toContain(
      'nodeColorForTheme(\n      value as GraphNode,\n      visualActiveThemes,'
    )
  })

  it('uses the right column for a theme index, then replaces it with node detail', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('./GraphView.css', import.meta.url), 'utf8')

    expect(source).toContain('const detailOpen = Boolean(node) || activeThemes.size > 0')
    expect(source).toContain("{columnResizer('detail', 'Redimensionner la colonne de droite')}")
    expect(source).toContain('{node ? (')
    expect(source).toContain('<ThemeNodesPanel')
    expect(source).toContain('nodes={activeThemeNodes}')
    expect(source).toContain('nodesForThemesAlphabetically(themeNodes, activeThemes)')
    expect(source).toContain('.loadBrainThemeNodes(selected, themeIds)')
    expect(source).not.toContain('Sélectionnez un nœud dans le graphe.')
    expect(source).not.toContain("detailOpen ? 'detail' : 'visibility'")
    expect(styles).toContain('grid-template-columns: var(--theme-column-width) minmax(0, 1fr);')
  })

  it('clears an opened node when a sidebar theme is selected', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')
    const toggleThemeBody = source.slice(
      source.indexOf('function toggleTheme(theme: string)'),
      source.indexOf('function activateThemeCluster(theme: string)')
    )

    expect(toggleThemeBody).toContain('clearNodeSelection()')
  })

  it('uses only the floating node name instead of stacking the native hover tooltip below it', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')

    expect(source).toContain("nodeLabel={() => ''}")
    expect(source).not.toContain("nodeLabel={settings.labels ? 'label' : () => ''}")
    expect(source).toContain('settings.labels && shouldShowFloatingNodeName')
  })
})
