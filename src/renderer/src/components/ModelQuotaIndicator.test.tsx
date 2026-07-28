// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'

describe('indicateur de quotas modèles', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('affiche la marge agrégée puis tous les modèles dans le popover', async () => {
    const modelQuotas = vi.fn(async () => ({
      observedAt: '2026-07-24T01:00:00.000Z',
      summary: { remainingPercent: 28, status: 'warning' },
      models: [
        {
          modelId: 'claude/opus',
          model: 'opus',
          label: 'Claude Opus',
          provider: 'claude',
          shared: true,
          status: 'stale',
          source: 'Claude /usage',
          observedAt: '2026-07-23T22:00:00.000Z',
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 72,
              remainingPercent: 28,
              resetsAt: '2026-07-24T05:00:00.000Z'
            },
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 31,
              remainingPercent: 69
            }
          ]
        },
        {
          modelId: 'codex/terra',
          model: 'terra',
          label: 'GPT Terra',
          provider: 'codex',
          shared: false,
          status: 'unavailable',
          source: 'Codex local',
          windows: []
        }
      ]
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { modelQuotas }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ModelQuotaIndicator))
      await Promise.resolve()
    })

    const trigger = container.querySelector(
      '[data-testid="model-quota-trigger"]'
    ) as HTMLButtonElement
    expect(trigger.textContent).toContain('28')
    await act(async () => trigger.click())

    const popover = container.querySelector('[data-testid="model-quota-popover"]')
    expect(popover?.textContent).toContain('Claude Opus')
    expect(popover?.textContent).toContain('GPT Terra')
    expect(popover?.textContent).toContain('Quota partagé')
    expect(popover?.textContent).toContain('Non exposé')
    expect(popover?.textContent).toContain('72 % utilisé')
    expect(popover?.textContent).toContain('28 % restant')
    expect(popover?.textContent).toContain('Mesure ancienne')
    expect(popover?.textContent).toContain('reset non exposé')
    expect(
      popover
        ?.querySelector('button[aria-label="Actualiser les quotas"]')
        ?.getAttribute('aria-busy')
    ).toBe('false')
    expect(modelQuotas).toHaveBeenCalledTimes(2)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="model-quota-popover"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('ne reste pas en lecture lorsque le preload chargé ne fournit pas les quotas', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ModelQuotaIndicator))
    })

    const trigger = container.querySelector(
      '[data-testid="model-quota-trigger"]'
    ) as HTMLButtonElement
    await act(async () => trigger.click())

    const popover = container.querySelector('[data-testid="model-quota-popover"]')
    expect(popover?.textContent).toContain('Redémarrage requis')
    expect(popover?.textContent).not.toContain('Lecture en cours')
    await act(async () => root.unmount())
  })
})
