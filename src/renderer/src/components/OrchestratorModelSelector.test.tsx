// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'

describe('OrchestratorModelSelector', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('ferme le menu et son sous-menu au pointerdown extérieur', async () => {
    host = document.createElement('div')
    const outside = document.createElement('button')
    outside.textContent = 'Chat'
    document.body.append(host, outside)
    root = createRoot(host)

    await act(async () => {
      root?.render(
        createElement(OrchestratorModelSelector, {
          busy: false,
          catalogLoaded: true,
          models: [
            {
              id: 'codex:gpt',
              provider: 'codex',
              model: 'gpt',
              label: 'GPT',
              reasoningEfforts: ['medium', 'high'],
              defaultReasoningEffort: 'medium'
            }
          ],
          binding: { provider: 'codex', model: 'gpt', reasoningEffort: 'medium' },
          pending: false,
          error: null,
          onSelect: vi.fn()
        })
      )
    })

    const details = host.querySelector('details') as HTMLDetailsElement
    const option = host.querySelector('[role="option"]') as HTMLButtonElement
    details.open = true
    await act(async () => option.click())
    expect(details.open).toBe(true)
    expect(host.querySelector('.model-effort-menu')).not.toBeNull()

    await act(async () => {
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(details.open).toBe(false)
    expect(host.querySelector('.model-effort-menu')).toBeNull()
    outside.remove()
  })
})
