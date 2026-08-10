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

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })

function envelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'found',
    note: 'savoir trouvé — passages retenus injectés',
    query: 'promotion',
    results: [
      {
        id: 'knowledge/a',
        label: 'Fiche A',
        file: 'C:/brain/knowledge/a.md',
        themes: [],
        score: 4,
        relations: []
      }
    ],
    budget: {
      questionSubmittedChars: 9,
      questionChars: 9,
      questionMax: 500,
      questionTruncated: false,
      knowledgeAvailableChars: 10,
      knowledgeChars: 10,
      knowledgeMax: 6_000,
      knowledgeTruncated: false,
      knowledgeDroppedChars: 0
    },
    ...over
  }
}

function installApi(over: Record<string, unknown> = {}): Record<string, unknown> {
  const api = {
    listBrains: vi
      .fn()
      .mockResolvedValue([
        { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }
      ]),
    loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainThemes: vi.fn().mockResolvedValue([]),
    loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
    refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
    searchBrain: vi.fn().mockResolvedValue(envelope()),
    listInbox: vi.fn().mockResolvedValue([]),
    promoteInbox: vi.fn().mockResolvedValue({ ok: true }),
    rejectInbox: vi.fn().mockResolvedValue({ ok: true }),
    ...over
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

async function mount(): Promise<void> {
  await act(async () =>
    root.render(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
  )
  await flush()
}

async function search(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Rechercher un thème ou une fiche"]'
  )
  if (!input) throw new Error('champ de recherche absent')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // La recherche est débattue de 200 ms côté vue.
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

describe('GraphView — les 4 états de retrieval cessent d’être aplatis (item 4)', () => {
  it('affiche la note du statut rendu par le main', async () => {
    installApi({
      searchBrain: vi
        .fn()
        .mockResolvedValue(envelope({ status: 'empty', note: 'le savoir ne couvre pas' }))
    })
    await mount()
    await search('promotion')
    const banner = container.querySelector('[data-retrieval-status="empty"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('le savoir ne couvre pas')
  })

  it('un Brain INDISPONIBLE ne ressemble pas à un « aucun résultat »', async () => {
    installApi({
      searchBrain: vi
        .fn()
        .mockResolvedValue(
          envelope({ status: 'unavailable', note: 'serveur Brain injoignable', results: [] })
        )
    })
    await mount()
    await search('promotion')
    expect(container.querySelector('[data-retrieval-status="unavailable"]')?.textContent).toContain(
      'injoignable'
    )
    expect(container.querySelector('[data-retrieval-status="empty"]')).toBeNull()
  })

  it('une PANNE du canal devient une alerte, pas un silence', async () => {
    installApi({ searchBrain: vi.fn().mockRejectedValue(new Error('worker arrêté')) })
    await mount()
    await search('promotion')
    const failed = container.querySelector('[data-retrieval-status="failed"]')
    expect(failed).not.toBeNull()
    expect(failed?.getAttribute('role')).toBe('alert')
  })

  it('le statut « found » rend AUSSI les fiches locales de l’enveloppe', async () => {
    installApi()
    await mount()
    await search('promotion')
    expect(container.querySelector('[data-retrieval-status="found"]')).not.toBeNull()
    expect(container.textContent).toContain('Fiche A')
  })

  it('effacer la question retire la note avec les résultats', async () => {
    installApi()
    await mount()
    await search('promotion')
    expect(container.querySelector('[data-retrieval-status="found"]')).not.toBeNull()
    await search('')
    expect(container.querySelector('[data-retrieval-status]')).toBeNull()
  })
})

describe('GraphView — le poste de travail du savoir est atteignable (items 1 et 2)', () => {
  it('ouvre la boîte de réception et le banc d’essai depuis la vue', async () => {
    const api = installApi({
      listInbox: vi.fn().mockResolvedValue([
        {
          id: 'inbox/a',
          file: 'C:/brain/inbox/a.md',
          title: 'Candidat à promouvoir',
          body: 'corps',
          nearDuplicates: []
        }
      ])
    })
    await mount()
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Poste de travail du savoir"]'
    )
    expect(toggle).not.toBeNull()
    await act(async () => toggle?.click())
    await flush()

    expect(api.listInbox).toHaveBeenCalledWith('C:\\brain')
    expect(container.querySelector('[aria-label="Boîte de réception du savoir"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Banc d’essai de récupération"]')).not.toBeNull()
    expect(container.textContent).toContain('Candidat à promouvoir')
    expect(container.querySelector('button.is-promote')).not.toBeNull()
    expect(container.querySelector('button.is-reject')).not.toBeNull()
  })

  it('promouvoir depuis la vue déclenche la RÉINDEXATION du graphe', async () => {
    const api = installApi({
      listInbox: vi.fn().mockResolvedValue([
        {
          id: 'inbox/a',
          file: 'C:/brain/inbox/a.md',
          title: 'Candidat',
          body: 'corps',
          nearDuplicates: []
        }
      ])
    })
    await mount()
    const refreshCallsBefore = (api.refreshBrain as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Poste de travail du savoir"]')
        ?.click()
    )
    await flush()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-promote')?.click())
    await flush()

    expect(api.promoteInbox).toHaveBeenCalledWith('C:\\brain', 'inbox/a')
    // `onIndexChanged` est branché sur le rafraîchissement du graphe : sans lui, le nœud promu
    // resterait affiché à son ancien emplacement.
    expect((api.refreshBrain as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      refreshCallsBefore
    )
  })

  it.each([
    ['Promote', 'button.is-promote', 'promoteInbox'],
    ['Reject', 'button.is-reject', 'rejectInbox']
  ] as const)(
    '%s efface puis relance aussi la question courante du banc',
    async (_label, actionSelector, apiMethod) => {
      const searchBrain = vi
        .fn()
        .mockResolvedValueOnce(envelope({ note: 'ANCIEN-BANC' }))
        .mockResolvedValueOnce(envelope({ note: 'FRAIS-BANC' }))
      const api = installApi({
        searchBrain,
        listInbox: vi.fn().mockResolvedValue([
          {
            id: 'inbox/a',
            file: 'C:/brain/inbox/a.md',
            title: 'Candidat',
            body: 'corps',
            nearDuplicates: []
          }
        ])
      })
      await mount()
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
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      await act(async () => {
        setter?.call(question, 'promotion')
        question.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => question.closest('.brain-bench')?.querySelector('button')?.click())
      await flush()
      expect(container.textContent).toContain('ANCIEN-BANC')

      await act(async () => container.querySelector<HTMLButtonElement>(actionSelector)?.click())
      await flush()

      expect(api[apiMethod] as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        'C:\\brain',
        'inbox/a'
      )
      expect(searchBrain).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('FRAIS-BANC')
      expect(container.textContent).not.toContain('ANCIEN-BANC')
    }
  )
})
