// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ROUTAGE VIT DANS SETTINGS — demande de conv-963 (2026-10-15) : « la view Routage il faut la mettre
 * dans Settings ». Elle était une section d'Agent Studio. Ce fichier verrouille le câblage : l'onglet
 * existe, il rend la vraie vue Routage, et il porte toujours l'alerte des providers à reconnecter
 * qu'il avait dans Agent Studio.
 */
vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))
vi.mock('./ExecutionWorkspaceSettings', () => ({ ExecutionWorkspaceSettings: () => null }))
vi.mock('./BrainSettings', () => ({ BrainSettings: () => null }))
vi.mock('./OrchestrationBudgetSettings', () => ({ OrchestrationBudgetSettings: () => null }))
// La vue Routage a ses propres tests : ici, seul compte qu'elle soit MONTÉE par la bonne section.
vi.mock('./RouterView', async () => {
  const { createElement } = await import('react')
  return {
    RouterView: ({ active }: { active?: boolean }) =>
      createElement('div', { 'data-testid': 'router-view-stub', 'data-active': String(active) })
  }
})

import { SettingsView } from './SettingsView'
import type { SettingsSection } from '../tabs'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function stub(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      getPreflight: vi.fn().mockResolvedValue(null),
      recheckPreflight: vi.fn(),
      onPreflight: () => () => {},
      providerStatus: vi.fn().mockResolvedValue([]),
      onAppEvent: vi.fn(() => vi.fn()),
      ...overrides
    }
  })
}

async function render(
  section: SettingsSection,
  props: { active?: boolean; onSectionChange?: (s: SettingsSection) => void } = {}
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SettingsView, {
        active: props.active ?? true,
        section,
        onSectionChange: props.onSectionChange ?? (() => undefined)
      })
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

const onglets = (): HTMLButtonElement[] => [
  ...container.querySelectorAll<HTMLButtonElement>('.domain-tabs button')
]

describe('Settings — l’onglet Routage', () => {
  it('affiche un onglet Routage, et cliquer dessus demande la section routing', async () => {
    stub()
    const onSectionChange = vi.fn()
    await render('budget', { onSectionChange })
    const onglet = onglets().find((b) => b.textContent?.trim().startsWith('Routage'))
    expect(onglet).toBeTruthy()
    await act(async () => onglet!.click())
    expect(onSectionChange).toHaveBeenCalledWith('routing')
  })

  it('la section routing monte la vue Routage, les autres non', async () => {
    stub()
    await render('routing')
    expect(
      container.querySelector('[data-testid="router-view-stub"]')?.getAttribute('data-active')
    ).toBe('true')
    await render('budget')
    expect(container.querySelector('[data-testid="router-view-stub"]')).toBeNull()
  })

  it('signale les providers expirés sur l’onglet Routage, depuis n’importe quelle section', async () => {
    stub({
      providerStatus: vi.fn().mockResolvedValue([
        { provider: 'codex', status: 'expired', testable: true },
        { provider: 'claude', status: 'authenticated', testable: true }
      ])
    })
    await render('budget')
    const badge = container.querySelector('[data-testid="settings-anomaly-routing"]')
    expect(badge?.textContent).toContain('1')
    expect(badge?.getAttribute('title')).toContain('codex')
  })

  it('rien à signaler quand tout est sain', async () => {
    stub({
      providerStatus: vi
        .fn()
        .mockResolvedValue([{ provider: 'claude', status: 'authenticated', testable: true }])
    })
    await render('budget')
    expect(container.querySelector('[data-testid="settings-anomaly-routing"]')).toBeNull()
  })

  it('ne sonde rien tant que Settings n’est pas ouvert', async () => {
    const providerStatus = vi.fn().mockResolvedValue([])
    stub({ providerStatus })
    await render('budget', { active: false })
    expect(providerStatus).not.toHaveBeenCalled()
  })

  it('rafraîchit l’alerte après une mutation des rôles (reconnexion)', async () => {
    const listeners: Array<(event: { type: string; scope?: string }) => void> = []
    stub({
      providerStatus: vi
        .fn()
        .mockResolvedValueOnce([{ provider: 'claude', status: 'expired', testable: true }])
        .mockResolvedValue([{ provider: 'claude', status: 'authenticated', testable: true }]),
      onAppEvent: vi.fn((listener) => {
        listeners.push(listener)
        return vi.fn()
      })
    })
    await render('budget')
    expect(container.querySelector('[data-testid="settings-anomaly-routing"]')).not.toBeNull()
    await act(async () => {
      for (const listener of listeners) listener({ type: 'refresh', scope: 'roles' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="settings-anomaly-routing"]')).toBeNull()
  })
})
