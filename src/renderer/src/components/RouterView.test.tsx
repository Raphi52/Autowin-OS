// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./OrchestratorModelSelector', () => ({
  OrchestratorModelSelector: () => createElement('div', { 'data-testid': 'model-selector' })
}))

import { RouterView } from './RouterView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

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
})
