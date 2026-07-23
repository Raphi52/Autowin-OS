// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunWizard } from './FirstRunWizard'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

let container: HTMLDivElement
let root: Root
let outsideButton: HTMLButtonElement | null

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
  outsideButton?.remove()
  outsideButton = null
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
  it('s’affiche quand une dépendance est ROUGE et liste les checks détectés', async () => {
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="frw-check-brain"]')?.className).toContain('ko')
    expect(container.querySelector('[data-testid="frw-check-claude"]')?.className).toContain('ok')
    expect(container.textContent).toContain('injoignable')
  })

  it('ne s’affiche PAS si TOUT est vert (visibilité pilotée par l’état)', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({
        ok: true,
        summary: 'OK',
        checks: [{ id: 'claude', label: 'CLI claude', ok: true }]
      })
    }
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('se referme tout seul si l’état repasse au vert (push onPreflight)', async () => {
    let pushed: ((r: unknown) => void) | undefined
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({
        ok: false,
        summary: 'incomplète',
        checks: [{ id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' }]
      }),
      onPreflight: (cb: (r: unknown) => void) => {
        pushed = cb
        return () => undefined
      }
    }
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeTruthy()
    await act(async () => {
      pushed?.({ ok: true, summary: 'OK', checks: [{ id: 'brain', label: 'brain_server (:8765)', ok: true }] })
    })
    await flush()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('"Continuer quand même" ferme le wizard (dismiss de session, sans persistance)', async () => {
    await render()
    const primary = container.querySelector<HTMLButtonElement>('.frw-primary')!
    await act(async () => primary.click())
    expect(localStorage.getItem('autowin:first-run-done')).toBeNull()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('affiche une erreur de diagnostic puis, au 2e essai (encore rouge), l’efface en restant ouvert', async () => {
    const recheckPreflight = vi
      .fn()
      .mockRejectedValueOnce(new Error('IPC indisponible'))
      .mockResolvedValueOnce({
        ok: false,
        summary: 'incomplète',
        checks: [
          { id: 'codex-session', label: 'Session OAuth Codex', ok: true },
          { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' }
        ]
      })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { recheckPreflight }

    await render()
    expect(container.textContent).toMatch(/diagnostic.*échoué/i)
    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      /réessayer/i.test(button.textContent ?? '')
    )
    expect(retry).toBeTruthy()

    await act(async () => retry?.click())
    await flush()
    expect(container.querySelector('[data-testid="frw-check-codex-session"]')?.className).toContain(
      'ok'
    )
    expect(container.textContent).not.toMatch(/diagnostic.*échoué/i)
  })

  it('porte un nom accessible et place le focus sur sa première action', async () => {
    outsideButton = document.createElement('button')
    document.body.appendChild(outsideButton)
    outsideButton.focus()

    await render()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(container.querySelector(`#${titleId}`)?.textContent).toContain('Bienvenue')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.textContent).toContain('Re-vérifier')
  })

  it('piège Tab et Shift+Tab entre les actions de la modale', async () => {
    await render()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
    const first = buttons[0]
    const last = buttons.at(-1)!

    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(first)

    first.focus()
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    )
    expect(document.activeElement).toBe(last)
  })

  it('restaure le focus précédent à la fermeture', async () => {
    outsideButton = document.createElement('button')
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    await render()

    const finish = container.querySelector<HTMLButtonElement>('.frw-primary')!
    await act(async () => finish.click())

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(outsideButton)
  })
})
