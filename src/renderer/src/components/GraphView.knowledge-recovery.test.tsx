// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CHANTIERS 2, 4, 5 et 6 de la vue Knowledge : compteur de boîte de réception visible SANS ouvrir le
 * popover, états vides actionnables, réessai par canal, et troncature du graphe DITE.
 */

vi.mock('react-force-graph-3d', () => ({
  default: forwardRef(function FakeForceGraph(_props: unknown, ref) {
    useImperativeHandle(ref, () => ({
      cameraPosition: vi.fn().mockReturnValue({ x: 0, y: 0, z: 100 }),
      d3Force: (name: string) => (name === 'link' ? { distance: vi.fn() } : { strength: vi.fn() }),
      d3ReheatSimulation: vi.fn(),
      controls: () => ({ mouseButtons: {}, touches: {}, update: vi.fn() }),
      pauseAnimation: vi.fn(),
      refresh: vi.fn(),
      resumeAnimation: vi.fn(),
      scene: () => ({ add: vi.fn(), remove: vi.fn() }),
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
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })

const brain = { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }

function node(id: string, themes: string[] = []): Record<string, unknown> {
  return { id, label: id, file: `C:/brain/knowledge/${id}.md`, themes, score: 1, relations: [] }
}

function inboxCandidate(id: string): Record<string, unknown> {
  return {
    id,
    file: `C:/brain/inbox/${id}.md`,
    title: id,
    body: 'corps',
    nearDuplicates: []
  }
}

function installApi(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listBrains: vi.fn().mockResolvedValue([brain]),
    loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainThemes: vi.fn().mockResolvedValue([]),
    loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
    loadBrainNeighborhood: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    readNodeFile: vi.fn().mockResolvedValue({ path: 'a.md', content: 'contenu' }),
    refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
    searchBrain: vi.fn().mockResolvedValue({
      status: 'found',
      note: 'ok',
      query: 'q',
      results: [],
      budget: {
        questionSubmittedChars: 1,
        questionChars: 1,
        questionMax: 500,
        questionTruncated: false,
        knowledgeAvailableChars: 1,
        knowledgeChars: 1,
        knowledgeMax: 6_000,
        knowledgeTruncated: false,
        knowledgeDroppedChars: 0
      }
    }),
    listInbox: vi.fn().mockResolvedValue([]),
    promoteInbox: vi.fn().mockResolvedValue({ ok: true }),
    rejectInbox: vi.fn().mockResolvedValue({ ok: true }),
    ...over
  } as Record<string, ReturnType<typeof vi.fn>>
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

async function mount(): Promise<void> {
  await act(async () =>
    root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
  )
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

describe('GraphView — chantier 2 : la boîte de réception est visible sans ouvrir le popover', () => {
  it('affiche le nombre de candidats en attente sur le bouton ET dans la barre de stats', async () => {
    installApi({
      listInbox: vi.fn().mockResolvedValue([inboxCandidate('inbox/a'), inboxCandidate('inbox/b')])
    })
    await mount()

    // Popover FERMÉ : le panneau ne doit pas être monté.
    expect(container.querySelector('[aria-label="Boîte de réception du savoir"]')).toBeNull()
    expect(container.querySelector('.graph-workbench-badge')?.textContent).toBe('2')
    expect(container.querySelector('.graph-stat-inbox')?.textContent).toContain('2')
  })

  it('sans candidat, aucun compteur parasite sur le bouton', async () => {
    installApi()
    await mount()
    expect(container.querySelector('.graph-workbench-badge')).toBeNull()
  })
})

describe('GraphView — chantier 4 : les états vides offrent une sortie', () => {
  it('« Aucun graphe accessible » propose de relancer la détection', async () => {
    const listBrains = vi.fn().mockResolvedValue([])
    installApi({ listBrains })
    await mount()
    expect(container.textContent).toContain('Aucun graphe accessible')
    const retry = container.querySelector<HTMLButtonElement>('.graph-brains-retry')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    await flush()
    expect(listBrains.mock.calls.length).toBeGreaterThan(1)
  })

  it('« Aucun nœud disponible » propose de réindexer le graphe', async () => {
    const api = installApi()
    await mount()
    expect(container.textContent).toContain('Aucun nœud disponible pour ce graphe.')
    const reindex = container.querySelector<HTMLButtonElement>('.graph-empty-reindex')
    expect(reindex).not.toBeNull()
    await act(async () => reindex?.click())
    await flush()
    expect(api.refreshBrain).toHaveBeenCalledWith('C:\\brain')
  })
})

describe('GraphView — chantier 5 : chaque canal a son réessai', () => {
  it('la liste des brains en échec est réessayable', async () => {
    const listBrains = vi
      .fn()
      .mockRejectedValueOnce(new Error('ipc coupé'))
      .mockResolvedValue([brain])
    installApi({ listBrains })
    await mount()
    const retry = container.querySelector<HTMLButtonElement>('.graph-brains-retry')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    await flush()
    expect(listBrains.mock.calls.length).toBeGreaterThan(1)
    expect(container.textContent).toContain('Brain')
  })

  it('les thèmes en échec sont réessayables sans recharger le graphe', async () => {
    const loadBrainThemes = vi
      .fn()
      .mockRejectedValueOnce(new Error('thèmes indisponibles'))
      .mockResolvedValue([])
    installApi({
      loadBrainThemes,
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [node('a')], links: [] })
    })
    await mount()
    const retry = container.querySelector<HTMLButtonElement>('.graph-themes-retry')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    await flush()
    expect(loadBrainThemes.mock.calls.length).toBeGreaterThan(1)
  })

  it('les notes d’un thème en échec sont réessayables', async () => {
    const loadBrainThemeNodes = vi
      .fn()
      .mockRejectedValueOnce(new Error('notes indisponibles'))
      .mockResolvedValue([node('a', ['t'])])
    installApi({
      loadBrainThemes: vi.fn().mockResolvedValue([{ id: 't', label: 'T', count: 1 }]),
      loadBrainThemeNodes,
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [node('a', ['t'])], links: [] })
    })
    await mount()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-theme-id="t"]')?.click()
    )
    await flush()
    const retry = container.querySelector<HTMLButtonElement>('.graph-theme-nodes-retry')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    await flush()
    expect(loadBrainThemeNodes.mock.calls.length).toBeGreaterThan(1)
  })

  it('la fiche et son voisinage en échec sont réessayables', async () => {
    const readNodeFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('fichier illisible'))
      .mockResolvedValue({ path: 'a.md', content: 'contenu revenu' })
    const loadBrainNeighborhood = vi
      .fn()
      .mockRejectedValueOnce(new Error('voisinage indisponible'))
      .mockResolvedValue({ nodes: [], links: [] })
    installApi({
      readNodeFile,
      loadBrainNeighborhood,
      loadBrainThemes: vi.fn().mockResolvedValue([{ id: 't', label: 'T', count: 1 }]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([node('a', ['t'])]),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [node('a', ['t'])], links: [] })
    })
    await mount()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-theme-id="t"]')?.click()
    )
    await flush()
    // Ouvrir la fiche par la liste des notes du thème.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.theme-nodes-panel button, .node-links button')
        ?.click()
    )
    await flush()
    expect(container.querySelector('.node-panel__error')).not.toBeNull()
    const retry = container.querySelector<HTMLButtonElement>('.node-panel__retry')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    await flush()
    expect(readNodeFile.mock.calls.length).toBeGreaterThan(1)
    expect(loadBrainNeighborhood.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('GraphView — chantier 6 : la troncature du graphe est dite', () => {
  it('annonce les nœuds manquants et propose d’étendre le chargement', async () => {
    const loadBrainGraph = vi
      .fn()
      .mockResolvedValue({ nodes: [node('a'), node('b')], links: [], totalNodes: 50 })
    installApi({ loadBrainGraph })
    await mount()
    const banner = container.querySelector('.graph-truncation')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('2')
    expect(banner?.textContent).toContain('50')
    const previousLod = Number(loadBrainGraph.mock.calls[0][1])
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.graph-truncation__extend')?.click()
    )
    await flush()
    const lastLod = Number(loadBrainGraph.mock.calls.at(-1)?.[1])
    expect(lastLod).toBeGreaterThan(previousLod)
  })

  it('un graphe complet n’affiche aucune bannière de troncature', async () => {
    installApi({
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [node('a')], links: [], totalNodes: 1 })
    })
    await mount()
    expect(container.querySelector('.graph-truncation')).toBeNull()
  })
})
