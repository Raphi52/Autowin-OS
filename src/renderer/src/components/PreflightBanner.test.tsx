// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PreflightBanner } from './PreflightBanner'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

let container: HTMLDivElement
let root: Root
let emit: ((r: unknown) => void) | null = null

beforeEach(() => {
  emit = null
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    onPreflight: (cb: (r: unknown) => void) => {
      emit = cb
      return () => {}
    }
  }
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

function render(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(PreflightBanner)))
}

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

describe('PreflightBanner (#4)', () => {
  it('rien tant qu’aucun résultat', () => {
    render()
    expect(container.querySelector('[data-testid="preflight-banner"]')).toBeNull()
  })

  it('affiche les checks échoués quand la config est dégradée', () => {
    render()
    act(() =>
      emit?.({
        ok: false,
        summary: 'Configuration incomplète',
        checks: [
          { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' },
          { id: 'claude', label: 'CLI claude', ok: true }
        ]
      })
    )
    const banner = container.querySelector('[data-testid="preflight-banner"]')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('brain_server')
    expect(banner?.textContent).toContain('injoignable')
    expect(banner?.textContent).not.toContain('CLI claude') // check OK non listé
  })

  it('ne remonte pas une erreur provider au-dessus des vues métier', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      onPreflight: (cb: (r: unknown) => void) => {
        emit = cb
        return () => {}
      },
      getPreflight: async () => ({
        ok: false,
        summary: 'Configuration incomplète',
        checks: [
          {
            id: 'codex-session',
            label: 'Session OAuth Codex',
            ok: false,
            detail: 'session expirée'
          }
        ]
      })
    }

    render()
    await flush()

    expect(container.querySelector('[data-testid="preflight-banner"]')).toBeNull()
  })

  it('garde les erreurs globales dans la bannière sans y mélanger les providers', () => {
    render()
    act(() =>
      emit?.({
        ok: false,
        summary: 'Configuration incomplète',
        checks: [
          { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' },
          { id: 'kimi', label: 'CLI kimi', ok: false, detail: 'introuvable' }
        ]
      })
    )

    const banner = container.querySelector('[data-testid="preflight-banner"]')
    expect(banner?.textContent).toContain('brain_server')
    expect(banner?.textContent).not.toContain('CLI kimi')
  })

  it('ne rien afficher si tout est OK', () => {
    render()
    act(() => emit?.({ ok: true, summary: 'OK', checks: [] }))
    expect(container.querySelector('[data-testid="preflight-banner"]')).toBeNull()
  })
})
