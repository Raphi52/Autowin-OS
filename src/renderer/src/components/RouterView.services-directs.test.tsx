// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./OrchestratorModelSelector', () => ({
  OrchestratorModelSelector: () => createElement('div')
}))

import { RouterView } from './RouterView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

// conv-1503 : les services du moteur direct ont leur carte, « Prêt » ou « Clé manquante (VARIABLE) ».
describe('RouterView — services du moteur direct', () => {
  it('montre la variable manquante, le statut prêt, et aucun bouton de connexion', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        models: async () => [],
        providerStatus: async () => [
          {
            provider: 'api-mistral',
            status: 'absent',
            testable: false,
            detail: 'Clé manquante (MISTRAL_API_KEY)'
          },
          { provider: 'api-cerebras', status: 'ready', testable: false }
        ],
        roles: async () => ({}),
        providerTest: vi.fn(),
        onAppEvent: vi.fn(() => () => undefined),
        setRole: vi.fn()
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(RouterView, {})))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const mistral = container.querySelector<HTMLElement>('[data-provider="api-mistral"]')!
    expect(mistral.textContent).toContain('Mistral')
    expect(mistral.textContent).not.toContain('(direct)')
    expect(
      container.querySelector('[data-testid="router-provider-detail-api-mistral"]')?.textContent
    ).toBe('Clé manquante (MISTRAL_API_KEY)')
    expect(mistral.querySelector('.router-reconnect')).toBeNull()

    const cerebras = container.querySelector<HTMLElement>('[data-provider="api-cerebras"]')!
    expect(cerebras.dataset.status).toBe('ready')
    expect(cerebras.querySelector('.router-badge.is-ready')?.textContent).toMatch(/Prêt|Ready/)
    expect(cerebras.querySelector('.router-reconnect')).toBeNull()
  })
})
