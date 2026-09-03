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

  it('affiche la marge agrégée puis les fournisseurs dans le popover', async () => {
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
    // Piste B : le declencheur est la BARRE (plus aucune roue SVG), et le remplissage suit le restant.
    expect(trigger.querySelector('svg')).toBeNull()
    const barre = trigger.querySelector('.model-quota-bar-fill') as HTMLElement
    expect(barre).not.toBeNull()
    expect(trigger.style.getPropertyValue('--quota-fill')).toBe('28%')
    // Et c'est bien un clic sur cette barre qui ouvre la popup.
    expect(container.querySelector('[data-testid="model-quota-popover"]')).toBeNull()
    await act(async () => barre.click())

    const popover = container.querySelector('[data-testid="model-quota-popover"]')
    expect(popover?.textContent).toContain('Claude')
    expect(popover?.textContent).toContain('ChatGPT')
    expect(popover?.textContent).not.toContain('Claude Opus')
    expect(popover?.textContent).not.toContain('GPT Terra')
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
    expect(modelQuotas).toHaveBeenLastCalledWith(true)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="model-quota-popover"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('affiche une seule ligne par fournisseur lorsque plusieurs modèles partagent le quota', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const modelQuotas = vi.fn(async () => ({
      observedAt: '2026-07-28T12:00:00.000Z',
      summary: { remainingPercent: 98, status: 'healthy' as const },
      models: [
        {
          modelId: 'codex/terra',
          model: 'terra',
          label: 'GPT Terra',
          provider: 'codex',
          shared: true,
          status: 'available' as const,
          source: 'Codex local',
          windows: [
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 2,
              remainingPercent: 98,
              modelFamily: 'terra'
            }
          ]
        },
        {
          modelId: 'codex/sol',
          model: 'sol',
          label: 'GPT Sol',
          provider: 'codex',
          shared: true,
          status: 'available' as const,
          source: 'Codex local',
          windows: [
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 3,
              remainingPercent: 97,
              modelFamily: 'sol'
            }
          ]
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

    await act(async () => {
      ;(container.querySelector('[data-testid="model-quota-trigger"]') as HTMLButtonElement).click()
    })

    const popover = container.querySelector('[data-testid="model-quota-popover"]')
    expect(popover?.querySelectorAll('.model-quota-row')).toHaveLength(1)
    expect(popover?.querySelectorAll('.model-quota-window')).toHaveLength(2)
    expect(popover?.textContent).toContain('ChatGPT')
    expect(popover?.textContent).not.toContain('GPT Terra')
    expect(popover?.textContent).not.toContain('GPT Sol')
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Encountered two children with the same key'
    )
    await act(async () => root.unmount())
  })

  it('actualise automatiquement le rond chaque minute', async () => {
    vi.useFakeTimers()
    const modelQuotas = vi.fn(async () => ({
      observedAt: '2026-07-28T10:00:00.000Z',
      summary: { remainingPercent: 0, status: 'critical' as const },
      models: []
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
    expect(modelQuotas).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(modelQuotas).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="model-quota-trigger"]')?.textContent).toContain(
      '0'
    )
    await act(async () => root.unmount())
    vi.useRealTimers()
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

  it('sort de l’erreur lorsque le provider répond au rafraîchissement suivant', async () => {
    const snapshot = {
      observedAt: '2026-07-28T10:00:00.000Z',
      summary: { remainingPercent: 64, status: 'healthy' as const },
      models: [
        {
          modelId: 'codex/terra',
          model: 'terra',
          label: 'GPT Terra',
          provider: 'codex',
          shared: false,
          status: 'available' as const,
          source: 'Codex local',
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 36,
              remainingPercent: 64
            }
          ]
        }
      ]
    }
    const modelQuotas = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider temporairement indisponible'))
      .mockRejectedValueOnce(new Error('Provider temporairement indisponible'))
      .mockResolvedValue(snapshot)
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
    await act(async () => trigger.click())

    const popover = container.querySelector('[data-testid="model-quota-popover"]')
    expect(popover?.textContent).toContain('Indisponible')
    expect(popover?.textContent).toContain('Provider temporairement indisponible')
    expect(popover?.textContent).not.toContain('Lecture en cours')
    const refresh = popover?.querySelector(
      'button[aria-label="Actualiser les quotas"]'
    ) as HTMLButtonElement
    expect(refresh.getAttribute('aria-busy')).toBe('false')

    await act(async () => refresh.click())
    expect(popover?.textContent).toContain('Actualisé')
    expect(popover?.textContent).toContain('ChatGPT')
    expect(popover?.querySelector('.model-quota-error')).toBeNull()
    expect(modelQuotas).toHaveBeenCalledTimes(3)
    await act(async () => root.unmount())
  })

  it('ignore une ancienne réponse arrivée après un rafraîchissement plus récent', async () => {
    let resolveInitial!: (value: unknown) => void
    let resolveRefresh!: (value: unknown) => void
    const initial = new Promise((resolve) => {
      resolveInitial = resolve
    })
    const refresh = new Promise((resolve) => {
      resolveRefresh = resolve
    })
    const modelQuotas = vi.fn().mockReturnValueOnce(initial).mockReturnValueOnce(refresh)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { modelQuotas }
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

    await act(async () => {
      resolveRefresh({
        observedAt: '2026-07-28T10:02:00.000Z',
        summary: { remainingPercent: 0, status: 'critical' },
        models: []
      })
      await Promise.resolve()
    })
    expect(trigger.textContent).toContain('0')

    await act(async () => {
      resolveInitial({
        observedAt: '2026-07-28T10:01:00.000Z',
        summary: { remainingPercent: 89, status: 'healthy' },
        models: []
      })
      await Promise.resolve()
    })
    expect(trigger.textContent).toContain('0')
    expect(trigger.textContent).not.toContain('89')
    await act(async () => root.unmount())
  })

  it('met à jour la barre lorsque le fournisseur du modèle sélectionné change', async () => {
    const modelQuotas = vi.fn(async () => ({
      observedAt: '2026-07-29T08:00:00.000Z',
      summary: { remainingPercent: 25, status: 'warning' as const },
      models: [
        {
          modelId: 'claude/opus',
          model: 'opus',
          label: 'Claude Opus',
          provider: 'claude',
          shared: false,
          status: 'available' as const,
          source: 'Claude /usage',
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 75,
              remainingPercent: 25
            }
          ]
        },
        {
          modelId: 'codex/terra',
          model: 'terra',
          label: 'GPT Terra',
          provider: 'codex',
          shared: false,
          status: 'available' as const,
          source: 'Codex /usage',
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 30,
              remainingPercent: 70
            }
          ]
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
      root.render(createElement(ModelQuotaIndicator, { provider: 'claude' }))
      await Promise.resolve()
    })
    const trigger = container.querySelector(
      '[data-testid="model-quota-trigger"]'
    ) as HTMLButtonElement
    expect(trigger.textContent).toContain('25')

    await act(async () => {
      root.render(createElement(ModelQuotaIndicator, { provider: 'codex' }))
    })
    expect(trigger.textContent).toContain('70')
    expect(modelQuotas).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })
})
