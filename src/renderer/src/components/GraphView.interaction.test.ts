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
    expect(source).toContain('const visualActiveThemes = node ? EMPTY_THEME_SELECTION : activeThemes')
    expect(source).toContain(
      'visualActiveThemes.size > 0 ? highlightedNodeIds : new Set()'
    )
    expect(source).toContain('nodeColorForTheme(\n      value as GraphNode,\n      visualActiveThemes,')
  })
})
