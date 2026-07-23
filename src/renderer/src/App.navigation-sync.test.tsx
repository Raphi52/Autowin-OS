// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({ ChatView: () => createElement('div') }))
vi.mock('./components/PreflightBanner', () => ({ PreflightBanner: () => null }))
vi.mock('./components/FirstRunWizard', () => ({ FirstRunWizard: () => null }))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/WorktreeView', () => ({ WorktreeView: () => null }))
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
  })

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

  it.each([
    {
      interaction: 'un clic rail',
      destination: 'knowledge',
      trigger: (container: HTMLElement) =>
        (container.querySelector('[data-testid="nav-knowledge"]') as HTMLButtonElement).click()
    },
    {
      interaction: 'le raccourci Ctrl+4',
      destination: 'observatory',
      trigger: (_container: HTMLElement) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true })
        )
    },
    {
      interaction: 'le raccourci Cmd+5',
      destination: 'worktree',
      trigger: (_container: HTMLElement) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '5', metaKey: true, bubbles: true })
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
})
