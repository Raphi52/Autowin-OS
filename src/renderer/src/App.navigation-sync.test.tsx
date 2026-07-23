// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({ ChatView: () => createElement('div') }))
vi.mock('./components/PreflightBanner', () => ({ PreflightBanner: () => null }))
vi.mock('./components/FirstRunWizard', () => ({ FirstRunWizard: () => null }))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/AgentStudioView', () => ({ AgentStudioView: () => null }))
vi.mock('./components/KnowledgeView', () => ({ KnowledgeView: () => null }))
vi.mock('./components/SettingsView', () => ({ SettingsView: () => null }))
vi.mock('./components/ModelQuestionPopup', () => ({ ModelQuestionPopup: () => null }))

import { MainApp } from './App'

describe('navigation humaine synchronisée avec le main', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
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
      expect(appCommand).toHaveBeenCalledWith('navigate', { tab: destination })
      await act(async () => root.unmount())
    }
  )
})
