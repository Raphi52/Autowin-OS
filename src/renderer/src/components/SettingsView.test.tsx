// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))
vi.mock('./OrchestrationBudgetSettings', async () => {
  const { createElement } = await import('react')
  return {
    OrchestrationBudgetSettings: () => createElement('div', { 'data-testid': 'budget-panel' })
  }
})

import { SettingsView } from './SettingsView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

describe('SettingsView diagnostic', () => {
  it('relance le preflight forcé et rend son résultat', async () => {
    const recheckPreflight = vi.fn().mockResolvedValue({
      ok: true,
      summary: 'Tous les prérequis sont OK.',
      checks: [
        {
          id: 'codex-session',
          label: 'Session OAuth Codex',
          ok: true
        }
      ]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { recheckPreflight }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'preflight',
          onSectionChange: vi.fn()
        })
      )
    })
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Relancer')
    )
    await act(async () => button?.click())

    expect(recheckPreflight).toHaveBeenCalledWith(true)
    expect(container.textContent).toContain('Session OAuth Codex')
    expect(container.querySelector('.settings-preflight-list li')?.className).toContain('is-ok')
  })

  it('hydrate les checks au montage sans clic (getPreflight)', async () => {
    const getPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false, detail: 'Lancer brain_server.' }]
    })
    const recheckPreflight = vi.fn()
    const off = vi.fn()
    const onPreflight = vi.fn().mockReturnValue(off)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { getPreflight, recheckPreflight, onPreflight }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'preflight',
          onSectionChange: vi.fn()
        })
      )
    })

    expect(getPreflight).toHaveBeenCalled()
    expect(recheckPreflight).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Brain server')
    expect(container.textContent).toContain('Lancer brain_server.')
    expect(onPreflight).toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
    expect(off).toHaveBeenCalled()
  })

  it('répare un check en échec puis relance un recheck', async () => {
    const getPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false, detail: 'Lancer brain_server.' }]
    })
    const repairPreflight = vi.fn().mockResolvedValue({ started: true, detail: 'Lancé.' })
    const recheckPreflight = vi.fn().mockResolvedValue({
      ok: true,
      summary: 'Tous les prérequis sont OK.',
      checks: [{ id: 'brain', label: 'Brain server', ok: true }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { getPreflight, recheckPreflight, repairPreflight, onPreflight: () => () => {} }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'preflight',
          onSectionChange: vi.fn()
        })
      )
    })
    const repairButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Réparer'
    )
    expect(repairButton).toBeTruthy()
    await act(async () => repairButton?.click())

    expect(repairPreflight).toHaveBeenCalledWith('brain')
    expect(recheckPreflight).toHaveBeenCalledWith(true)
  })

  it("conserve l'erreur de réparation malgré le recheck qui suit", async () => {
    const getPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false }]
    })
    const repairPreflight = vi.fn().mockRejectedValue(new Error('boom'))
    const recheckPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { getPreflight, recheckPreflight, repairPreflight, onPreflight: () => () => {} }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'preflight',
          onSectionChange: vi.fn()
        })
      )
    })
    const repairButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Réparer'
    )
    await act(async () => repairButton?.click())

    expect(recheckPreflight).toHaveBeenCalledWith(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'La réparation a échoué'
    )
  })

  it('badge le tab Diagnostic quand un prérequis est en échec, même hors section preflight', async () => {
    const getPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getPreflight,
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, { active: true, section: 'budget', onSectionChange: vi.fn() })
      )
    })

    expect(getPreflight).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="settings-preflight-alert"]')).toBeTruthy()
  })

  it('liste les providers en lecture seule depuis providerStatus', async () => {
    const providerStatus = vi.fn().mockResolvedValue([
      { provider: 'codex', status: 'authenticated', testable: false },
      { provider: 'claude', status: 'installed-untested', testable: true }
    ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providerStatus,
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'providers',
          onSectionChange: vi.fn()
        })
      )
    })

    expect(providerStatus).toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="settings-provider-codex"]')?.textContent
    ).toContain('authenticated')
    // Aucun provider INVENTÉ : la liste est dérivée de l'état réellement exposé par l'app.
    expect(container.querySelector('[data-testid="settings-provider-kimi"]')).toBeNull()
    expect(container.querySelector('[data-testid="settings-provider-gemini"]')).toBeNull()
    expect(container.textContent).not.toContain('non configuré')
  })

  it('permet de réessayer la lecture des providers après un échec', async () => {
    const providerStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{ provider: 'kimi', status: 'authenticated' }])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providerStatus,
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'providers',
          onSectionChange: vi.fn()
        })
      )
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('providers')
    const retry = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Réessayer'
    ) as HTMLButtonElement
    expect(retry).toBeTruthy()
    await act(async () => retry.click())

    expect(providerStatus).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="settings-provider-kimi"]')).toBeTruthy()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('recharge les providers à chaque entrée dans la section', async () => {
    const providerStatus = vi.fn().mockResolvedValue([{ provider: 'codex', status: 'ok' }])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providerStatus,
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    const render = async (section: 'providers' | 'budget'): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(SettingsView, { active: true, section, onSectionChange: vi.fn() })
        )
      })
    }
    await render('providers')
    await render('budget')
    await render('providers')
    expect(providerStatus).toHaveBeenCalledTimes(2)
  })

  it('rend le renvoi vers le Routeur cliquable', async () => {
    const onOpenRouter = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providerStatus: vi.fn().mockResolvedValue([]),
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'providers',
          onSectionChange: vi.fn(),
          onOpenRouter
        })
      )
    })
    const link = container.querySelector(
      '[data-testid="settings-open-router"]'
    ) as HTMLButtonElement
    expect(link).toBeTruthy()
    await act(async () => link.click())
    expect(onOpenRouter).toHaveBeenCalled()
  })

  it('annonce le succès de la réparation et ne laisse pas l erreur orpheline au changement de section', async () => {
    const getPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false }]
    })
    const repairPreflight = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
      started: true
    })
    const recheckPreflight = vi.fn().mockResolvedValue({
      ok: false,
      summary: 'Un prérequis manque.',
      checks: [{ id: 'brain', label: 'Brain server', ok: false }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getPreflight,
        recheckPreflight,
        repairPreflight,
        providerStatus: vi.fn().mockResolvedValue([]),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    const render = async (section: 'preflight' | 'providers'): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(SettingsView, { active: true, section, onSectionChange: vi.fn() })
        )
      })
    }
    await render('preflight')
    const click = async (): Promise<void> => {
      const repairButton = [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Réparer'
      ) as HTMLButtonElement
      await act(async () => repairButton.click())
    }
    await click()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'La réparation a échoué'
    )

    // Changer de section ne laisse pas l'erreur globale orpheline.
    await render('providers')
    expect(container.querySelector('[role="alert"]')).toBeNull()

    await render('preflight')
    await click()
    expect(
      container.querySelector('[data-testid="settings-repair-status"]')?.getAttribute('role')
    ).toBe('status')
    expect(container.querySelector('[data-testid="settings-repair-status"]')?.textContent).toMatch(
      /répar/i
    )
  })

  it('affiche un etat de chargement sans inventer des providers non configures', async () => {
    const providerStatus = vi.fn(() => new Promise<never>(() => {}))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providerStatus,
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'providers',
          onSectionChange: vi.fn()
        })
      )
    })

    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/chargement/i)
    expect(container.textContent).not.toContain('non configuré')
  })

  it('rend une alerte quand le recheck échoue', async () => {
    const recheckPreflight = vi.fn().mockRejectedValue(new Error('boom'))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight,
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'preflight',
          onSectionChange: vi.fn()
        })
      )
    })
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Relancer')
    ) as HTMLButtonElement | undefined
    await act(async () => button?.click())

    expect(container.querySelector('[role="alert"]')).toBeTruthy()
    expect(button?.disabled).toBe(false)
  })

  it('expose le réglage de budget', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    await act(async () => {
      root.render(
        createElement(SettingsView, { active: true, section: 'budget', onSectionChange: vi.fn() })
      )
    })
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Budget')
    ).toBe(true)
    expect(container.querySelector('[data-testid="budget-panel"]')).toBeTruthy()
  })
})
