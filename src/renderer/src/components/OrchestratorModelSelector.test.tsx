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

  /**
   * Choisir un modèle par défaut sur un provider EXPIRÉ produit un échec au premier prompt : le
   * sélecteur ne recevait aucun statut, alors que Routage les avait déjà chargés.
   */
  it('affiche le statut du provider par option et refuse un provider expiré', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onSelect = vi.fn()

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
              reasoningEfforts: [],
              defaultReasoningEffort: 'none'
            }
          ],
          statuses: [{ provider: 'codex', status: 'expired' }],
          binding: null,
          pending: false,
          error: null,
          onSelect
        })
      )
    })

    const option = host.querySelector('[role="option"]') as HTMLButtonElement
    expect(option.textContent).toContain('Expiré')
    expect(option.getAttribute('aria-disabled')).toBe('true')
    await act(async () => option.click())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('un provider authentifié reste sélectionnable', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onSelect = vi.fn()

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
              reasoningEfforts: [],
              defaultReasoningEffort: 'none'
            }
          ],
          statuses: [{ provider: 'codex', status: 'authenticated' }],
          binding: null,
          pending: false,
          error: null,
          onSelect
        })
      )
    })

    const option = host.querySelector('[role="option"]') as HTMLButtonElement
    expect(option.getAttribute('aria-disabled')).not.toBe('true')
    await act(async () => option.click())
    expect(onSelect).toHaveBeenCalled()
  })
})
