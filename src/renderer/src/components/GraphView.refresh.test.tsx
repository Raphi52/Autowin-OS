// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-force-graph-3d', () => ({
  default: forwardRef(function FakeForceGraph(_props: unknown, ref) {
    useImperativeHandle(ref, () => ({
      cameraPosition: vi.fn().mockReturnValue({ x: 0, y: 0, z: 100 }),
      d3Force: (name: string) => (name === 'link' ? { distance: vi.fn() } : { strength: vi.fn() }),
      d3ReheatSimulation: vi.fn(),
      pauseAnimation: vi.fn(),
      refresh: vi.fn(),
      resumeAnimation: vi.fn(),
      zoomToFit: vi.fn()
    }))
    return createElement('div', { 'data-testid': 'force-graph' })
  })
}))

import { GraphView } from './GraphView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })

beforeEach(() => {
  localStorage.clear()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('GraphView refresh', () => {
  it('rend les canaux Memory lisibles dans la colonne étroite', () => {
    const css = readFileSync(join(__dirname, 'GraphView.css'), 'utf8')
    const metadataRule = css.match(/\.node-search-result__meta\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(metadataRule).toContain('grid-column: 2')
    expect(metadataRule).toContain('white-space: normal')
    expect(metadataRule).not.toContain('text-overflow: ellipsis')
  })

  it('reloads the selected graph even when listBrains returns the same path', async () => {
    const refreshBrain = vi.fn().mockResolvedValue({ ok: true })
    const loadBrainGraphPreview = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [{ id: 'before', label: 'Before', group: 0 }], links: [] })
      .mockResolvedValueOnce({ nodes: [{ id: 'after', label: 'After', group: 0 }], links: [] })
    const loadBrainGraph = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [{ id: 'before', label: 'Before', group: 0 }], links: [] })
      .mockResolvedValueOnce({ nodes: [{ id: 'after', label: 'After', group: 0 }], links: [] })

    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }
        ]),
      loadBrainGraphPreview,
      loadBrainGraph,
      refreshBrain,
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    expect(loadBrainGraph).toHaveBeenCalledTimes(1)

    const refresh = container.querySelector<HTMLButtonElement>(
      '[aria-label="Rafraîchir les graphes"]'
    )
    expect(refresh).toBeTruthy()
    await act(async () => refresh?.click())
    await flush()

    expect(refreshBrain).toHaveBeenCalledWith('C:\\brain')
    expect(loadBrainGraphPreview).toHaveBeenCalledTimes(2)
    expect(loadBrainGraph).toHaveBeenCalledTimes(2)
  })
})
