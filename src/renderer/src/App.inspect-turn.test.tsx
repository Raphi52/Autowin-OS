// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({
  ChatView: ({
    onInspectTurn
  }: {
    onInspectTurn: (target: { conversationId: string; turnId: string }) => void
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => onInspectTurn({ conversationId: 'conv-7', turnId: 'turn-8' })
      },
      'Inspecter ce tour'
    )
}))
vi.mock('./components/ObservatoryView', () => ({
  ObservatoryView: ({ focus }: { focus?: { conversationId: string; turnId: string } }) =>
    createElement('output', null, focus ? `${focus.conversationId}:${focus.turnId}` : 'sans cible')
}))
vi.mock('./components/GraphView', () => ({ GraphView: () => null }))
vi.mock('./components/AgentStudioView', () => ({
  AgentStudioView: ({ section }: { section: string }) =>
    createElement('output', null, `Agent Studio ${section}`)
}))
vi.mock('./components/CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./components/BehaviourView', () => ({ BehaviourView: () => null }))
vi.mock('./components/ModelQuestionPopup', () => ({ ModelQuestionPopup: () => null }))

import { MainApp } from './App'

describe('App inspect-turn navigation', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => document.body.replaceChildren())

  it('opens Observatory with the exact conversation and turn focus', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
        appCommand: vi.fn().mockResolvedValue({ ok: true }),
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

    const inspect = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Inspecter ce tour'
    ) as HTMLButtonElement
    await act(async () => inspect.click())

    expect(container.querySelector('output')?.textContent).toBe('conv-7:turn-8')
    expect(container.querySelector('.nav-item.active')?.textContent).toContain('Observatory')
    await act(async () => root.unmount())
  })

  it('renders exactly the six canonical product destinations', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
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

    const navItems = [...container.querySelectorAll('.nav-item')]
    const expectedLabels = ['Chat', 'Agent Studio', 'Knowledge', 'Observatory', 'Worktrees', 'Settings']
    expect(navItems).toHaveLength(expectedLabels.length)
    expectedLabels.forEach((label, index) => expect(navItems[index].textContent).toContain(label))
    for (const id of ['chat', 'agent-studio', 'knowledge', 'observatory', 'worktree', 'settings']) {
      expect(container.querySelector(`[data-testid="nav-${id}"]`)).not.toBeNull()
    }
    await act(async () => root.unmount())
  })

  it('opens Agent Studio when an agent navigates to the legacy Router target', async () => {
    let emitAppEvent: ((event: { type: string; tab?: string }) => void) | undefined
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storageMigration: vi.fn().mockResolvedValue({}),
        completeStorageMigration: vi.fn().mockResolvedValue(true),
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

    await act(async () => emitAppEvent?.({ type: 'navigate', tab: 'router' }))

    expect(container.querySelector('.nav-item.active')?.textContent).toContain('Agent Studio')
    expect(container.textContent).toContain('Agent Studio routing')
    await act(async () => root.unmount())
  })
})
