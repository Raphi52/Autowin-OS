// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ModelQuotaIndicator, modelesOpenRouter } from './ModelQuotaIndicator'

// conv-1490 : choisir OpenRouter et un de ses modèles depuis la popup des quotas.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const catalogue = [
  { id: 'claude/sonnet', provider: 'claude', model: 'sonnet', label: 'Sonnet' },
  {
    id: 'claude/openrouter/x/y:free',
    provider: 'claude',
    model: 'openrouter/x/y:free',
    label: 'Y (OpenRouter)'
  }
]
const q = (id: string): HTMLElement =>
  document.querySelector(`[data-testid="${id}"]`) as HTMLElement

describe('popup des quotas — OpenRouter', () => {
  it('isole les modèles OpenRouter par leur préfixe', () => {
    expect(modelesOpenRouter(catalogue).map((m) => m.model)).toEqual(['openrouter/x/y:free'])
  })

  it('montre la puce OpenRouter et choisit un modèle', async () => {
    const onSelect = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(ModelQuotaIndicator, { openRouter: { models: catalogue, onSelect } }))
    })
    await act(async () => q('model-quota-trigger').click())
    await act(async () => q('model-quota-provider-openrouter').click())
    const puce = q('model-quota-openrouter-openrouter/x/y:free')
    expect(puce.textContent).toBe('Y')
    await act(async () => puce.click())
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude', model: 'openrouter/x/y:free' })
    )
    await act(async () => root.unmount())
  })
})
