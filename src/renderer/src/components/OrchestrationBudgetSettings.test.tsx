// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationBudgetSettings } from './OrchestrationBudgetSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

describe('OrchestrationBudgetSettings', () => {
  it('explique au champ vide que la limite de coût est désactivée', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        orchestrationBudget: vi.fn().mockResolvedValue({
          maxUsd: null,
          maxProviderCalls: 24,
          maxTotalTokens: 15_000_000
        }),
        setOrchestrationBudget: vi.fn()
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(createElement(OrchestrationBudgetSettings))
    })

    const inputs = [...container.querySelectorAll('input')]
    expect(inputs).toHaveLength(3)
    expect(inputs.map((input) => input.value)).toEqual(['24', '15000000', ''])
    expect(container.textContent).toContain('appels fournisseur')
    expect(container.textContent).toContain('tokens totaux')
    expect(container.textContent).toContain('optionnel')
    expect(container.textContent).toContain("usage final d'un appel")
  })
})
