import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('floating note labels', () => {
  it('keeps label sprites in the graph raycast so their node can be opened', () => {
    const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('sprite.raycast = () => undefined')
    expect(source).toContain('onNodeClick={(value) => openNode(value as GraphNode)}')
  })
})
