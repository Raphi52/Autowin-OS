// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))
// Panneau autonome (ses propres tests) : neutralise ici pour que les assertions de cette suite
// portent bien sur le panneau Diagnostic et non sur le voisin.
vi.mock('./ExecutionWorkspaceSettings', () => ({ ExecutionWorkspaceSettings: () => null }))
vi.mock('./BrainSettings', () => ({ BrainSettings: () => null }))
// L'alerte de l'onglet Routage a sa sonde a elle (`useProvidersAReconnecter`, couverte par
// `SettingsView.routage.test.tsx`) : neutralisee ici, sinon elle consommerait les reponses de
// `providerStatus` que cette suite reserve a la section Providers.
vi.mock('./useProvidersAReconnecter', () => ({ useProvidersAReconnecter: () => [] }))
// Les deux panneaux qui vivaient sous l'onglet Budget, retiré le 2026-10-23 (conv-1119) : des
// témoins, pour vérifier qu'ils sont montés par la section qui les reçoit désormais.
vi.mock('./RouterView', () => ({ RouterView: () => null }))
vi.mock('./ModeAutoSeuilsSettings', async () => {
  const { createElement } = await import('react')
  return {
    ModeAutoSeuilsSettings: () => createElement('div', { 'data-testid': 'mode-auto-seuils-stub' })
  }
})
vi.mock('./ShadowRoutingPilotSettings', async () => {
  const { createElement } = await import('react')
  return {
    ShadowRoutingPilotSettings: () => createElement('div', { 'data-testid': 'shadow-pilot-stub' })
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
        createElement(SettingsView, {
          active: true,
          section: 'behaviour',
          onSectionChange: vi.fn()
        })
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
    const render = async (section: 'providers' | 'behaviour'): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(SettingsView, { active: true, section, onSectionChange: vi.fn() })
        )
      })
    }
    await render('providers')
    await render('behaviour')
    await render('providers')
    expect(providerStatus).toHaveBeenCalledTimes(2)
  })

  it('rend le renvoi vers Routage cliquable : il ouvre l’onglet Routage de Settings', async () => {
    const onSectionChange = vi.fn()
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
          onSectionChange
        })
      )
    })
    const link = container.querySelector(
      '[data-testid="settings-open-router"]'
    ) as HTMLButtonElement
    expect(link).toBeTruthy()
    await act(async () => link.click())
    expect(onSectionChange).toHaveBeenCalledWith('routing')
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

  /*
   * DEMANDE UTILISATEUR (conv-1119, 2026-10-23) : « enlève budget dans settings, ça sert à rien
   * cette feature ». L'onglet disparaît ; ses deux autres panneaux, qui n'étaient pas du budget,
   * rejoignent la section dont ils relèvent — l'arrêt du mode ∞ sous Behaviour, le pilote shadow
   * sous Routage. Aucun réglage n'est perdu en route.
   */
  it('n’offre plus d’onglet Budget, et range ses deux autres panneaux sous Behaviour et Routage', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {}
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    const render = async (section: 'behaviour' | 'routing'): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(SettingsView, { active: true, section, onSectionChange: vi.fn() })
        )
      })
    }

    await render('behaviour')
    const libelles = [...container.querySelectorAll('nav.settings-nav button')].map((button) =>
      button.textContent?.trim()
    )
    expect(libelles).not.toContain('Budget')
    expect(container.querySelector('[data-testid="mode-auto-seuils-stub"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="shadow-pilot-stub"]')).toBeNull()

    await render('routing')
    expect(container.querySelector('[data-testid="shadow-pilot-stub"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="mode-auto-seuils-stub"]')).toBeNull()
  })

  /*
   * DEMANDE UTILISATEUR (conv-242) : « Production » n'est plus un onglet de Settings. L'onglet
   * devient « Rules », et la protection de production y devient UNE règle d'Autowin OS parmi
   * d'autres à venir.
   */
  it('remplace l onglet Production par Rules, où Production est une règle d Autowin OS', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    await act(async () => {
      root.render(
        createElement(SettingsView, { active: true, section: 'rules', onSectionChange: vi.fn() })
      )
    })
    const libelles = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(libelles).toContain('Rules')
    expect(libelles).not.toContain('Production')

    const regles = container.querySelector('[data-testid="settings-rules"]')
    expect(regles).toBeTruthy()
    const regleProd = regles?.querySelector('[data-testid="prod-protection"]')
    expect(regleProd).toBeTruthy()
    expect(regleProd?.querySelector('h2')?.textContent).toBe('Production')
    expect(regleProd?.querySelector('.domain-eyebrow')?.textContent).toBe('Rule · Autowin OS')
  })

  /*
   * POURQUOI : le constat « historique mis de cote » nomme un fichier. Sans bouton, l'utilisateur
   * doit recopier un chemin a la main dans l'explorateur. Et sur un constat qui ne SE REPARE PAS,
   * un bouton « Reparer » promettrait un geste qui ne peut pas aboutir.
   */
  it('offre d ouvrir le dossier du fichier conserve, et AUCUNE reparation', async () => {
    const openFolder = vi.fn().mockResolvedValue(undefined)
    const chemin = 'D:/profil/conversations.json.illisible-2026-09-06'
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        openFolder,
        getPreflight: vi.fn().mockResolvedValue({
          ok: false,
          summary: 'Configuration incomplète',
          checks: [
            {
              id: 'conversations-ecartees',
              label: 'Historique des conversations',
              ok: false,
              detail: 'mis de cote',
              revealPath: chemin
            }
          ]
        })
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
    const reveal = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-reveal-conversations-ecartees"]'
    )
    await act(async () => reveal?.click())

    expect(openFolder).toHaveBeenCalledWith(chemin)
    expect(
      container.querySelector('[data-testid="settings-repair-conversations-ecartees"]')
    ).toBeNull()
  })
})
