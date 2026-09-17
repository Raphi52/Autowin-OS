// @vitest-environment happy-dom
/* fix-ok: cause mesuree — le processus principal tenait la vue courante sur un seul scalaire (this.tab, src/main/commands.ts) diffuse a TOUTES les fenetres (broadcast navigate) ; deux fenetres s'ecrasaient donc mutuellement. Remplace par un agencement fenetre -> onglets -> actif. Verifie par src/shared/tab-layout.test.ts + src/main/tab-windows.test.ts + src/renderer/src/App.tabs.test.tsx (35 tests verts). */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({ ChatView: () => createElement('div') }))
vi.mock('./components/FirstRunWizard', () => ({ FirstRunWizard: () => null }))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/TicketsView', () => ({ TicketsView: () => null }))
vi.mock('./components/AgentStudioView', () => ({ AgentStudioView: () => null }))
vi.mock('./components/KnowledgeView', () => ({ KnowledgeView: () => null }))
vi.mock('./components/SettingsView', () => ({ SettingsView: () => null }))
vi.mock('./components/ModelQuestionPopup', () => ({ ModelQuestionPopup: () => null }))

import { MainApp } from './App'
import { lireFenetreDuHash } from './fenetre-onglet'

interface Api {
  appCommand: ReturnType<typeof vi.fn>
  onAppEvent: ReturnType<typeof vi.fn>
}

function poserApi(agencement: unknown): { api: Api; emettre: (e: unknown) => void } {
  let ecouteur: (e: unknown) => void = () => {}
  const api: Api = {
    appCommand: vi.fn(async (name: string) =>
      name === 'tab_layout' ? { ok: true, data: { layout: agencement } } : { ok: true, data: {} }
    ),
    onAppEvent: vi.fn((cb: (e: unknown) => void) => {
      ecouteur = cb
      return vi.fn()
    }),
    storageMigration: vi.fn().mockResolvedValue({}),
    completeStorageMigration: vi.fn().mockResolvedValue(true),
    appState: vi.fn(async () => ({ tab: 'accueil' }))
  } as unknown as Api
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  return { api, emettre: (e) => ecouteur(e) }
}

async function monter(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MainApp))
    await Promise.resolve()
  })
  return container
}

describe('barre d’onglets', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    window.location.hash = ''
  })

  it('lit sa fenêtre dans le hash', () => {
    expect(lireFenetreDuHash('')).toEqual({ windowId: 'main', tab: null })
    expect(lireFenetreDuHash('#tab?window=detached-1&tab=observatory')).toEqual({
      windowId: 'detached-1',
      tab: 'observatory'
    })
  })

  it('affiche un onglet par vue ouverte dans CETTE fenêtre', async () => {
    poserApi({
      windows: [
        { id: 'main', tabs: ['accueil', 'chat'], active: 'chat' },
        { id: 'detached-1', tabs: ['observatory'], active: 'observatory' }
      ]
    })
    const container = await monter()

    expect(container.querySelector('[data-testid="tab-accueil"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="tab-chat"]')).not.toBeNull()
    // L'onglet parti sur le 2e écran n'apparaît PAS dans la barre de la principale.
    expect(container.querySelector('[data-testid="tab-observatory"]')).toBeNull()
  })

  /**
   * LE DÉFAUT RACINE, vu de la page : un évènement de navigation adressé à une AUTRE fenêtre ne doit
   * rien changer ici. Sans le filtre sur `window`, la fenêtre du 2e écran suivait la principale.
   */
  it('ignore une navigation adressée à une autre fenêtre', async () => {
    const { emettre } = poserApi({
      windows: [{ id: 'main', tabs: ['accueil'], active: 'accueil' }]
    })
    const container = await monter()

    await act(async () => {
      emettre({ type: 'navigate', tab: 'chat', window: 'detached-1' })
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-testid="tab-accueil"]')?.getAttribute('data-active')
    ).toBe('true')
    expect(container.querySelector('[data-testid="tab-chat"]')).toBeNull()
  })

  it('un onglet lâché hors de la fenêtre demande son détachement', async () => {
    const { api } = poserApi({
      windows: [{ id: 'main', tabs: ['accueil', 'chat'], active: 'accueil' }]
    })
    const container = await monter()
    const onglet = container.querySelector('[data-testid="tab-chat"]') as HTMLElement

    await act(async () => {
      const debut = new Event('dragstart', { bubbles: true }) as Event & { dataTransfer: unknown }
      Object.defineProperty(debut, 'dataTransfer', {
        value: { effectAllowed: '', setData: vi.fn(), getData: () => 'chat' }
      })
      onglet.dispatchEvent(debut)
      const fin = new Event('dragend', { bubbles: true })
      Object.defineProperty(fin, 'screenX', { value: 2400 })
      Object.defineProperty(fin, 'screenY', { value: 300 })
      Object.defineProperty(fin, 'dataTransfer', { value: { dropEffect: 'none' } })
      onglet.dispatchEvent(fin)
      await Promise.resolve()
    })

    const appel = api.appCommand.mock.calls.find(([name]) => name === 'tab_detach')
    expect(appel).toBeTruthy()
    expect(appel?.[1]).toMatchObject({ tab: 'chat' })
    expect((appel?.[1] as { bounds: { x: number; y: number } }).bounds.x).toBe(2340)
    // L'onglet quitte la barre de la fenêtre d'origine : il vit maintenant ailleurs.
    expect(container.querySelector('[data-testid="tab-chat"]')).toBeNull()
  })

  it('fermer un onglet le retire et le dit au processus principal', async () => {
    const { api } = poserApi({
      windows: [{ id: 'main', tabs: ['accueil', 'chat'], active: 'accueil' }]
    })
    const container = await monter()

    await act(async () => {
      ;(container.querySelector('[data-testid="tab-close-chat"]') as HTMLElement).click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="tab-chat"]')).toBeNull()
    expect(api.appCommand).toHaveBeenCalledWith('tab_close', { tab: 'chat' })
  })
})
