// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PreflightBanner } from './PreflightBanner'

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

  it('ne rien afficher si tout est OK', () => {
    render()
    act(() => emit?.({ ok: true, summary: 'OK', checks: [] }))
    expect(container.querySelector('[data-testid="preflight-banner"]')).toBeNull()
  })
})
