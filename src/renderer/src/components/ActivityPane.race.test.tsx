// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ActivityPane } from './ActivityPane'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('ActivityPane request ordering', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('ignore la reponse obsolete de A apres le chargement de B', async () => {
    const activityA = deferred<unknown[]>()
    const activityB = deferred<unknown[]>()
    const globalA = deferred<unknown[]>()
    const globalB = deferred<unknown[]>()
    const callsA = deferred<unknown[]>()
    const callsB = deferred<unknown[]>()
    const nativeA = deferred<unknown[]>()
    const nativeB = deferred<unknown[]>()
    const globals = [globalA.promise, globalB.promise]
    let globalIndex = 0

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversationActivity: vi.fn((id: string) => {
          if (id === '__global_prompt_config__') return globals[globalIndex++]
          return id === 'A' ? activityA.promise : activityB.promise
        }),
        promptCalls: vi.fn((id: string) => (id === 'A' ? callsA.promise : callsB.promise)),
        promptTraces: vi.fn((id: string) => (id === 'A' ? nativeA.promise : nativeB.promise)),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(ActivityPane, { convId: 'A' })))
    await act(async () => root?.render(createElement(ActivityPane, { convId: 'B' })))

    await act(async () => {
      activityB.resolve([{ ts: '2026-07-20T10:00:00Z', kind: 'chat', label: 'conversation B' }])
      globalB.resolve([])
      callsB.resolve([])
      nativeB.resolve([])
      await Promise.resolve()
    })
    expect(container.textContent).toContain('conversation B')

    await act(async () => {
      activityA.resolve([{ ts: '2026-07-20T09:00:00Z', kind: 'chat', label: 'conversation A' }])
      globalA.resolve([])
      callsA.resolve([])
      nativeA.resolve([])
      await Promise.resolve()
    })

    expect(container.textContent).toContain('conversation B')
    expect(container.textContent).not.toContain('conversation A')
  })

  it('affiche le modele route et son effort plutot que le transport OmniRoute', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversationActivity: vi.fn((id: string) =>
          Promise.resolve(
            id === '__global_prompt_config__'
              ? []
              : [
                  {
                    ts: '2026-07-22T11:09:01Z',
                    kind: 'chat',
                    label: 'tour agent',
                    provider: 'omniroute',
                    model: 'claude-opus-4-6',
                    reasoningEffort: 'high'
                  }
                ]
          )
        ),
        promptCalls: vi.fn(() => Promise.resolve([])),
        promptTraces: vi.fn(() => Promise.resolve([])),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(ActivityPane, { convId: 'A' })))

    expect(container.textContent).toContain('claude-opus-4-6 · high')
    expect(container.textContent).not.toContain('omniroute')
  })

  it('retombe sur le provider historique quand le modele journalise est vide', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversationActivity: vi.fn((id: string) =>
          Promise.resolve(
            id === '__global_prompt_config__'
              ? []
              : [
                  {
                    ts: '2026-07-22T11:09:01Z',
                    kind: 'chat',
                    label: 'ancien tour',
                    provider: 'omniroute',
                    model: '   '
                  }
                ]
          )
        ),
        promptCalls: vi.fn(() => Promise.resolve([])),
        promptTraces: vi.fn(() => Promise.resolve([])),
        onAppEvent: vi.fn(() => vi.fn())
      }
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(ActivityPane, { convId: 'A' })))

    expect(container.textContent).toContain('omniroute')
  })
})
