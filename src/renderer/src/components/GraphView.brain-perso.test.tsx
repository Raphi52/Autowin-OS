// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { NodePanel, ThemeNodesPanel } from './GraphView.panels'

/**
 * LE BRAIN PERSO DANS LA VUE KNOWLEDGE (conv-1233, 2026-10-28, demande utilisateur : « affiche le
 * Brain perso dans la vue Knowledge, à côté du Brain d'équipe, avec ses notes marquées perso »).
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const EQUIPE = 'C:\\brain'
const PERSO = 'C:\\Users\\moi\\Brain perso'

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })

const enveloppe = (id: string, label: string): Record<string, unknown> => ({
  status: 'found',
  note: 'savoir trouvé',
  query: 'pneus',
  results: [{ id, label, file: `C:/x/${id}.md`, themes: [], score: 4, relations: [] }],
  budget: {
    questionSubmittedChars: 5,
    questionChars: 5,
    questionMax: 500,
    questionTruncated: false,
    knowledgeAvailableChars: 0,
    knowledgeChars: 0,
    knowledgeMax: 6_000,
    knowledgeTruncated: false,
    knowledgeDroppedChars: 0
  }
})

function installerApi(): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listBrains: vi.fn().mockResolvedValue([
      { id: 'brain', label: 'Brain', path: EQUIPE, sizeMb: 1, kind: 'vault' },
      {
        id: 'brain-perso',
        label: 'Brain perso',
        path: PERSO,
        sizeMb: 0,
        kind: 'vault',
        perso: true
      }
    ]),
    loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainThemes: vi.fn().mockResolvedValue([]),
    loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
    refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
    searchBrain: vi.fn((path: string) =>
      Promise.resolve(
        path === PERSO
          ? enveloppe('knowledge/domain/velo', 'Vélo du dimanche')
          : enveloppe('knowledge/lessons/equipe', 'Note d’équipe')
      )
    ),
    listInbox: vi.fn().mockResolvedValue([]),
    promoteInbox: vi.fn().mockResolvedValue({ ok: true }),
    rejectInbox: vi.fn().mockResolvedValue({ ok: true })
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

async function monter(): Promise<void> {
  await act(async () =>
    root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
  )
  await flush()
}

async function choisirBrain(path: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>(
    '[aria-label="Graphe de connaissances"]'
  )
  if (!select) throw new Error('sélecteur Brain absent')
  await act(async () => {
    select.value = path
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

async function chercher(texte: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Rechercher un thème ou une fiche"]'
  )
  if (!input) throw new Error('champ de recherche absent')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, texte)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    vi.advanceTimersByTime(250)
  })
  await flush()
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('vue Knowledge — Brain perso à côté du Brain d’équipe', () => {
  it('le sélecteur propose le Brain d’équipe ET le Brain perso', async () => {
    installerApi()
    await monter()
    const options = [
      ...container.querySelectorAll('select[aria-label="Graphe de connaissances"] option')
    ]
    expect(options.map((o) => [o.getAttribute('value'), o.textContent])).toEqual([
      [EQUIPE, 'Brain'],
      [PERSO, 'Brain perso']
    ])
  })

  it('Brain perso ouvert : ses notes portent la marque « perso », sans poste de revue', async () => {
    const api = installerApi()
    await monter()
    await choisirBrain(PERSO)
    await chercher('pneus')
    expect(api.searchBrain).toHaveBeenLastCalledWith(PERSO, 'pneus')
    const resultat = container.querySelector('.node-search-result')
    expect(resultat?.textContent).toContain('Vélo du dimanche')
    expect(resultat?.querySelector('[data-testid="note-perso"]')?.textContent).toBe('perso')
    // Ses faits sont promus seuls : ni revue de la boîte de réception, ni compteur d'attente.
    expect(container.querySelector('.graph-workbench-button')).toBeNull()
    expect(api.listInbox).not.toHaveBeenCalledWith(PERSO)
  })

  it('Brain d’équipe ouvert : aucune note marquée perso', async () => {
    installerApi()
    await monter()
    await chercher('pneus')
    expect(container.querySelector('.node-search-result')?.textContent).toContain('Note d’équipe')
    expect(container.querySelector('[data-testid="note-perso"]')).toBeNull()
    expect(container.querySelector('.graph-workbench-button')).not.toBeNull()
  })

  it('la liste d’un thème marque chaque note perso', async () => {
    const noeud = { id: 'knowledge/domain/velo', label: 'Vélo du dimanche', themes: [] }
    await act(async () =>
      root.render(
        createElement(ThemeNodesPanel, {
          nodes: [noeud] as never,
          onNavigate: vi.fn(),
          perso: true
        })
      )
    )
    expect(container.querySelectorAll('[data-testid="note-perso"]')).toHaveLength(1)
  })

  it('la fiche d’une note perso porte la marque ; celle d’une note d’équipe non', async () => {
    const noeud = { id: 'knowledge/domain/velo', label: 'Vélo du dimanche', themes: [] }
    const fiche = (perso: boolean): Promise<void> =>
      act(async () =>
        root.render(
          createElement(NodePanel, {
            node: noeud as never,
            file: null,
            fileErr: '',
            linkedNodes: [],
            onNavigate: vi.fn(),
            perso
          })
        )
      )
    await fiche(true)
    expect(container.querySelector('.node-panel__theme [data-testid="note-perso"]')).not.toBeNull()
    await fiche(false)
    expect(container.querySelector('[data-testid="note-perso"]')).toBeNull()
  })
})
