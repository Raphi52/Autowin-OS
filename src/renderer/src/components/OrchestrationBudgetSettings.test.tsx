// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationBudgetSettings } from './OrchestrationBudgetSettings'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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

describe('OrchestrationBudgetSettings — échec de chargement', () => {
  it('affiche un état d échec, désactive Enregistrer et permet de réessayer', async () => {
    const orchestrationBudget = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ maxUsd: null, maxProviderCalls: 24, maxTotalTokens: 15_000_000 })
    const setOrchestrationBudget = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { orchestrationBudget, setOrchestrationBudget }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(createElement(OrchestrationBudgetSettings))
    })

    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Enregistrer'
    ) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Réessayer'
    ) as HTMLButtonElement
    expect(retry).toBeTruthy()

    await act(async () => {
      retry.click()
    })
    expect(orchestrationBudget).toHaveBeenCalledTimes(2)
    expect([...container.querySelectorAll('input')].map((input) => input.value)).toEqual([
      '24',
      '15000000',
      ''
    ])
    const saveAfter = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Enregistrer'
    ) as HTMLButtonElement
    expect(saveAfter.disabled).toBe(false)
    expect(setOrchestrationBudget).not.toHaveBeenCalled()
  })

  it('n écrase pas une saisie en cours lors d un rechargement, mais l applique après un save réussi', async () => {
    const orchestrationBudget = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ maxUsd: null, maxProviderCalls: 24, maxTotalTokens: 15_000_000 })
    const setOrchestrationBudget = vi
      .fn()
      .mockResolvedValue({ maxUsd: null, maxProviderCalls: 12, maxTotalTokens: 7 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { orchestrationBudget, setOrchestrationBudget }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(createElement(OrchestrationBudgetSettings))
    })
    const inputs = [...container.querySelectorAll('input')]
    // Le setter du prototype contourne le value-tracker de React (pattern déjà utilisé côté repo).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(inputs[0], '12')
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      setter?.call(inputs[1], '7')
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Réessayer'
    ) as HTMLButtonElement
    await act(async () => {
      retry.click()
    })
    expect([...container.querySelectorAll('input')][0].value).toBe('12')

    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Enregistrer'
    ) as HTMLButtonElement
    await act(async () => {
      save.click()
    })
    expect(setOrchestrationBudget).toHaveBeenCalledWith({
      maxProviderCalls: 12,
      maxTotalTokens: 7,
      maxUsd: null
    })
  })

  it('rend les textes utilisateur avec leurs accents', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        orchestrationBudget: vi
          .fn()
          .mockResolvedValue({ maxUsd: null, maxProviderCalls: 24, maxTotalTokens: 15_000_000 }),
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
    const text = container.textContent ?? ''
    expect(text).toContain("Budget d'orchestration")
    expect(text).toContain("Maximum d'appels fournisseur")
    expect(text).toContain('refusé')
    expect(text).toContain('dépassement')
    expect(text).toContain('même')
    expect(text).toContain('coût')
    expect(text).not.toContain('d appels')
    expect(text).not.toContain('complexite')
  })
})
