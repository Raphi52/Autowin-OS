// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * VUE KNOWLEDGE « RECHERCHE AU CENTRE » : les thèmes sont des pastilles au-dessus du graphe (les
 * plus gros d'abord, le reste derrière « + N thèmes »), et les commandes rares vivent dans le menu
 * « Plus » au lieu de boutons posés dans la scène.
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
      scene: () => ({ add: vi.fn(), remove: vi.fn(), traverse: vi.fn() }),
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
// Douze thèmes de tailles distinctes : « t12 » est le plus gros, « t1 » le plus petit.
const THEMES = Array.from({ length: 12 }, (_, index) => ({
  id: `t${index + 1}`,
  label: `Thème ${index + 1}`,
  count: (index + 1) * 10
}))

function installApi(): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    listBrains: vi.fn().mockResolvedValue([brain]),
    loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainThemes: vi.fn().mockResolvedValue(THEMES),
    loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
    loadBrainNeighborhood: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    readNodeFile: vi.fn().mockResolvedValue({ path: 'a.md', content: 'contenu' }),
    refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
    searchBrain: vi.fn().mockResolvedValue({ status: 'empty', note: '', query: 'q', results: [] }),
    listInbox: vi.fn().mockResolvedValue([]),
    brainAffectations: vi.fn().mockResolvedValue({ affectations: [] })
  }
}

async function mount(): Promise<void> {
  await act(async () =>
    root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
  )
  await flush()
}

const pastilles = (): string[] =>
  [...container.querySelectorAll('.graph-theme-chip[data-theme-id]')].map(
    (pastille) => pastille.getAttribute('data-theme-id') ?? ''
  )
const bouton = (selecteur: string): HTMLButtonElement => {
  const trouve = container.querySelector<HTMLButtonElement>(selecteur)
  if (!trouve) throw new Error(`${selecteur} absent`)
  return trouve
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
  installApi()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('vue Knowledge — les thèmes en pastilles', () => {
  it('montre les 8 plus gros thèmes, le reste derrière « + N thèmes »', async () => {
    await mount()
    expect(pastilles()).toEqual(['t12', 't11', 't10', 't9', 't8', 't7', 't6', 't5'])
    expect(bouton('.graph-theme-chip--plus').textContent).toBe('+ 4 thèmes')

    await act(async () => bouton('.graph-theme-chip--plus').click())
    expect(pastilles()).toHaveLength(12)
    expect(bouton('.graph-theme-chip--plus').textContent).toBe('Moins de thèmes')
  })

  it('garde visible un thème actif hors des 8 premiers une fois replié', async () => {
    await mount()
    await act(async () => bouton('.graph-theme-chip--plus').click())
    await act(async () => bouton('[data-theme-id="t1"]').click())
    await act(async () => bouton('.graph-theme-chip--plus').click())
    expect(pastilles()).toContain('t1')
    expect(bouton('[data-theme-id="t1"]').getAttribute('aria-pressed')).toBe('true')
    expect(bouton('.graph-theme-chip--plus').textContent).toBe('+ 3 thèmes')
  })
})

describe('vue Knowledge — le menu « Plus »', () => {
  it('s’ouvre au clic, se ferme sur Échap, et ouvre ses panneaux dans la scène', async () => {
    await mount()
    const menu = (): HTMLElement => container.querySelector('.graph-plus__menu') as HTMLElement
    expect(menu().hidden).toBe(true)
    // Plus aucun bouton de réglage posé dans la scène : tout part du menu.
    expect(container.querySelector('.graph-stage .graph-settings-button')).toBeNull()

    await act(async () => bouton('.graph-plus__bouton').click())
    expect(menu().hidden).toBe(false)
    expect(bouton('.graph-plus__bouton').getAttribute('aria-expanded')).toBe('true')

    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(menu().hidden).toBe(true)

    await act(async () => bouton('.graph-plus__bouton').click())
    await act(async () => bouton('.graph-plus__item--visibilite').click())
    expect(menu().hidden).toBe(true)
    expect(container.querySelector('.graph-stage .graph-settings-popover')).not.toBeNull()
  })

  it('choisit la disposition et l’ambiance par deux choix nommés, sans bascule muette', async () => {
    await mount()
    await act(async () => bouton('[data-disposition="tree"]').click())
    expect(bouton('[data-disposition="tree"]').getAttribute('aria-checked')).toBe('true')
    expect(bouton('[data-disposition="force"]').getAttribute('aria-checked')).toBe('false')
    await act(async () => bouton('[data-ambiance="galaxy"]').click())
    expect(bouton('[data-ambiance="galaxy"]').getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.graph-observatory--galaxy')).not.toBeNull()
  })
})
