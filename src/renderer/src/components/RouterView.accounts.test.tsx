// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RouterView } from './RouterView'

vi.mock('./OrchestratorModelSelector', () => ({
  OrchestratorModelSelector: (): null => null
}))

/** Multi-comptes Claude côté Routage : lister, basculer en un clic, ajouter, retirer. */

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let container: HTMLDivElement
let root: Root

function mountWith(api: Record<string, unknown>): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      models: async () => [
        {
          id: 'claude/claude-opus-5',
          provider: 'claude',
          model: 'claude-opus-5',
          label: 'Claude Opus 5',
          dynamicallyLoaded: true,
          reasoningEfforts: []
        }
      ],
      providerStatus: async () => [
        { provider: 'claude', status: 'authenticated', testable: true }
      ],
      roles: async () => ({}),
      providerTest: vi.fn(),
      providerLogin: vi.fn(),
      onAppEvent: vi.fn(() => () => undefined),
      setProviderMode: vi.fn(),
      setRole: vi.fn(),
      ...api
    }
  })
}

const chips = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('.router-account-chip'))

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('RouterView — comptes Claude', () => {
  it('affiche les comptes et marque l’actif', async () => {
    mountWith({
      claudeAccounts: async () => ({
        activeId: 'default',
        accounts: [
          { id: 'default', displayName: 'raphael.vilain@amitel.fr', tier: 'team', active: true },
          { id: 'compte-2', displayName: 'perso@gmail.com', tier: 'max', active: false }
        ]
      })
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    expect(chips().map((chip) => chip.textContent)).toEqual([
      'raphael.vilain@amitel.frteam',
      'perso@gmail.commax'
    ])
    // L'actif est signalé ET non cliquable : rebasculer sur soi-même ne doit rien déclencher.
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true')
    expect(chips()[0].disabled).toBe(true)
    expect(chips()[1].disabled).toBe(false)
  })

  it('bascule en UN clic et recharge les statuts (le badge d’auth ne doit pas rester périmé)', async () => {
    const claudeAccountSwitch = vi.fn(async () => ({
      activeId: 'compte-2',
      accounts: [
        { id: 'default', displayName: 'pro@amitel.fr', tier: 'team', active: false },
        { id: 'compte-2', displayName: 'perso@gmail.com', tier: 'max', active: true }
      ]
    }))
    const providerStatus = vi.fn(async () => [
      { provider: 'claude', status: 'authenticated', testable: true }
    ])
    mountWith({
      providerStatus,
      claudeAccounts: async () => ({
        activeId: 'default',
        accounts: [
          { id: 'default', displayName: 'pro@amitel.fr', tier: 'team', active: true },
          { id: 'compte-2', displayName: 'perso@gmail.com', tier: 'max', active: false }
        ]
      }),
      claudeAccountSwitch
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    const callsBefore = providerStatus.mock.calls.length
    await act(async () => {
      chips()[1].click()
    })
    await flush()

    expect(claudeAccountSwitch).toHaveBeenCalledWith('compte-2')
    expect(chips()[1].getAttribute('aria-pressed')).toBe('true')
    expect(chips()[0].disabled).toBe(false)
    // Changer de compte change l'identité du CLI : les statuts sont re-sollicités.
    expect(providerStatus.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('ajoute un compte (le login dédié est déclenché côté principal)', async () => {
    const claudeAccountAdd = vi.fn(async () => ({
      activeId: 'default',
      accounts: [
        { id: 'default', displayName: 'pro@amitel.fr', tier: 'team', active: true },
        { id: 'compte-2', displayName: 'compte-2', tier: '', active: false }
      ]
    }))
    mountWith({
      claudeAccounts: async () => ({
        activeId: 'default',
        accounts: [{ id: 'default', displayName: 'pro@amitel.fr', tier: 'team', active: true }]
      }),
      claudeAccountAdd
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    expect(chips()).toHaveLength(1)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.router-account-add')!.click()
    })
    await flush()

    expect(claudeAccountAdd).toHaveBeenCalled()
    expect(chips()).toHaveLength(2)
  })

  it('n’offre pas de retirer le compte par défaut — c’est le seul repli', async () => {
    mountWith({
      claudeAccounts: async () => ({
        activeId: 'default',
        accounts: [
          { id: 'default', displayName: 'pro@amitel.fr', tier: 'team', active: true },
          { id: 'compte-2', displayName: 'perso@gmail.com', tier: 'max', active: false }
        ]
      })
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    const removes = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.router-account-remove')
    )
    expect(removes).toHaveLength(1)
    expect(removes[0].getAttribute('aria-label')).toContain('perso@gmail.com')
  })

  it('une IPC en échec laisse la liste précédente au lieu de vider l’écran', async () => {
    mountWith({
      claudeAccounts: async () => ({
        activeId: 'default',
        accounts: [
          { id: 'default', displayName: 'pro@amitel.fr', tier: 'team', active: true },
          { id: 'compte-2', displayName: 'perso@gmail.com', tier: 'max', active: false }
        ]
      }),
      claudeAccountSwitch: async () => {
        throw new Error('IPC morte')
      }
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()
    await act(async () => {
      chips()[1].click()
    })
    await flush()

    expect(chips()).toHaveLength(2)
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('ne montre aucun bloc comptes pour un provider autre que Claude', async () => {
    mountWith({
      models: async () => [],
      providerStatus: async () => [{ provider: 'codex', status: 'authenticated', testable: true }],
      claudeAccounts: async () => ({ activeId: 'default', accounts: [] })
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    expect(container.querySelector('[data-provider="codex"] .router-accounts')).toBeNull()
  })

  it('deux comptes de MÊME email restent distinguables par leur niveau', async () => {
    mountWith({
      claudeAccounts: async () => ({
        activeId: 'default',
        accounts: [
          {
            id: 'default',
            displayName: 'raphael.vilain@amitel.fr',
            tier: 'team',
            active: true
          },
          {
            id: 'compte-2',
            displayName: 'raphael.vilain@amitel.fr',
            tier: 'max',
            active: false
          }
        ]
      })
    })
    await act(async () => root.render(createElement(RouterView, {})))
    await flush()

    const tiers = Array.from(
      container.querySelectorAll<HTMLElement>('.router-account-tier')
    ).map((node) => node.textContent)
    expect(tiers).toEqual(['team', 'max'])
    // Le nom seul ne suffit plus a les separer : c'est bien la pastille qui porte la distinction.
    expect(chips()[0].textContent).not.toBe(chips()[1].textContent)
  })
})
