// @vitest-environment happy-dom
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('navigation humaine synchronisée avec le main', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it.each([
    ['?instance=test', 'test', true, 'Autowin OS Test'],
    ['', 'user', false, 'Autowin OS']
  ] as const)(
    'renders automation identity %s without leaking it into the user mode',
    async (search, expectedMode, hasBanner, expectedTitle) => {
      window.history.replaceState({}, '', `/${search}`)
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: {
          storageMigration: vi.fn().mockResolvedValue({}),
          completeStorageMigration: vi.fn().mockResolvedValue(true),
          appState: vi.fn(async () => ({ tab: 'chat' })),
          onAppEvent: vi.fn(() => vi.fn())
        }
      })
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)

      await act(async () => {
        root.render(createElement(MainApp))
        await Promise.resolve()
      })

      expect(container.querySelector('.shell')?.getAttribute('data-automation-instance')).toBe(
        expectedMode
      )
      expect(container.querySelector('.test-instance-banner') !== null).toBe(hasBanner)
      expect(document.title).toBe(expectedTitle)
      await act(async () => root.unmount())
    }
  )

  it('affiche une branche Git vectorielle pour Worktrees', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appState: vi.fn(async () => ({ tab: 'chat' })),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    const worktreeButton = container.querySelector('[data-testid="nav-worktree"]')
    expect(worktreeButton?.querySelector('svg[data-icon="git-branch"]')).not.toBeNull()
    expect(worktreeButton?.textContent).not.toContain('🌳')
    await act(async () => root.unmount())
  })

  it('affiche une icône Task Manager vectorielle et colorée', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appState: vi.fn(async () => ({ tab: 'chat' })),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    const icon = container.querySelector(
      '[data-testid="nav-task-manager"] svg[data-icon="task-manager"]'
    )
    expect(icon?.querySelector('linearGradient stop[stop-color="#36e6ff"]')).not.toBeNull()
    expect(icon?.querySelector('path[stroke="#fb7185"]')).not.toBeNull()
    expect(icon?.querySelector('circle[fill="#34d399"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it.each([
    {
      interaction: 'un clic rail',
      destination: 'knowledge',
      trigger: (container: HTMLElement) =>
        (container.querySelector('[data-testid="nav-knowledge"]') as HTMLButtonElement).click()
    },
    // Ctrl+N indexe POSITIONNELLEMENT `APP_DESTINATIONS`. L'ajout de l'Accueil en tete decale donc
    // chaque rang d'un cran, ce qui est le comportement voulu : Ctrl+1 ouvre l'accueil. Ce test ne
    // garde pas une touche pour une vue, il garde l'INVARIANT « ce qu'on voit == appState().tab ».
    {
      interaction: 'le raccourci Ctrl+1',
      destination: 'accueil',
      trigger: (_container: HTMLElement) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true })
        )
    },
    {
      interaction: 'le raccourci Ctrl+4',
      destination: 'knowledge',
      trigger: (_container: HTMLElement) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true })
        )
    },
    {
      interaction: 'le raccourci Cmd+6',
      destination: 'task-manager',
      trigger: (_container: HTMLElement) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '6', metaKey: true, bubbles: true })
        )
    }
  ])(
    'garde la destination visible égale à appState().tab après $interaction',
    async ({ destination, trigger }) => {
      let mainTab = 'chat'
      const appCommand = vi.fn(
        async (name: string, args?: Record<string, unknown>): Promise<{ ok: boolean }> => {
          if (name === 'navigate' && typeof args?.tab === 'string') mainTab = args.tab
          return { ok: true }
        }
      )
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: {
          storageMigration: vi.fn().mockResolvedValue({}),
          completeStorageMigration: vi.fn().mockResolvedValue(true),
          appCommand,
          appState: vi.fn(async () => ({ tab: mainTab })),
          onAppEvent: vi.fn(() => vi.fn())
        }
      })
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      await act(async () => {
        root.render(createElement(MainApp))
        await Promise.resolve()
      })

      await act(async () => {
        trigger(container)
        await Promise.resolve()
      })

      expect(container.querySelector('.nav-item.active')?.getAttribute('data-testid')).toBe(
        `nav-${destination}`
      )
      expect((await window.api.appState()) as { tab: string }).toEqual({ tab: destination })
      expect(appCommand).toHaveBeenCalledWith(
        'navigate',
        expect.objectContaining({ tab: destination, origin: expect.any(String) })
      )
      await act(async () => root.unmount())
    }
  )

  it('hydrate la vue initiale depuis l’état autoritaire sans émettre de commande', async () => {
    const appCommand = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appCommand,
        appState: vi.fn(async () => ({ tab: 'settings' })),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    expect(container.querySelector('.nav-item.active')?.getAttribute('data-testid')).toBe(
      'nav-settings'
    )
    expect(appCommand).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('ne marque pas comme pilotage agent l’écho d’une navigation humaine locale', async () => {
    let emitAppEvent: ((event: { type: string; tab?: string; origin?: string }) => void) | undefined
    const appCommand = vi.fn(
      async (_name: string, args?: Record<string, unknown>): Promise<{ ok: boolean }> => {
        emitAppEvent?.({
          type: 'navigate',
          tab: String(args?.tab),
          origin: typeof args?.origin === 'string' ? args.origin : undefined
        })
        return { ok: true }
      }
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appCommand,
        appState: vi.fn(async () => ({ tab: 'chat' })),
        onAppEvent: vi.fn((listener) => {
          emitAppEvent = listener
          return vi.fn()
        })
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="nav-knowledge"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    expect(container.querySelector('main')?.getAttribute('data-driven')).toBe('false')
    expect(appCommand).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('ignore un ACK humain résolu après une navigation plus récente', async () => {
    let mainTab = 'chat'
    const pending: Array<ReturnType<typeof deferred<{ ok: boolean }>>> = []
    const appCommand = vi.fn((_name: string, args?: Record<string, unknown>) => {
      mainTab = String(args?.tab)
      const ack = deferred<{ ok: boolean }>()
      pending.push(ack)
      return ack.promise
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appCommand,
        appState: vi.fn(async () => ({ tab: mainTab })),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="nav-knowledge"]') as HTMLButtonElement).click()
      ;(container.querySelector('[data-testid="nav-settings"]') as HTMLButtonElement).click()
    })
    expect(pending).toHaveLength(2)
    await act(async () => {
      pending[1].resolve({ ok: true })
      await pending[1].promise
    })
    expect(container.querySelector('.nav-item.active')?.getAttribute('data-testid')).toBe(
      'nav-settings'
    )

    await act(async () => {
      pending[0].resolve({ ok: true })
      await pending[0].promise
    })
    expect(container.querySelector('.nav-item.active')?.getAttribute('data-testid')).toBe(
      'nav-settings'
    )
    expect(await window.api.appState()).toEqual({ tab: 'settings' })
    await act(async () => root.unmount())
  })

  it('laisse un événement agent invalider un ACK humain en attente sans émettre de commande', async () => {
    let mainTab = 'chat'
    let emitAppEvent: ((event: { type: string; tab?: string }) => void) | undefined
    const ack = deferred<{ ok: boolean }>()
    const appCommand = vi.fn((_name: string, args?: Record<string, unknown>) => {
      mainTab = String(args?.tab)
      return ack.promise
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appCommand,
        appState: vi.fn(async () => ({ tab: mainTab })),
        onAppEvent: vi.fn((listener) => {
          emitAppEvent = listener
          return vi.fn()
        })
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="nav-knowledge"]') as HTMLButtonElement).click()
      mainTab = 'observatory'
      emitAppEvent?.({ type: 'navigate', tab: 'observatory' })
    })
    expect(appCommand).toHaveBeenCalledTimes(1)
    await act(async () => {
      ack.resolve({ ok: true })
      await ack.promise
    })

    expect(container.querySelector('.nav-item.active')?.getAttribute('data-testid')).toBe(
      'nav-observatory'
    )
    expect(await window.api.appState()).toEqual({ tab: 'observatory' })
    expect(appCommand).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it.each([
    {
      failure: 'un refus métier',
      command: () => vi.fn().mockResolvedValue({ ok: false, error: 'refus simulé' })
    },
    {
      failure: 'un rejet IPC',
      command: () => vi.fn().mockRejectedValue(new Error('IPC indisponible'))
    },
    { failure: 'une API absente', command: () => undefined }
  ])('ne désynchronise pas la vue après $failure', async ({ command }) => {
    const appCommand = command()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appCommand,
        appState: vi.fn(async () => ({ tab: 'chat' })),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="nav-knowledge"]') as HTMLButtonElement).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('.nav-item.active')?.getAttribute('data-testid')).toBe(
      'nav-chat'
    )
    expect(await window.api.appState()).toEqual({ tab: 'chat' })
    await act(async () => root.unmount())
  })

  it('onglets de vues : une vue ouverte fait un onglet, lâchée hors de la fenêtre elle part dans sa propre fenêtre', async () => {
    const detachView = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appState: vi.fn(async () => ({ tab: 'chat' })),
        onAppEvent: vi.fn(() => vi.fn()),
        detachView,
        windowBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 })
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })
    const onglets = (): string[] =>
      [...container.querySelectorAll('[data-testid^="view-tab-"]')].map(
        (el) => el.getAttribute('data-testid') ?? ''
      )
    expect(onglets()).toEqual(['view-tab-accueil', 'view-tab-chat'])

    const chat = container.querySelector('[data-testid="view-tab-chat"]') as HTMLElement
    // Lâcher DANS la fenêtre : rien ne se détache.
    await act(async () => {
      chat.dispatchEvent(new MouseEvent('dragend', { bubbles: true, screenX: 500, screenY: 300 }))
      await Promise.resolve()
    })
    expect(detachView).not.toHaveBeenCalled()
    // Lâcher sur l'autre écran : fenêtre séparée demandée au point du lâcher, onglet retiré.
    await act(async () => {
      chat.dispatchEvent(new MouseEvent('dragend', { bubbles: true, screenX: 2600, screenY: 400 }))
      await Promise.resolve()
    })
    expect(detachView).toHaveBeenCalledWith('chat', 2600, 400)
    expect(onglets()).toEqual(['view-tab-accueil'])
    await act(async () => root.unmount())
  })

  it('une fenêtre détachée (#view=) montre sa seule vue, sans menu ni onglets', async () => {
    window.history.replaceState({}, '', '/#view=chat')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appState: vi.fn(async () => ({ tab: 'accueil' })),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(MainApp))
      await Promise.resolve()
    })
    expect(container.querySelector('.rail')).toBeNull()
    expect(container.querySelector('[data-testid="view-tabs"]')).toBeNull()
    expect(
      container.querySelector('.view-slot.is-active [data-vue="chat"], .view-slot.is-active')
    ).not.toBeNull()
    expect(container.querySelectorAll('.view-slot')).toHaveLength(1)
    expect(window.api.onAppEvent).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
