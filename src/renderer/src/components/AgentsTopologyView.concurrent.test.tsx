// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsTopologyView } from './AgentsTopologyView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const topology = {
  version: 1,
  orchestrator: {
    slotId: 'orchestrator',
    provider: 'openai',
    modelId: 'gpt',
    reasoningEffort: 'medium'
  },
  subagents: [
    { slotId: 'subagent-1', provider: 'openai', modelId: 'gpt', reasoningEffort: 'low' },
    { slotId: 'subagent-2', provider: 'openai', modelId: 'gpt', reasoningEffort: 'high' }
  ],
  panels: { scout: [], frame: [], terrain: [], judge: [] }
}

const models = [
  {
    id: 'gpt',
    provider: 'openai',
    model: 'gpt',
    label: 'GPT',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    dynamicallyLoaded: true
  }
]

let container: HTMLDivElement
let root: Root

/**
 * React suit la valeur des champs par un tracker interne : écrire `input.value` directement fait
 * partir l'évènement mais React le considère « sans changement ». On passe donc par le setter natif.
 */
function saisir(champ: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(champ, valeur)
  champ.dispatchEvent(new Event('input', { bubbles: true }))
}

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

/** Ouvre le menu déroulant de modèle d'un rôle (le même que « Modèle des petites tâches »). */
async function ouvrirMenu(idBase: string): Promise<HTMLButtonElement> {
  const barre = container.querySelector<HTMLButtonElement>(`button[data-testid="${idBase}"]`)
  expect(barre).not.toBeNull()
  if (barre!.getAttribute('aria-expanded') !== 'true') await act(async () => barre!.click())
  return barre!
}

