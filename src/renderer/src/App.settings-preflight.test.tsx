// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({ ChatView: () => createElement('div') }))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/TicketsView', () => ({ TicketsView: () => null }))
vi.mock('./components/TaskManagerView', () => ({ TaskManagerView: () => null }))
vi.mock('./components/AgentStudioView', () => ({ AgentStudioView: () => null }))
vi.mock('./components/KnowledgeView', () => ({ KnowledgeView: () => null }))
vi.mock('./components/ModelQuestionPopup', () => ({ ModelQuestionPopup: () => null }))

const settingsProps: Array<{ section: string }> = []
vi.mock('./components/SettingsView', () => ({
  SettingsView: (props: { section: string }) => {
    settingsProps.push(props)
    return createElement('div', { 'data-testid': 'settings-stub', 'data-section': props.section })
  }
}))

import { DELAI_ALERTE_DEMARRAGE_MS, MainApp } from './App'

const KO_PREFLIGHT = {
  ok: false,
  summary: 'Un prérequis manque.',
  checks: [{ id: 'brain', label: 'Brain server', ok: false }]
}
const OK_PREFLIGHT = {
  ok: true,
  summary: 'Tous les prérequis sont OK.',
  checks: [{ id: 'brain', label: 'Brain server', ok: true }]
}

async function mountApp(preflight: unknown): Promise<{
  root: ReturnType<typeof createRoot>
  container: HTMLDivElement
}> {
  // Le « ! » n'est arme qu'apres DELAI_ALERTE_DEMARRAGE_MS : horloge factice, posee AVANT le
  // montage pour que le minuteur de l'application soit le sien.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      storageMigration: vi.fn().mockResolvedValue({}),
      completeStorageMigration: vi.fn().mockResolvedValue(true),
      appState: vi.fn(async () => ({ tab: 'chat' })),
      onAppEvent: vi.fn(() => vi.fn()),
      appCommand: vi.fn(async () => ({ ok: true })),
      getPreflight: vi.fn(async () => {
        // Un diagnostic peut ECHOUER, pas seulement rendre un verdict rouge : le harnais doit
        // pouvoir exprimer ce cas, sinon aucun test ne peut voir l'erreur avalee.
        if (preflight instanceof Error) throw preflight
        return preflight
      }),
      onPreflight: vi.fn(() => vi.fn())
    }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MainApp))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { root, container }
}

/** Fait passer le délai de démarrage, puis laisse la relecture du diagnostic aboutir. */
async function passerLeDelai(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(DELAI_ALERTE_DEMARRAGE_MS)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Settings — alerte preflight dans la nav principale', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    settingsProps.length = 0
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('badge l’entrée Settings de la nav quand un prérequis est en échec, une fois le délai passé', async () => {
    const { root, container } = await mountApp(KO_PREFLIGHT)
    await passerLeDelai()
    expect(container.querySelector('[data-testid="nav-settings-alert"]')?.textContent).toBe('!')
    await act(async () => root.unmount())
  })

  /**
   * conv-963 (2026-10-15) : « je veux plus l'avoir cette popup, juste 30 secondes après si y a une
   * étape qui a foiré tu mets un point d'exclamation à côté de l'icône Settings ». Avant le délai, le
   * démarrage n'est pas fini : rien ne s'annonce.
   */
  it('ne badge RIEN avant 30 s, même si un prérequis est en échec au lancement', async () => {
    const { root, container } = await mountApp(KO_PREFLIGHT)
    expect(DELAI_ALERTE_DEMARRAGE_MS).toBe(30_000)
    await act(async () => {
      vi.advanceTimersByTime(DELAI_ALERTE_DEMARRAGE_MS - 1)
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeNull()
    await passerLeDelai()
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeTruthy()
    await act(async () => root.unmount())
  })

  it('relit le diagnostic à 30 s : un rouge du lancement repassé au vert ne badge pas', async () => {
    let etat: unknown = KO_PREFLIGHT
    const { root, container } = await mountApp(KO_PREFLIGHT)
    ;(window.api.getPreflight as ReturnType<typeof vi.fn>).mockImplementation(async () => etat)
    etat = OK_PREFLIGHT
    await passerLeDelai()
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('ne monte aucune popup de démarrage', async () => {
    const { root } = await mountApp(KO_PREFLIGHT)
    await passerLeDelai()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Bienvenue dans Autowin OS')
    await act(async () => root.unmount())
  })

  it('ne badge pas la nav quand le preflight est vert', async () => {
    const { root, container } = await mountApp(OK_PREFLIGHT)
    await passerLeDelai()
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('ouvre Settings sur Diagnostic quand le preflight est en échec', async () => {
    const { root, container } = await mountApp(KO_PREFLIGHT)
    const navSettings = container.querySelector('[data-testid="nav-settings"]') as HTMLButtonElement
    await act(async () => {
      navSettings.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-testid="settings-stub"]')?.getAttribute('data-section')
    ).toBe('preflight')
    await act(async () => root.unmount())
  })

  it('garde capabilities quand le preflight est vert', async () => {
    const { root, container } = await mountApp(OK_PREFLIGHT)
    const navSettings = container.querySelector('[data-testid="nav-settings"]') as HTMLButtonElement
    await act(async () => {
      navSettings.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-testid="settings-stub"]')?.getAttribute('data-section')
    ).toBe('capabilities')
    await act(async () => root.unmount())
  })
})

/**
 * UN DIAGNOSTIC QUI ÉCHOUE NE DOIT PAS SE LIRE COMME UN DIAGNOSTIC VERT.
 *
 * Candidat sorti par le SCOUT DE L'APP le 2026-08-19 (score 82, `App.tsx:251-256`), confirmé par son
 * juge (« erreur preflight avalée dans App.tsx:251-256 ») puis vérifié dans le code : le `catch` était
 * vide, donc si `getPreflight()` jetait, `setPreflightAlert` n'était jamais appelé et la navigation
 * n'affichait AUCUNE alerte. L'application avait l'air saine précisément quand son propre contrôle de
 * santé était cassé — le faux vert exact que cette session passe à traquer.
 *
 * L'absence d'API reste silencieuse (un shell plus ancien n'est pas une panne) ; seule une exception
 * lève l'alerte.
 */
describe('Settings — un preflight qui JETTE alerte au lieu de se taire', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    settingsProps.length = 0
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('badge la nav quand le diagnostic lui-même échoue', async () => {
    const { root, container } = await mountApp(new Error('preflight indisponible'))
    await passerLeDelai()
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeTruthy()
    await act(async () => root.unmount())
  })

  it('ouvre Settings sur Diagnostic quand le diagnostic échoue', async () => {
    const { root, container } = await mountApp(new Error('preflight indisponible'))
    const navSettings = container.querySelector('[data-testid="nav-settings"]') as HTMLButtonElement
    await act(async () => {
      navSettings.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-testid="settings-stub"]')?.getAttribute('data-section')
    ).toBe('preflight')
    await act(async () => root.unmount())
  })

  it('CONTRE-EXEMPLE — une API absente ne declenche aucune alerte', async () => {
    const { root, container } = await mountApp(undefined)
    await passerLeDelai()
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
