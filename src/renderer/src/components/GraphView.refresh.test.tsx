// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      scene: () => ({ add: vi.fn(), remove: vi.fn() }),
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function chooseBrain(path: string): void {
  const select = container.querySelector<HTMLSelectElement>(
    '[aria-label="Graphe de connaissances"]'
  )
  if (!select) throw new Error('sélecteur Brain absent')
  select.value = path
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function changeRange(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function changeText(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
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

describe('GraphView refresh', () => {
  it('rend les canaux Memory lisibles dans la colonne étroite', () => {
    const css = readFileSync(join(__dirname, 'GraphView.css'), 'utf8')
    const metadataRule = css.match(/\.node-search-result__meta\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(metadataRule).toContain('grid-column: 2')
    expect(metadataRule).toContain('white-space: normal')
    expect(metadataRule).not.toContain('text-overflow: ellipsis')
  })

  it('efface A dès la saisie de B et ne mélange jamais leurs résultats', async () => {
    const pendingB = deferred<{
      status: 'found'
      note: string
      results: Array<{
        id: string
        label: string
        file: string
        themes: string[]
        score: number
        relations: []
      }>
    }>()
    const searchBrain = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'found',
        note: 'VERDICT-A',
        results: [
          {
            id: 'knowledge/a',
            label: 'FICHE-A',
            file: 'C:/brain/knowledge/a.md',
            themes: [],
            score: 1,
            relations: []
          }
        ]
      })
      .mockImplementationOnce(() => pendingB.promise)
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:/brain', sizeMb: 1, kind: 'vault' }
        ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      searchBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="Rechercher un thème ou une fiche"]'
    )
    if (!search) throw new Error('recherche Brain absente')

    await act(async () => changeText(search, 'question A'))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    await flush()
    expect(container.textContent).toContain('VERDICT-A')
    expect(container.textContent).toContain('FICHE-A')

    await act(async () => changeText(search, 'question B'))
    expect(container.textContent).not.toContain('VERDICT-A')
    expect(container.textContent).not.toContain('FICHE-A')
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    expect(container.textContent).not.toContain('VERDICT-A')

    pendingB.resolve({
      status: 'found',
      note: 'VERDICT-B',
      results: [
        {
          id: 'knowledge/b',
          label: 'FICHE-B',
          file: 'C:/brain/knowledge/b.md',
          themes: [],
          score: 1,
          relations: []
        }
      ]
    })
    await flush()
    expect(container.textContent).toContain('VERDICT-B')
    expect(container.textContent).toContain('FICHE-B')
    expect(container.textContent).not.toContain('FICHE-A')
  })

  it('préserve le banc Knowledge quand seule la recherche principale change', async () => {
    const searchBrain = vi.fn().mockResolvedValue({
      status: 'found',
      note: 'VERDICT-BANC-STABLE',
      query: 'question du banc',
      results: [],
      navigation: {
        query: 'question du banc',
        minDense: 0.25,
        candidates: [
          {
            rank: 1,
            path: 'knowledge/PREUVE-BANC-STABLE.md',
            type: 'domain',
            denseCos: 0.8,
            retained: true
          }
        ]
      },
      budget: {
        questionSubmittedChars: 16,
        questionChars: 16,
        questionMax: 500,
        questionTruncated: false,
        knowledgeAvailableChars: 42,
        knowledgeChars: 42,
        knowledgeMax: 6_000,
        knowledgeTruncated: false,
        knowledgeDroppedChars: 0
      }
    })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:/brain', sizeMb: 1, kind: 'vault' }
        ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      listInbox: vi.fn().mockResolvedValue([]),
      searchBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Poste de travail du savoir"]')
        ?.click()
    )
    await flush()
    const benchQuestion = container.querySelector<HTMLInputElement>(
      '[aria-label="Question posée au Brain"]'
    )
    const mainQuestion = container.querySelector<HTMLInputElement>(
      '[aria-label="Rechercher un thème ou une fiche"]'
    )
    if (!benchQuestion || !mainQuestion) throw new Error('champs Knowledge absents')
    await act(async () => changeText(benchQuestion, 'question du banc'))
    await act(async () => benchQuestion.closest('.brain-bench')?.querySelector('button')?.click())
    await flush()
    expect(container.textContent).toContain('VERDICT-BANC-STABLE')
    expect(container.textContent).toContain('PREUVE-BANC-STABLE.md')
    expect(container.querySelector('[aria-label="Budget d’injection"]')).toBeTruthy()

    await act(async () => changeText(mainQuestion, 'question principale B'))
    expect(container.textContent).toContain('VERDICT-BANC-STABLE')
    expect(container.textContent).toContain('PREUVE-BANC-STABLE.md')
    expect(container.querySelector('[aria-label="Budget d’injection"]')).toBeTruthy()
    expect(benchQuestion.value).toBe('question du banc')
    expect(searchBrain).toHaveBeenCalledTimes(1)
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

  it('efface puis relance la recherche du vault apres un refresh', async () => {
    const searchBrain = vi
      .fn()
      .mockResolvedValueOnce({ status: 'found', note: 'ANCIEN', results: [] })
      .mockResolvedValueOnce({ status: 'empty', note: 'FRAIS', results: [] })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }
        ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      searchBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="Rechercher un thème ou une fiche"]'
    )
    if (!search) throw new Error('recherche Brain absente')
    await act(async () => changeText(search, 'decision'))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    await flush()
    expect(searchBrain).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-retrieval-status="found"]')?.textContent).toContain(
      'ANCIEN'
    )

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Rafraîchir les graphes"]')?.click()
    )
    await flush()
    expect(container.querySelector('[data-retrieval-status]')).toBeNull()
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    await flush()

    expect(searchBrain).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-retrieval-status="empty"]')?.textContent).toContain(
      'FRAIS'
    )
  })

  it('une ancienne recherche principale ne repeint jamais pendant Refresh', async () => {
    const oldSearch = deferred<{ status: string; note: string; results: never[] }>()
    const refresh = deferred<{ ok: boolean }>()
    const searchBrain = vi
      .fn()
      .mockReturnValueOnce(oldSearch.promise)
      .mockResolvedValueOnce({ status: 'empty', note: 'FRAIS-PRINCIPAL', results: [] })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }
        ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      refreshBrain: vi.fn().mockReturnValue(refresh.promise),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      searchBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="Rechercher un thème ou une fiche"]'
    )
    if (!search) throw new Error('recherche Brain absente')
    await act(async () => changeText(search, 'decision'))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    expect(searchBrain).toHaveBeenCalledTimes(1)

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Rafraîchir les graphes"]')?.click()
    )
    await act(async () => {
      oldSearch.resolve({ status: 'found', note: 'ANCIEN-PRINCIPAL', results: [] })
      await Promise.resolve()
    })
    await flush()
    expect(container.textContent).not.toContain('ANCIEN-PRINCIPAL')
    expect(search.value).toBe('decision')
    expect(searchBrain).toHaveBeenCalledTimes(1)

    await act(async () => {
      refresh.resolve({ ok: true })
      await Promise.resolve()
    })
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    await flush()
    expect(searchBrain).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('FRAIS-PRINCIPAL')
  })

  it('retire immédiatement les résultats du vault précédent quand la sélection change', async () => {
    const searchB = deferred<{ status: string; note: string; results: never[] }>()
    const searchBrain = vi.fn((path: string) =>
      path === 'A'
        ? Promise.resolve({ status: 'found', note: 'RÉSULTAT-A', results: [] })
        : searchB.promise
    )
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi.fn().mockResolvedValue([
        { id: 'a', label: 'Brain A', path: 'A', sizeMb: 1, kind: 'vault' },
        { id: 'b', label: 'Brain B', path: 'B', sizeMb: 1, kind: 'vault' }
      ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      searchBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="Rechercher un thème ou une fiche"]'
    )
    if (!search) throw new Error('recherche Brain absente')
    await act(async () => changeText(search, 'promotion'))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    await flush()
    expect(container.textContent).toContain('RÉSULTAT-A')

    await act(async () => chooseBrain('B'))
    await flush()
    expect(container.textContent).not.toContain('RÉSULTAT-A')
    expect(search.value).toBe('promotion')
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    expect(searchBrain).toHaveBeenLastCalledWith('B', 'promotion')
    await act(async () => {
      searchB.resolve({ status: 'found', note: 'RÉSULTAT-B', results: [] })
      await Promise.resolve()
    })
    await flush()
    expect(container.textContent).toContain('RÉSULTAT-B')
  })

  it('une décision inbox terminée après avoir quitté son vault ne perturbe pas le vault courant', async () => {
    const promote = deferred<{ ok: boolean }>()
    const refreshBrain = vi.fn().mockResolvedValue({ ok: true })
    const loadBrainGraph = vi.fn().mockResolvedValue({ nodes: [], links: [] })
    const listBrains = vi.fn().mockResolvedValue([
      { id: 'a', label: 'Brain A', path: 'A', sizeMb: 1, kind: 'vault' },
      { id: 'b', label: 'Brain B', path: 'B', sizeMb: 1, kind: 'vault' }
    ])
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains,
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph,
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      listInbox: vi.fn().mockResolvedValue([
        {
          id: 'inbox/a',
          file: 'A/inbox/a.md',
          title: 'Candidat A',
          body: 'a',
          nearDuplicates: []
        }
      ]),
      promoteInbox: vi.fn().mockReturnValue(promote.promise),
      rejectInbox: vi.fn().mockResolvedValue({ ok: true }),
      refreshBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Poste de travail du savoir"]')
        ?.click()
    )
    await flush()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-promote')?.click())
    await flush()
    await act(async () => chooseBrain('B'))
    await flush()
    const graphCallsAfterSwitch = loadBrainGraph.mock.calls.length
    const listCallsAfterSwitch = listBrains.mock.calls.length

    await act(async () => {
      promote.resolve({ ok: true })
      await Promise.resolve()
    })
    await flush()
    expect(refreshBrain).not.toHaveBeenCalled()
    expect(loadBrainGraph).toHaveBeenCalledTimes(graphCallsAfterSwitch)
    expect(listBrains).toHaveBeenCalledTimes(listCallsAfterSwitch)
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Graphe de connaissances"]')?.value
    ).toBe('B')
  })

  it('efface immédiatement puis relance aussi le banc Knowledge après Refresh', async () => {
    const refresh = deferred<{ ok: boolean }>()
    const budget = {
      questionSubmittedChars: 8,
      questionChars: 8,
      questionMax: 500,
      questionTruncated: false,
      knowledgeAvailableChars: 6,
      knowledgeChars: 6,
      knowledgeMax: 6_000,
      knowledgeTruncated: false,
      knowledgeDroppedChars: 0
    }
    const searchBrain = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'found',
        note: 'ANCIEN-BANC',
        query: 'decision',
        results: [],
        budget
      })
      .mockResolvedValueOnce({
        status: 'found',
        note: 'FRAIS-BANC',
        query: 'decision',
        results: [],
        budget
      })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([
          { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }
        ]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      refreshBrain: vi.fn().mockReturnValue(refresh.promise),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
      listInbox: vi.fn().mockResolvedValue([]),
      searchBrain
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Poste de travail du savoir"]')
        ?.click()
    )
    await flush()
    const question = container.querySelector<HTMLInputElement>(
      '[aria-label="Question posée au Brain"]'
    )
    if (!question) throw new Error('question du banc absente')
    await act(async () => changeText(question, 'decision'))
    await act(async () => question.closest('.brain-bench')?.querySelector('button')?.click())
    await flush()
    expect(container.textContent).toContain('ANCIEN-BANC')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Rafraîchir les graphes"]')?.click()
    )
    await flush()
    expect(container.textContent).not.toContain('ANCIEN-BANC')
    expect(searchBrain).toHaveBeenCalledTimes(1)

    await act(async () => {
      refresh.resolve({ ok: true })
      await Promise.resolve()
    })
    await flush()
    expect(searchBrain).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('FRAIS-BANC')
  })

  it('ne traite jamais un aperçu interrompu comme un graphe complet au retour A→B→A', async () => {
    const firstFullA = deferred<{ nodes: never[]; links: never[] }>()
    const loadBrainGraphPreview = vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve({ nodes: [{ id: `${path}-preview`, label: path, group: 0 }], links: [] })
      )
    const loadBrainGraph = vi.fn().mockImplementation((path: string) => {
      if (
        path === 'A' &&
        loadBrainGraph.mock.calls.filter(([called]) => called === 'A').length === 1
      ) {
        return firstFullA.promise
      }
      return Promise.resolve({ nodes: [{ id: `${path}-full`, label: path, group: 0 }], links: [] })
    })

    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi.fn().mockResolvedValue([
        { id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' },
        { id: 'b', label: 'B', path: 'B', sizeMb: 1, kind: 'vault' }
      ]),
      loadBrainGraphPreview,
      loadBrainGraph,
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () => chooseBrain('B'))
    await flush()
    await act(async () => chooseBrain('A'))
    await flush()

    expect(loadBrainGraph.mock.calls.map(([path]) => path)).toEqual(['A', 'B', 'A'])
    await act(async () => {
      firstFullA.resolve({ nodes: [], links: [] })
      await Promise.resolve()
    })
  })

  it('nettoie le chargement et l’erreur en revenant vers un Brain déjà en cache', async () => {
    const pendingPreviewB = deferred<{ nodes: never[]; links: never[] }>()
    let previewBCalls = 0
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi.fn().mockResolvedValue([
        { id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' },
        { id: 'b', label: 'B', path: 'B', sizeMb: 1, kind: 'vault' }
      ]),
      loadBrainGraphPreview: vi.fn().mockImplementation((path: string) => {
        if (path === 'A')
          return Promise.resolve({ nodes: [{ id: 'node-a', label: 'A', group: 0 }], links: [] })
        previewBCalls += 1
        return previewBCalls === 1
          ? pendingPreviewB.promise
          : Promise.reject(new Error('B indisponible'))
      }),
      loadBrainGraph: vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve({ nodes: [{ id: `node-${path}`, label: path, group: 0 }], links: [] })
        ),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()

    await act(async () => chooseBrain('B'))
    await flush()
    expect(container.querySelector('[role="status"]')).toBeTruthy()
    await act(async () => chooseBrain('A'))
    await flush()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[data-node-id="node-A"]')).toBeTruthy()

    await act(async () => {
      pendingPreviewB.resolve({ nodes: [], links: [] })
      await Promise.resolve()
    })
    await act(async () => chooseBrain('B'))
    await flush()
    expect(container.textContent).toContain('B indisponible')
    await act(async () => chooseBrain('A'))
    await flush()
    expect(container.textContent).not.toContain('B indisponible')
    expect(container.querySelector('[data-node-id="node-A"]')).toBeTruthy()
  })

  it('retire immédiatement les nœuds de A pendant le chargement de B', async () => {
    const previewB = deferred<{ nodes: never[]; links: never[] }>()
    const loadBrainNeighborhood = vi.fn().mockResolvedValue({ nodes: [], links: [] })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi.fn().mockResolvedValue([
        { id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' },
        { id: 'b', label: 'B', path: 'B', sizeMb: 1, kind: 'vault' }
      ]),
      loadBrainGraphPreview: vi
        .fn()
        .mockImplementation((path: string) =>
          path === 'B'
            ? previewB.promise
            : Promise.resolve({ nodes: [{ id: 'node-a', label: 'A', group: 0 }], links: [] })
        ),
      loadBrainGraph: vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: 'node-a', label: 'A', group: 0 }], links: [] }),
      loadBrainNeighborhood,
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    expect(container.querySelector('[data-node-id="node-a"]')).toBeTruthy()
    await act(async () => chooseBrain('B'))

    expect(container.querySelector('[data-node-id="node-a"]')).toBeNull()
    expect(loadBrainNeighborhood).not.toHaveBeenCalled()
    await act(async () => {
      previewB.resolve({ nodes: [], links: [] })
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })
  })

  it('invalide tous les LOD du Brain rafraîchi', async () => {
    const loadBrainGraph = vi.fn().mockResolvedValue({ nodes: [], links: [] })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph,
      refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Réglages de visibilité"]')?.click()
    )
    const lod = [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')].at(-1)
    if (!lod) throw new Error('réglage LOD absent')
    await act(async () => changeRange(lod, '400'))
    await flush()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Rafraîchir les graphes"]')?.click()
    )
    await flush()
    const currentLod = [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')].at(
      -1
    )
    if (!currentLod) throw new Error('réglage LOD absent après refresh')
    await act(async () => changeRange(currentLod, '300'))
    await flush()

    expect(loadBrainGraph.mock.calls.map(([, lodValue]) => lodValue)).toEqual([300, 400, 400, 300])
  })

  it('n’affiche en vue circulaire que les réglages et gestes réellement actifs', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }
    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.graph-layout-switch')?.click()
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Réglages de visibilité"]')?.click()
    )

    const settings = container.querySelector('.graph-settings-popover')?.textContent ?? ''
    expect(settings).not.toContain('Épaisseur des liens')
    expect(settings).not.toContain('Flèches de direction')
    expect(settings).not.toContain('Espacement des nœuds')
    expect(container.querySelector('.graph-hint')?.textContent).toContain('déplacer')
    expect(container.querySelector('.graph-hint')?.textContent).not.toContain('pivoter')
  })

  it('replie puis déplie une branche circulaire depuis son nœud interne', async () => {
    const nodes = [
      { id: 'a', label: 'A', group: 0, file: 'C:/brain/projects/alpha/a.md' },
      { id: 'b', label: 'B', group: 0, file: 'C:/brain/projects/alpha/b.md' },
      { id: 'c', label: 'C', group: 0, file: 'C:/brain/knowledge/c.md' }
    ]
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'C:/brain', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes, links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({ nodes, links: [] }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }
    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.graph-layout-switch')?.click()
    )
    expect(
      container.querySelector('[role="toolbar"][aria-label="Branches du Brain"] button')
    ).toBeTruthy()
    const before = container.querySelectorAll('[data-node-id]').length
    const branch = container.querySelector<HTMLButtonElement>('[data-node-id^="__tree__:"]')
    expect(branch).toBeTruthy()
    await act(async () => branch?.click())
    const collapsed = container.querySelectorAll('[data-node-id]').length
    expect(collapsed).toBeLessThan(before)
    const sameBranch = container.querySelector<HTMLButtonElement>(
      `[data-node-id="${branch?.dataset.nodeId}"]`
    )
    await act(async () => sameBranch?.click())
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(before)
  })

  it('remplace la stack IPC par un message métier quand loadBrainGraph échoue', async () => {
    const loadBrainGraph = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Error invoking remote method 'brain:graph': Error: ENOENT no such file or directory"
        )
      )
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      loadBrainGraph,
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(alert?.textContent).toContain('Impossible de charger le graphe de connaissances')
    expect(alert?.textContent).not.toContain('Error invoking remote method')
    expect(container.textContent).not.toContain('Error invoking remote method')
  })

  it('relance réellement le chargement via Réessayer, en effaçant l’erreur et en remontrant le spinner', async () => {
    const secondPreview = deferred<{ nodes: never[]; links: never[] }>()
    let previewCalls = 0
    const loadBrainGraph = vi.fn().mockRejectedValue(new Error('canal IPC indisponible'))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockImplementation(() => {
        previewCalls += 1
        return previewCalls === 1
          ? Promise.resolve({ nodes: [], links: [] })
          : secondPreview.promise
      }),
      loadBrainGraph,
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    expect(loadBrainGraph).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="status"]')).toBeNull()

    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Réessayer')
    )
    expect(retry).toBeTruthy()
    await act(async () => retry?.click())
    await flush()

    expect(previewCalls).toBe(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeTruthy()

    await act(async () => {
      secondPreview.resolve({ nodes: [], links: [] })
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })
    expect(loadBrainGraph).toHaveBeenCalledTimes(2)
  })

  it('ne refusionne pas un voisinage de l’ancien corpus après Réessayer sur le même vault', async () => {
    const loadBrainGraph = vi
      .fn()
      .mockRejectedValueOnce(new Error('workspace remplacé'))
      .mockResolvedValueOnce({
        nodes: [{ id: 'autowin', label: 'Autowin', group: 0 }],
        links: []
      })
    const loadBrainNeighborhood = vi.fn().mockResolvedValue({
      nodes: [{ id: 'rig', label: 'RIG', group: 0 }],
      links: [{ source: 'autowin', target: 'rig', relation: 'related' }]
    })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({
        nodes: [{ id: 'autowin', label: 'Autowin', group: 0 }],
        links: []
      }),
      loadBrainGraph,
      loadBrainNeighborhood,
      readNodeFile: vi.fn().mockResolvedValue({ path: 'autowin.md', content: '# Autowin' }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }

    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-node-id="autowin"]')?.click()
    )
    await flush()
    expect(container.querySelector('[data-node-id="rig"]')).toBeTruthy()

    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Réessayer')
    )
    await act(async () => retry?.click())
    await flush()

    expect(loadBrainGraph).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-node-id="rig"]')).toBeNull()
    expect(container.querySelector('[data-node-id="autowin"]')).toBeTruthy()
  })

  it('affiche une file de santé uniquement à partir des relations explicites', async () => {
    const nodes = [
      { id: 'new', label: 'Décision actuelle', group: 0 },
      { id: 'old', label: 'Décision remplacée', group: 0 },
      { id: 'text', label: 'Texte contradictoire sans relation', group: 0 }
    ]
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      listBrains: vi
        .fn()
        .mockResolvedValue([{ id: 'a', label: 'A', path: 'A', sizeMb: 1, kind: 'vault' }]),
      loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes, links: [] }),
      loadBrainGraph: vi.fn().mockResolvedValue({
        nodes,
        links: [
          { source: 'new', target: 'old', weight: 1, relation: 'supersedes' },
          { source: 'new', target: 'text', weight: 1, relation: 'related' }
        ]
      }),
      loadBrainThemes: vi.fn().mockResolvedValue([]),
      loadBrainThemeNodes: vi.fn().mockResolvedValue([])
    }
    await act(async () =>
      root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    )
    await flush()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Réglages de visibilité"]')?.click()
    )
    const healthToggle = [...container.querySelectorAll<HTMLLabelElement>('.toggle-row')]
      .find((label) => label.textContent?.includes('Relations à vérifier'))
      ?.querySelector<HTMLInputElement>('input')
    expect(healthToggle).toBeTruthy()
    await act(async () => healthToggle?.click())

    const lens = container.querySelector('[aria-label="Relations à vérifier"]')
    expect(lens?.textContent).toContain('Remplace')
    expect(lens?.textContent).toContain('Décision actuelle')
    expect(lens?.textContent).toContain('Décision remplacée')
    expect(lens?.textContent).not.toContain('Texte contradictoire sans relation')
  })
})