/** Le geste réel : une pastille d'effort sur la ligne d'un modèle, puis le menu se referme. */
async function choisirDansLeMenu(idBase: string, ligne: string, effort: string): Promise<void> {
  await ouvrirMenu(idBase)
  const cran = container.querySelector<HTMLButtonElement>(
    `[data-testid="${idBase}-liste"] [data-row="${ligne}"] [data-effort="${effort}"]`
  )
  expect(cran).not.toBeNull()
  await act(async () => cran!.click())
  expect(container.querySelector(`[data-testid="${idBase}-liste"]`)).toBeNull()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

describe('AgentsTopologyView orchestrator persistence', () => {
  it('persiste les changements orchestrateur dans la topologie canonique, dans l’ordre', async () => {
    const topologySaves: Array<Deferred<typeof topology>> = []
    const setTopology = vi.fn((_next: typeof topology) => {
      const request = deferred<typeof topology>()
      topologySaves.push(request)
      return request.promise
    })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined,
      setTopology
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    await choisirDansLeMenu('topology-modele-orchestrator', 'openai:gpt', 'high')
    await choisirDansLeMenu('topology-modele-orchestrator', 'openai:gpt', 'low')

    expect(setTopology).toHaveBeenCalledTimes(1)
    topologySaves[0].resolve(setTopology.mock.calls[0][0])
    await flush()

    expect(setTopology).toHaveBeenCalledTimes(2)
    expect(setTopology.mock.calls[1][0].orchestrator.reasoningEffort).toBe('low')
    topologySaves[1].resolve(setTopology.mock.calls[1][0])
    await flush()
    // Le menu montre le dernier choix enregistré.
    await ouvrirMenu('topology-modele-orchestrator')
    expect(
      document.body
        .querySelector('[data-testid="topology-modele-orchestrator-liste"] [aria-checked="true"]')
        ?.getAttribute('data-effort')
    ).toBe('low')
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('AgentsTopologyView concurrent persistence', () => {
  // Scout, Frame, Judges et Terrain n'ont plus de panneau : les skills lancent elles-mêmes leurs
  // sous-agents, l'utilisateur a demandé de retirer ces blocs. Restent les deux rôles du runtime.
  it('ne montre que Orchestrateur et Sous-agents, aucun panneau Scout, Frame, Judge ni Terrain', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    const targets = [...container.querySelectorAll('.topology-panel')].map((panel) =>
      panel.getAttribute('data-target')
    )
    expect(targets).toEqual(['orchestrator', 'subagents'])
    expect(container.querySelector('.topology-parallel-heading')).toBeNull()
    for (const titre of ['Scouts', 'Frame', 'Judges', 'Terrain']) {
      expect(container.querySelector('.topology-panel h3')?.textContent).not.toBe(titre)
      expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).not.toContain(titre)
    }
  })

  it('le menu de modèle ne propose que les modèles découverts', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => [
        {
          ...models[0],
          id: 'dynamic-gpt',
          model: 'dynamic-gpt',
          label: 'Dynamic GPT',
          dynamicallyLoaded: true
        },
        {
          ...models[0],
          id: 'declared-gemini',
          provider: 'gemini',
          model: 'declared-gemini',
          label: 'Declared Gemini',
          dynamicallyLoaded: false
        },
        {
          ...models[0],
          id: 'claude/opus',
          provider: 'claude',
          model: 'opus',
          label: 'Claude Opus alias',
          dynamicallyLoaded: false
        }
      ],
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'dynamic-gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    await ouvrirMenu('topology-modele-orchestrator')
    const lignes = [
      ...container.querySelectorAll('[data-testid="topology-modele-orchestrator-liste"] [data-row]')
    ].map((ligne) => ligne.getAttribute('data-row'))
    expect(lignes).toEqual(['openai:dynamic-gpt'])
  })

  it('affiche le rejet de saveProfile dans l’alerte, sans rejet non géré', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined,
      setTopology: vi.fn(),
      saveProfile: vi.fn(async () => {
        throw new Error('profil non enregistrable')
      })
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    // Le nom se saisit DANS l'application (plus de `window.prompt`, qui bloquait et restait
    // intestable) : ouvrir le champ, le remplir, puis enregistrer.
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-profile-new"]')!.click()
    )
    const champ = container.querySelector<HTMLInputElement>(
      '[data-testid="topology-profile-name"]'
    )!
    await act(async () => {
      saisir(champ, 'Profil A')
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-profile-save"]')!.click()
    )
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('profil non enregistrable')
    window.removeEventListener('unhandledrejection', onUnhandled)
    expect(unhandled).toEqual([])
  })

  it('affiche le rejet de applyProfile dans l’alerte, sans rejet non géré', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [{ id: 'p1', name: 'Profil A', updatedAt: '2026-01-01', topology }],
      onAppEvent: () => () => undefined,
      setTopology: vi.fn(),
      applyProfile: vi.fn(async () => {
        throw new Error('profil illisible')
      })
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Appliquer un profil"] [data-profile-id="p1"]'
        )!
        .click()
    )
    await flush()
    // Appliquer écrase la topologie : le clic sur la pastille ne suffit pas, il se confirme.
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-apply-yes"]')!.click()
    )
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('profil illisible')
    window.removeEventListener('unhandledrejection', onUnhandled)
    expect(unhandled).toEqual([])
  })

  it('serializes rapid edits and builds the second save from the first optimistic snapshot', async () => {
    const saves: Array<Deferred<typeof topology>> = []
    const setTopology = vi.fn((_next: typeof topology) => {
      const request = deferred<typeof topology>()
      saves.push(request)
      return request.promise
    })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined,
      setTopology
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    await choisirDansLeMenu('topology-modele-subagent-1', 'openai:gpt', 'medium')
    await choisirDansLeMenu('topology-modele-subagent-2', 'openai:gpt', 'low')

    expect(setTopology).toHaveBeenCalledTimes(1)
    saves[0].resolve(setTopology.mock.calls[0][0])
    await flush()

    expect(setTopology).toHaveBeenCalledTimes(2)
    expect(setTopology.mock.calls[1][0].subagents.map((slot) => slot.reasoningEffort)).toEqual([
      'medium',
      'low'
    ])

    saves[1].resolve(setTopology.mock.calls[1][0])
    await flush()
  })
})
