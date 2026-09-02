// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-force-graph-3d', () => ({
  default: forwardRef(function FakeForceGraph(
    props: {
      graphData?: { nodes?: Array<{ id: string; label: string }> }
      onNodeClick?: (node: { id: string; label: string }) => void
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      cameraPosition: vi.fn().mockReturnValue({ x: 0, y: 0, z: 100 }),
      d3Force: (name: string) => (name === 'link' ? { distance: vi.fn() } : { strength: vi.fn() }),
      d3ReheatSimulation: vi.fn(),
      controls: () => ({ mouseButtons: {}, touches: {}, update: vi.fn() }),
      pauseAnimation: vi.fn(),
      refresh: vi.fn(),
      resumeAnimation: vi.fn(),
      scene: () => ({ add: vi.fn(), remove: vi.fn(), children: [] }),
      zoomToFit: vi.fn()
    }))
    return createElement(
      'div',
      { 'data-testid': 'force-graph' },
      props.graphData?.nodes?.map((node) =>
        createElement(
          'button',
          {
            key: node.id,
            type: 'button',
            'data-node-id': node.id,
            onClick: () => props.onNodeClick?.(node)
          },
          node.label
        )
      )
    )
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

/** Deux fiches d'une même lignée profonde : le chemin EST la chaîne à dérouler. */
const FICHES = [
  {
    id: 'knowledge/decisions/2026/curation.md',
    label: 'curation',
    group: 1,
    file: 'C:/brain/knowledge/decisions/2026/curation.md'
  },
  {
    id: 'knowledge/decisions/2026/tri.md',
    label: 'tri',
    group: 1,
    file: 'C:/brain/knowledge/decisions/2026/tri.md'
  }
]

function noeudsVisibles(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-node-id]')].map(
    (bouton) => bouton.dataset.nodeId ?? ''
  )
}

async function cliquer(nodeId: string): Promise<void> {
  const bouton = container.querySelector<HTMLButtonElement>(`[data-node-id="${nodeId}"]`)
  if (!bouton) throw new Error(`nœud absent du graphe : ${nodeId}`)
  await act(async () => {
    bouton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

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

describe('graphe en arbre — un clic déplie un cran, de la branche jusqu’à la fiche', () => {
  it('déroule toute la chaîne et rend la fiche consultable au bout', async () => {
    const readNodeFile = vi.fn().mockResolvedValue('# Curation\ncontenu de la fiche')
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:/brain', sizeMb: 1, kind: 'file' }
        ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: FICHES, links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: FICHES, links: [] }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      loadBrainNeighborhood: vi.fn().mockResolvedValue({ nodes: FICHES, links: [] }),
      readNodeFile,
      searchBrain: vi.fn().mockResolvedValue({ status: 'found', note: '', results: [] })
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()

    const bascule = container.querySelector<HTMLButtonElement>(
      '[aria-label="Disposition du graphe"]'
    )
    if (!bascule) throw new Error('bascule de disposition absente')
    await act(async () => bascule.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flush()

    // Cran 0 : seule la branche de premier niveau est là — aucune fiche, aucun sous-dossier.
    expect(noeudsVisibles()).toEqual(['__tree__:Transverse'])

    // Chaque clic dévoile EXACTEMENT le cran suivant, jamais plus.
    await cliquer('__tree__:Transverse')
    expect(noeudsVisibles()).toEqual(['__tree__:Transverse', '__tree__:Transverse/knowledge'])

    await cliquer('__tree__:Transverse/knowledge')
    expect(noeudsVisibles()).toContain('__tree__:Transverse/knowledge/decisions')
    expect(noeudsVisibles()).not.toContain('__tree__:Transverse/knowledge/decisions/2026')

    await cliquer('__tree__:Transverse/knowledge/decisions')
    expect(noeudsVisibles()).toContain('__tree__:Transverse/knowledge/decisions/2026')
    expect(noeudsVisibles()).not.toContain('knowledge/decisions/2026/curation.md')

    // Dernier cran : les fiches elles-mêmes apparaissent.
    await cliquer('__tree__:Transverse/knowledge/decisions/2026')
    expect(noeudsVisibles()).toContain('knowledge/decisions/2026/curation.md')
    expect(noeudsVisibles()).toContain('knowledge/decisions/2026/tri.md')

    // …et la fiche au bout de la chaîne est CONSULTABLE : un clic ouvre son contenu.
    await cliquer('knowledge/decisions/2026/curation.md')
    expect(readNodeFile).toHaveBeenCalledWith(
      'C:/brain/knowledge/decisions/2026/curation.md',
      undefined
    )
    expect(container.textContent).toContain('Détail du nœud')
    expect(container.textContent).toContain('C:/brain/knowledge/decisions/2026/curation.md')
  })
})
