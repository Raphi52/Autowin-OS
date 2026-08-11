// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({ ChatView: () => createElement('div') }))
vi.mock('./components/FirstRunWizard', () => ({ FirstRunWizard: () => null }))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/WorktreeMapView', () => ({ WorktreeMapView: () => null }))
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

import { MainApp } from './App'

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
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      storageMigration: vi.fn().mockResolvedValue({}),
      completeStorageMigration: vi.fn().mockResolvedValue(true),
      appState: vi.fn(async () => ({ tab: 'chat' })),
      onAppEvent: vi.fn(() => vi.fn()),
      appCommand: vi.fn(async () => ({ ok: true })),
      getPreflight: vi.fn(async () => preflight),
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

describe('Settings — alerte preflight dans la nav principale', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    settingsProps.length = 0
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('badge l’entrée Settings de la nav quand un prérequis est en échec', async () => {
    const { root, container } = await mountApp(KO_PREFLIGHT)
    expect(container.querySelector('[data-testid="nav-settings-alert"]')).toBeTruthy()
    await act(async () => root.unmount())
  })

  it('ne badge pas la nav quand le preflight est vert', async () => {
    const { root, container } = await mountApp(OK_PREFLIGHT)
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
