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

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

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

  it('ne refusionne ni fiche ni thème hors workspace depuis le preview global', async () => {
    installApi({
      loadBrainGraphPreview: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'knowledge/domain/rigapplication-documentation/proc',
            label: 'Procédure RIG',
            file: 'C:/brain/knowledge/domain/rigapplication-documentation/proc.md',
            themes: ['rig']
          },
          {
            id: 'knowledge/projects/autowin-os/guide',
            label: 'Guide Autowin',
            file: 'C:/brain/knowledge/projects/autowin-os/guide.md',
            themes: ['autowin']
          }
        ],
        links: []
      }),
      searchBrain: vi.fn().mockResolvedValue(
        envelope({
          query: 'rig',
          results: [
            {
              id: 'knowledge/projects/autowin-os/guide',
              label: 'Guide Autowin',
              file: 'C:/brain/knowledge/projects/autowin-os/guide.md',
              themes: ['autowin'],
              score: 3,
              relations: []
            }
          ]
        })
      )
    })
    await mount()
    await search('rig')

    const searchResults = container.querySelector('[aria-label="Fiches trouvées"]')
    expect(searchResults?.textContent).toContain('Guide Autowin')
    expect(searchResults?.textContent).not.toContain('Procédure RIG')
    expect(container.querySelector('[data-theme-id="rig"]')).toBeNull()
  })

  it('un clic sur un thème scopé ne réintroduit pas les fiches du preview global', async () => {
    const loadBrainThemeNodes = vi.fn().mockResolvedValue([
      {
        id: 'knowledge/domain/autowin-os-guide',
        label: 'Guide Autowin',
        file: 'C:/brain/knowledge/domain/autowin-os-guide.md',
        themes: ['theme/architecture'],
        group: 0
      }
    ])
    installApi({
      loadBrainGraphPreview: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'knowledge/domain/rigapplication-documentation/proc',
            label: 'Procédure RIG',
            file: 'C:/brain/knowledge/domain/rigapplication-documentation/proc.md',
            themes: ['theme/architecture']
          }
        ],
        links: []
      }),
      loadBrainThemeNodes,
      searchBrain: vi.fn().mockResolvedValue(
        envelope({
          query: 'architecture',
          results: [
            {
              id: 'knowledge/domain/autowin-os-guide',
              label: 'Guide Autowin',
              file: 'C:/brain/knowledge/domain/autowin-os-guide.md',
              themes: ['theme/architecture'],
              score: 3,
              relations: []
            }
          ]
        })
      )
    })
    await mount()
    await search('architecture')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-theme-id="theme/architecture"]')?.click()
    )
    await flush()

    expect(loadBrainThemeNodes).toHaveBeenCalledWith('C:\\brain', ['theme/architecture'])
    const panel = container.querySelector(
      '[aria-label="Nœuds des thèmes actifs par ordre alphabétique"]'
    )
    expect(panel?.textContent).toContain('Guide Autowin')
    expect(panel?.textContent).not.toContain('Procédure RIG')
  })

  it('assainit une erreur IPC de thème et Réessayer relance réellement ce chargement', async () => {
    const loadBrainThemeNodes = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Error invoking remote method 'os:loadBrainThemeNodes': Error: EIO")
      )
      .mockResolvedValueOnce([
        {
          id: 'knowledge/domain/autowin-os-guide',
          label: 'Guide Autowin',
          file: 'C:/brain/knowledge/domain/autowin-os-guide.md',
          themes: ['theme/architecture'],
          group: 0
        }
      ])
    installApi({
      loadBrainThemes: vi
        .fn()
        .mockResolvedValue([{ id: 'theme/architecture', label: 'Architecture', count: 1 }]),
      loadBrainThemeNodes
    })
    await mount()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-theme-id="theme/architecture"]')?.click()
    )
    await flush()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Impossible de charger les notes du thème.'
    )
    expect(container.textContent).not.toContain('Error invoking remote method')
    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Réessayer')
    )
    await act(async () => retry?.click())
    await flush()

    expect(loadBrainThemeNodes).toHaveBeenCalledTimes(2)
    expect(
      container.querySelector('[aria-label="Nœuds des thèmes actifs par ordre alphabétique"]')
        ?.textContent
    ).toContain('Guide Autowin')
  })

  it("l'ouverture d'un résultat scopé conserve un voisinage sans fiche RIG", async () => {
    const loadBrainNeighborhood = vi.fn().mockResolvedValue({
      nodes: [
        {
          id: 'knowledge/domain/autowin-os-guide',
          label: 'Guide Autowin',
          file: 'C:/brain/knowledge/domain/autowin-os-guide.md',
          themes: ['theme/architecture'],
          group: 0
        }
      ],
      links: []
    })
    installApi({
      loadBrainNeighborhood,
      searchBrain: vi.fn().mockResolvedValue(
        envelope({
          results: [
            {
              id: 'knowledge/domain/autowin-os-guide',
              label: 'Guide Autowin',
              file: 'C:/brain/knowledge/domain/autowin-os-guide.md',
              themes: ['theme/architecture'],
              score: 4,
              relations: []
            }
          ]
        })
      ),
      readNodeFile: vi.fn().mockResolvedValue({
        path: 'C:/brain/knowledge/domain/autowin-os-guide.md',
        content: '# Guide Autowin\n'
      })
    })
    await mount()
    await search('promotion')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.node-search-result')?.click()
    )
    await flush()

    expect(loadBrainNeighborhood).toHaveBeenCalledWith(
      'C:\\brain',
      'knowledge/domain/autowin-os-guide'
    )
    expect(container.textContent).toContain('Guide Autowin')
    expect(container.textContent).not.toContain('Procédure RIG')
  })

  it('assainit une erreur IPC de voisinage', async () => {
    installApi({
      loadBrainNeighborhood: vi
        .fn()
        .mockRejectedValue(
          new Error("Error invoking remote method 'os:loadBrainNeighborhood': Error: EIO")
        ),
      readNodeFile: vi.fn().mockResolvedValue({ path: 'C:/brain/knowledge/a.md', content: '# A' })
    })
    await mount()
    await search('promotion')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.node-search-result')?.click()
    )
    await flush()

    expect(container.textContent).toContain('Impossible de charger le voisinage.')
    expect(container.textContent).not.toContain('Error invoking remote method')
  })

  it('assainit une erreur IPC de lecture de fiche', async () => {
    installApi({
      loadBrainNeighborhood: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
      readNodeFile: vi
        .fn()
        .mockRejectedValue(new Error("Error invoking remote method 'os:readNodeFile': Error: EIO"))
    })
    await mount()
    await search('promotion')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.node-search-result')?.click()
    )
    await flush()

    expect(container.textContent).toContain('Impossible de lire la fiche.')
    expect(container.textContent).not.toContain('Error invoking remote method')
  })

  it('conserve le catalogue de thèmes scopé avant recherche et après effacement', async () => {
    installApi({
      loadBrainGraphPreview: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'knowledge/domain/rigapplication-documentation/proc',
            label: 'Procédure RIG',
            file: 'C:/brain/knowledge/domain/rigapplication-documentation/proc.md',
            themes: ['theme/rig']
          }
        ],
        links: []
      }),
      loadBrainThemes: vi.fn().mockResolvedValue([
        { id: 'theme/autowin-os', label: 'Autowin OS', count: 2 },
        { id: 'theme/architecture', label: 'Architecture', count: 1 }
      ]),
      searchBrain: vi.fn().mockResolvedValue(
        envelope({
          query: 'architecture',
          results: [
            {
              id: 'knowledge/domain/autowin-os-guide',
              label: 'Guide Autowin',
              file: 'C:/brain/knowledge/domain/autowin-os-guide.md',
              themes: ['theme/architecture'],
              score: 4,
              relations: []
            }
          ]
        })
      )
    })
    await mount()

    expect(container.querySelector('[data-theme-id="theme/autowin-os"]')).not.toBeNull()
    expect(container.querySelector('[data-theme-id="theme/rig"]')).toBeNull()
    await search('architecture')
    await search('')
    expect(container.querySelector('[data-theme-id="theme/autowin-os"]')).not.toBeNull()
    expect(container.querySelector('[data-theme-id="theme/rig"]')).toBeNull()
  })

  it('ne flashe aucun thème global pendant le chargement du catalogue scopé', async () => {
    const themes = deferred<Array<{ id: string; label: string; count: number }>>()
    installApi({
      listBrains: vi.fn().mockResolvedValue([
        {
          id: 'brain',
          label: 'Brain',
          path: 'C:\\brain',
          sizeMb: 1,
          kind: 'vault',
          themes: [{ id: 'theme/rig', label: 'RIG' }]
        }
      ]),
      loadBrainThemes: vi.fn().mockReturnValue(themes.promise)
    })
    await mount()

    expect(container.querySelector('[data-theme-id="theme/rig"]')).toBeNull()
    themes.resolve([{ id: 'theme/autowin-os', label: 'Autowin OS', count: 2 }])
    await flush()
    expect(container.querySelector('[data-theme-id="theme/autowin-os"]')).not.toBeNull()
    expect(container.querySelector('[data-theme-id="theme/rig"]')).toBeNull()
  })

  it('garde le catalogue vide et affiche une erreur métier si son chargement échoue', async () => {
    installApi({
      listBrains: vi.fn().mockResolvedValue([
        {
          id: 'brain',
          label: 'Brain',
          path: 'C:\\brain',
          sizeMb: 1,
          kind: 'vault',
          themes: [{ id: 'theme/rig', label: 'RIG' }]
        }
      ]),
      loadBrainThemes: vi.fn().mockRejectedValue(new Error('catalogue hors ligne'))
    })
    await mount()

    expect(container.querySelector('[data-theme-id="theme/rig"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Impossible de charger les thèmes du workspace.'
    )
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

  it('promouvoir recharge le graphe sans doubler l’invalidation déjà faite par le main', async () => {
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
    const graphCallsBefore = (api.loadBrainGraph as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Poste de travail du savoir"]')
        ?.click()
    )
    await flush()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-promote')?.click())
    await flush()

    expect(api.promoteInbox).toHaveBeenCalledWith('C:\\brain', 'inbox/a')
    // Promote ne résout qu'après l'invalidation main : le renderer recharge son graphe sans payer un
    // second `refreshBrain` qui pourrait perturber un autre vault entre-temps.
    expect(api.refreshBrain).not.toHaveBeenCalled()
    expect((api.loadBrainGraph as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      graphCallsBefore
    )
  })

  it.each([
    ['Promote', 'button.is-promote', 'promoteInbox'],
    ['Reject', 'button.is-reject', 'rejectInbox']
  ] as const)(
    '%s efface puis relance aussi la question courante du banc',
    async (_label, actionSelector, apiMethod) => {
      const mutation = deferred<{ ok: boolean }>()
      const searchBrain = vi
        .fn()
        .mockResolvedValueOnce(envelope({ note: 'ANCIEN-BANC' }))
        .mockResolvedValueOnce(envelope({ note: 'FRAIS-BANC' }))
      const api = installApi({
        searchBrain,
        [apiMethod]: vi.fn().mockReturnValue(mutation.promise),
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
      expect(container.textContent).not.toContain('ANCIEN-BANC')
      expect(question.value).toBe('promotion')
      expect(searchBrain).toHaveBeenCalledTimes(1)
      expect(api.refreshBrain).not.toHaveBeenCalled()

      await act(async () => {
        mutation.resolve({ ok: true })
        await Promise.resolve()
      })
      await flush()
      expect(api.refreshBrain).not.toHaveBeenCalled()
      expect(searchBrain).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('FRAIS-BANC')
      expect(container.textContent).not.toContain('ANCIEN-BANC')
    }
  )

  it.each([
    ['mutation Promote', 'button.is-promote', 'promoteInbox'],
    ['mutation Reject', 'button.is-reject', 'rejectInbox']
  ] as const)(
    '%s efface ANCIEN sans relancer quand l’opération échoue',
    async (_label, actionSelector, apiMethod) => {
      const searchBrain = vi.fn().mockResolvedValue(envelope({ note: 'ANCIEN-BANC' }))
      const api = installApi({
        searchBrain,
        [apiMethod]: vi.fn().mockRejectedValue(new Error('mutation refusée')),
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

      expect(container.textContent).not.toContain('ANCIEN-BANC')
      expect(question.value).toBe('promotion')
      expect(searchBrain).toHaveBeenCalledTimes(1)
      expect(api[apiMethod] as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
      expect(api.refreshBrain).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['Promote', 'button.is-promote', 'promoteInbox'],
    ['Reject', 'button.is-reject', 'rejectInbox']
  ] as const)(
    '%s empêche aussi une ancienne recherche principale de repeindre',
    async (_label, actionSelector, apiMethod) => {
      const oldSearch = deferred<Record<string, unknown>>()
      const mutation = deferred<{ ok: boolean }>()
      const searchBrain = vi
        .fn()
        .mockReturnValueOnce(oldSearch.promise)
        .mockResolvedValueOnce(envelope({ note: 'FRAIS-PRINCIPAL' }))
      const api = installApi({
        searchBrain,
        [apiMethod]: vi.fn().mockReturnValue(mutation.promise),
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
      await search('promotion')
      expect(searchBrain).toHaveBeenCalledTimes(1)

      await act(async () => container.querySelector<HTMLButtonElement>(actionSelector)?.click())
      await act(async () => {
        oldSearch.resolve(envelope({ note: 'ANCIEN-PRINCIPAL' }))
        await Promise.resolve()
      })
      await flush()
      expect(container.textContent).not.toContain('ANCIEN-PRINCIPAL')
      expect(searchBrain).toHaveBeenCalledTimes(1)
      expect(api.refreshBrain).not.toHaveBeenCalled()

      await act(async () => {
        mutation.resolve({ ok: true })
        await Promise.resolve()
      })
      await flush()
      expect(api.refreshBrain).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(250)
      })
      await flush()
      expect(searchBrain).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('FRAIS-PRINCIPAL')
      expect(
        container.querySelector<HTMLInputElement>('[aria-label="Rechercher un thème ou une fiche"]')
          ?.value
      ).toBe('promotion')
    }
  )

  it.each([
    ['mutation Promote', 'button.is-promote', 'promoteInbox'],
    ['mutation Reject', 'button.is-reject', 'rejectInbox']
  ] as const)(
    '%s ne laisse ni repeindre ni relancer la recherche principale en échec',
    async (_label, actionSelector, apiMethod) => {
      const oldSearch = deferred<Record<string, unknown>>()
      const searchBrain = vi.fn().mockReturnValue(oldSearch.promise)
      const api = installApi({
        searchBrain,
        [apiMethod]: vi.fn().mockRejectedValue(new Error('mutation refusée')),
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
      await search('promotion')
      await act(async () => container.querySelector<HTMLButtonElement>(actionSelector)?.click())
      await act(async () => {
        oldSearch.resolve(envelope({ note: 'ANCIEN-PRINCIPAL' }))
        await Promise.resolve()
      })
      await flush()

      expect(container.textContent).not.toContain('ANCIEN-PRINCIPAL')
      expect(searchBrain).toHaveBeenCalledTimes(1)
      expect(api.refreshBrain).not.toHaveBeenCalled()
    }
  )
})
