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

/** Le compteur que la vue publie elle-même dans le DOM : nombre de nœuds visibles en arbre. */
function compteurArbre(): number {
  const canvas = container.querySelector<HTMLElement>('.graph-canvas')
  return Number(canvas?.dataset.treeVisibleNodes ?? '-1')
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

describe('graphe en arbre — tout est visible d’emblée, le pliage reste possible', () => {
  it('montre branches ET fiches sans clic, et rend la fiche consultable', async () => {
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

    // À L'OUVERTURE, TOUT EST VISIBLE : l'arbre montre ses branches ET ses fiches sans
    // qu'un seul clic soit nécessaire. Choix produit du 2026-09-02 : le dépliage cran par cran
    // obligeait à cliquer pour voir des nœuds qui étaient visibles d'emblée auparavant.
    const auDepart = noeudsVisibles()
    expect(auDepart).toContain('__tree__:Transverse')
    expect(auDepart).toContain('__tree__:Transverse/knowledge/decisions/2026')
    expect(auDepart).toContain('knowledge/decisions/2026/curation.md')
    expect(auDepart).toContain('knowledge/decisions/2026/tri.md')
    expect(compteurArbre()).toBeGreaterThan(0)

    // Le pliage reste DISPONIBLE : un clic sur un dossier ouvert le referme.
    await cliquer('__tree__:Transverse/knowledge/decisions/2026')
    expect(noeudsVisibles()).not.toContain('knowledge/decisions/2026/curation.md')
    await cliquer('__tree__:Transverse/knowledge/decisions/2026')
    expect(noeudsVisibles()).toContain('knowledge/decisions/2026/curation.md')
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

describe('graphe en mode nuage (le mode d’ouverture par défaut) — un clic ouvre la fiche', () => {
  it('ajoute les voisins au nuage et affiche le contenu de la fiche cliquée', async () => {
    const readNodeFile = vi.fn().mockResolvedValue('# Curation contenu de la fiche')
    const VOISINS = [
      ...FICHES,
      {
        id: 'knowledge/decisions/2026/voisine.md',
        label: 'voisine',
        group: 1,
        file: 'C:/brain/knowledge/decisions/2026/voisine.md'
      }
    ]
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
      loadBrainNeighborhood: vi.fn().mockResolvedValue({ nodes: VOISINS, links: [] }),
      readNodeFile,
      searchBrain: vi.fn().mockResolvedValue({ status: 'found', note: '', results: [] })
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()

    // Aucun clic sur la bascule : on reste dans le mode d'ouverture par défaut (le nuage).
    const canvas = container.querySelector<HTMLElement>('.graph-canvas')
    expect(canvas?.dataset.treeVisibleNodes).toBeUndefined()

    const avant = noeudsVisibles()
    expect(avant).toEqual([
      'knowledge/decisions/2026/curation.md',
      'knowledge/decisions/2026/tri.md'
    ])

    await cliquer('knowledge/decisions/2026/curation.md')

    // Points APRÈS > points AVANT : le clic a bien ramené le voisinage dans le nuage.
    const apres = noeudsVisibles()
    expect(apres.length).toBeGreaterThan(avant.length)
    expect(apres).toContain('knowledge/decisions/2026/voisine.md')

    // …et la fiche cliquée est ouverte.
    expect(readNodeFile).toHaveBeenCalledWith(
      'C:/brain/knowledge/decisions/2026/curation.md',
      undefined
    )
    expect(container.textContent).toContain('Détail du nœud')
    expect(container.textContent).toContain('C:/brain/knowledge/decisions/2026/curation.md')
  })
})
