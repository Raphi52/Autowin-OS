// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./OrchestratorModelSelector', () => ({
  OrchestratorModelSelector: () => createElement('div', { 'data-testid': 'model-selector' })
}))

import { RouterView } from './RouterView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('RouterView — erreurs provider locales', () => {
  it('affiche chaque erreur d’auth dans sa section sans empiéter sur Modèle par défaut', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        models: async () => [],
        providerStatus: async () =>
          ['claude', 'codex', 'kimi'].map((provider) => ({
            provider,
            status: 'absent',
            testable: true
          })),
        roles: async () => ({}),
        providerTest: vi.fn(),
        kimiLogin: vi.fn(),
        onAppEvent: vi.fn(() => () => undefined),
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    const defaultModel = container.querySelector<HTMLElement>('.router-default')!
    expect(defaultModel.textContent).not.toMatch(/introuvable|authentifier|reconnecter/i)

    for (const provider of ['claude', 'codex', 'kimi']) {
      const section = container.querySelector<HTMLElement>(`[data-provider="${provider}"]`)!
      expect(section.textContent).toMatch(/introuvable|authentifier|reconnecter/i)
    }
    expect(container.querySelector('[data-provider="kimi"]')?.textContent).toContain(
      'installer/authentifier Kimi'
    )
  })

  it('garde Kimi visible en standby sans test ni reconnexion automatique', async () => {
    const setProviderMode = vi.fn(async () => ({ mode: 'active' }))
    const providerTest = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        models: async () => [
          {
            id: 'kimi/kimi-code/kimi-for-coding',
            provider: 'kimi',
            model: 'kimi-for-coding',
            label: 'Kimi for Coding',
            reasoningEfforts: []
          }
        ],
        providerStatus: async () => [{ provider: 'kimi', status: 'standby', testable: false }],
        roles: async () => ({}),
        providerTest,
        providerLogin: vi.fn(),
        onAppEvent: vi.fn(() => () => undefined),
        setProviderMode,
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    const kimi = container.querySelector<HTMLElement>('[data-provider="kimi"]')!
    expect(kimi.textContent).toContain('Kimi for Coding')
    expect(kimi.textContent).toContain('En standby')
    expect(kimi.textContent).not.toContain('Tester')
    expect(kimi.textContent).not.toContain('Se reconnecter')
    expect(providerTest).not.toHaveBeenCalled()

    const reactivate = Array.from(kimi.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Réactiver')
    )
    await act(async () => reactivate?.click())
    expect(setProviderMode).toHaveBeenCalledWith('kimi', 'active')
  })

  it('présente un probe persisté comme un dernier test daté, pas comme un état courant', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        models: async () => [],
        providerStatus: async () => [
          {
            provider: 'claude',
            status: 'authenticated',
            testable: true,
            lastCheckedAt: Date.UTC(2026, 6, 23, 12, 0, 0)
          }
        ],
        roles: async () => ({}),
        setRole: vi.fn(),
        providerTest: vi.fn(),
        providerLogin: vi.fn(),
        onAppEvent: vi.fn(() => () => undefined),
        setProviderMode: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    expect(container.querySelector('.router-badge')?.textContent).toBe('Dernier test : Authentifié')
    expect(container.querySelector('[data-provider="claude"]')?.textContent).toContain('Tester')
  })

  it('recharge le catalogue quand Agent Studio redevient actif', async () => {
    let models = [
      {
        id: 'claude:sonnet',
        provider: 'claude',
        model: 'claude-sonnet',
        label: 'Claude Sonnet'
      }
    ]
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        models: vi.fn(async () => models),
        providerStatus: async () => [],
        roles: async () => ({}),
        providerTest: vi.fn(),
        providerLogin: vi.fn(),
        setProviderMode: vi.fn(),
        onAppEvent: vi.fn(() => () => undefined),
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView, { active: true })))
    await flush()
    expect(container.querySelector('[data-provider="claude"]')).not.toBeNull()

    models = [
      {
        id: 'ollama:qwen',
        provider: 'ollama',
        model: 'qwen',
        label: 'Qwen local'
      }
    ]
    await act(async () => root.render(createElement(RouterView, { active: false })))
    await act(async () => root.render(createElement(RouterView, { active: true })))
    await flush()

    expect(container.querySelector('[data-provider="claude"]')).toBeNull()
    expect(container.querySelector('[data-provider="ollama"]')).not.toBeNull()
  })

  it('ignore une ancienne réponse de catalogue qui termine après la plus récente', async () => {
    type Model = { id: string; provider: string; model: string; label: string }
    let appEvent: ((event: { type: string; scope?: string }) => void) | undefined
    const stale = deferred<Model[]>()
    const fresh = deferred<Model[]>()
    const models = vi
      .fn<() => Promise<Model[]>>()
      .mockResolvedValueOnce([
        { id: 'claude:sonnet', provider: 'claude', model: 'claude-sonnet', label: 'Claude' }
      ])
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        models,
        providerStatus: async () => [],
        roles: async () => ({}),
        providerTest: vi.fn(),
        providerLogin: vi.fn(),
        setProviderMode: vi.fn(),
        onAppEvent: vi.fn((listener) => {
          appEvent = listener
          return () => undefined
        }),
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(RouterView, { active: true })))
    await flush()

    act(() => appEvent?.({ type: 'refresh', scope: 'roles' }))
    act(() => appEvent?.({ type: 'refresh', scope: 'roles' }))
    await act(async () =>
      fresh.resolve([{ id: 'ollama:qwen', provider: 'ollama', model: 'qwen', label: 'Qwen local' }])
    )
    await act(async () =>
      stale.resolve([
        { id: 'claude:sonnet', provider: 'claude', model: 'claude-sonnet', label: 'Claude' }
      ])
    )
    await flush()

    expect(container.querySelector('[data-provider="claude"]')).toBeNull()
    expect(container.querySelector('[data-provider="ollama"]')).not.toBeNull()
  })
})
