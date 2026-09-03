// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsView } from './SettingsView'
import { THEME_MODE_STORAGE_KEY } from '../theme-mode'

vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))
vi.mock('./OrchestrationBudgetSettings', () => ({ OrchestrationBudgetSettings: () => null }))
vi.mock('./ShadowRoutingPilotSettings', () => ({ ShadowRoutingPilotSettings: () => null }))

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

async function monter(section: 'interface' | 'behaviour' = 'interface') {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(SettingsView, { active: true, section, onSectionChange: vi.fn() }))
  })
  return container
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

/**
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : retirer l'onglet Interface de Settings, ou débrancher
 * l'interrupteur du réglage — l'utilisateur aurait un bouton qui ne fait rien.
 */
describe('Settings · Interface', () => {
  it('propose un onglet Interface dans la barre de sections', async () => {
    const container = await monter('behaviour')
    const onglets = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(onglets).toContain('Interface')
  })

  it('bascule en clair, le mémorise et le pose sur la racine du document', async () => {
    const container = await monter()
    const interrupteur = container.querySelector<HTMLInputElement>(
      '[data-testid="interface-mode-clair"]'
    )
    expect(interrupteur).not.toBeNull()
    expect(interrupteur!.checked).toBe(false)

    // `click()` : React branche l'événement `change` d'une case à cocher sur le CLIC réel.
    await act(async () => interrupteur!.click())

    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')
  })

  it('revient au sombre quand on éteint l’interrupteur', async () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'clair')
    const container = await monter()
    const interrupteur = container.querySelector<HTMLInputElement>(
      '[data-testid="interface-mode-clair"]'
    )!
    expect(interrupteur.checked).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')

    await act(async () => interrupteur.click())

    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('sombre')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
