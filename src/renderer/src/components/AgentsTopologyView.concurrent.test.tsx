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
    defaultReasoningEffort: 'medium'
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

    const effort = container.querySelector<HTMLSelectElement>(
      '[data-target="orchestrator"] .topology-slot select'
    )
    expect(effort).not.toBeNull()

    await act(async () => {
      effort!.value = 'high'
      effort!.dispatchEvent(new Event('change', { bubbles: true }))
      effort!.value = 'low'
      effort!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setTopology).toHaveBeenCalledTimes(1)
    topologySaves[0].resolve(setTopology.mock.calls[0][0])
    await flush()

    expect(setTopology).toHaveBeenCalledTimes(2)
    expect(setTopology.mock.calls[1][0].orchestrator.reasoningEffort).toBe('low')
    topologySaves[1].resolve(setTopology.mock.calls[1][0])
    await flush()
    expect(effort!.value).toBe('low')
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('AgentsTopologyView concurrent persistence', () => {
  it('ordonne les quatre panels Scout, Frame, Terrain, Judge dans la grille 2×2', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    const targets = [...container.querySelectorAll('.topology-parallel > .topology-panel')].map(
      (panel) => panel.getAttribute('data-target')
    )
    expect(targets).toEqual(['scout', 'frame', 'terrain', 'judge'])
    expect(container.querySelector('[data-target="terrain"] h3')?.textContent).toBe('Terrain')
  })

  it('shows only dynamically loaded models in the Agent Studio library', async () => {
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
          label: 'Declared Gemini'
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

    const labels = [...container.querySelectorAll('.topology-models .topology-model strong')].map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['Dynamic GPT'])
  })

  it('trie la bibliothèque alphabétiquement par nom affiché', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => [
        {
          ...models[0],
          id: 'codex/gpt-5.6',
          provider: 'codex',
          model: 'gpt-5.6',
          label: 'Zulu 10',
          dynamicallyLoaded: true
        },
        {
          ...models[0],
          id: 'claude/fable-5',
          provider: 'claude',
          model: 'claude-fable-5',
          label: 'alpha 2',
          dynamicallyLoaded: true
        },
        {
          ...models[0],
          id: 'ollama/eclair-3',
          provider: 'ollama',
          model: 'eclair-3',
          label: 'Éclair 3',
          dynamicallyLoaded: true
        }
      ],
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'codex', model: 'gpt-5.6' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    const labels = [...container.querySelectorAll('.topology-models .topology-model strong')].map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['alpha 2', 'Éclair 3', 'Zulu 10'])
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

    const select = container.querySelector<HTMLSelectElement>('[aria-label="Appliquer un profil"]')!
    await act(async () => {
      select.value = 'p1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    // Appliquer écrase la topologie : le choix ne part plus au `change`, il se confirme.
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

    const efforts = container.querySelectorAll<HTMLSelectElement>(
      '[data-target="subagents"] .topology-slot select'
    )
    expect(efforts).toHaveLength(2)

    await act(async () => {
      efforts[0].value = 'high'
      efforts[0].dispatchEvent(new Event('change', { bubbles: true }))
      efforts[1].value = 'low'
      efforts[1].dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setTopology).toHaveBeenCalledTimes(1)
    saves[0].resolve(setTopology.mock.calls[0][0])
    await flush()

    expect(setTopology).toHaveBeenCalledTimes(2)
    expect(setTopology.mock.calls[1][0].subagents.map((slot) => slot.reasoningEffort)).toEqual([
      'high',
      'low'
    ])

    saves[1].resolve(setTopology.mock.calls[1][0])
    await flush()
  })
})
