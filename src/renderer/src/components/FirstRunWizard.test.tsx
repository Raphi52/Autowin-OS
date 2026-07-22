// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FirstRunWizard } from './FirstRunWizard'

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

beforeEach(() => {
  localStorage.clear()
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    recheckPreflight: async () => ({
      ok: false,
      summary: 'incomplète',
      checks: [
        { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' },
        { id: 'claude', label: 'CLI claude', ok: true }
      ]
    })
  }
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

async function render(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(FirstRunWizard))
  })
  await flush()
}

describe('FirstRunWizard (#5)', () => {
  it('s’affiche au 1er lancement et liste les checks détectés', async () => {
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="frw-check-brain"]')?.className).toContain('ko')
    expect(container.querySelector('[data-testid="frw-check-claude"]')?.className).toContain('ok')
    expect(container.textContent).toContain('injoignable')
  })

  it('ne s’affiche PAS si le first-run est déjà terminé', async () => {
    localStorage.setItem('autowin:first-run-done', '1')
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('"Continuer quand même" ferme le wizard et pose le drapeau', async () => {
    await render()
    const primary = container.querySelector<HTMLButtonElement>('.frw-primary')!
    await act(async () => primary.click())
    expect(localStorage.getItem('autowin:first-run-done')).toBe('1')
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })
})
