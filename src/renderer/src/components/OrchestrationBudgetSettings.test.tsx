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
        orchestrationBudget: vi.fn().mockResolvedValue({ maxUsd: null }),
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

    const input = container.querySelector('input')
    const help = container.querySelector('#orchestration-budget-help')
    expect(input?.getAttribute('aria-describedby')).toBe('orchestration-budget-help')
    expect(help?.textContent).toContain('Champ vide = aucune limite de coût')
    expect(container.textContent).toContain('dollars américains (USD)')
  })
})
