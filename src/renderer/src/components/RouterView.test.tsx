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
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView)))
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
        setProviderMode,
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView)))
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
            testable: false,
            lastCheckedAt: Date.UTC(2026, 6, 23, 12, 0, 0)
          }
        ],
        roles: async () => ({}),
        setRole: vi.fn(),
        providerTest: vi.fn(),
        providerLogin: vi.fn(),
        setProviderMode: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root.render(createElement(RouterView)))
    await flush()

    expect(container.querySelector('.router-badge')?.textContent).toBe('Dernier test : Authentifié')
  })
})
