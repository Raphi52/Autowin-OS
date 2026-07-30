// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsTopologyView } from './AgentsTopologyView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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

const topology = {
  version: 1,
  orchestrator: {
    slotId: 'orchestrator',
    provider: 'openai',
    modelId: 'gpt',
    reasoningEffort: 'medium'
  },
  subagents: [
    { slotId: 'subagent-1', provider: 'openai', modelId: 'gpt', reasoningEffort: 'low' },
    { slotId: 'subagent-2', provider: 'openai', modelId: 'gpt', reasoningEffort: 'high' }
  ],
  panels: { scout: [], judge: [], frame: [] }
}

const models = [
  {
    id: 'gpt',
    provider: 'openai',
    model: 'gpt',
    label: 'GPT',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium'
  }
]

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

describe('AgentsTopologyView orchestrator persistence', () => {
  it('serializes rapid orchestrator edits and keeps the latest reasoning effort', async () => {
    type RoleResult = {
      orchestrator: { provider: string; model: string; reasoningEffort: string }
    }
    const roleSaves: Array<Deferred<RoleResult>> = []
    const setRole = vi.fn(
      (_role: string, _provider: string, _model: string, _reasoningEffort: string) => {
        const request = deferred<RoleResult>()
        roleSaves.push(request)
        return request.promise
      }
    )
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined,
      setRole
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    const effort = container.querySelector<HTMLSelectElement>(
      '[data-target="orchestrator"] .topology-slot select'
    )
    expect(effort).not.toBeNull()

    await act(async () => {
      effort!.value = 'high'
      effort!.dispatchEvent(new Event('change', { bubbles: true }))
      effort!.value = 'low'
      effort!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setRole).toHaveBeenCalledTimes(1)
    roleSaves[0].resolve({
      orchestrator: {
        provider: 'openai',
        model: 'gpt',
        reasoningEffort: setRole.mock.calls[0][3]
      }
    })
    await flush()

    expect(setRole).toHaveBeenCalledTimes(2)
    expect(setRole.mock.calls[1][3]).toBe('low')
    roleSaves[1].resolve({
      orchestrator: { provider: 'openai', model: 'gpt', reasoningEffort: 'low' }
    })
    await flush()
    expect(effort!.value).toBe('low')
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('AgentsTopologyView concurrent persistence', () => {
  it('serializes rapid edits and builds the second save from the first optimistic snapshot', async () => {
    const saves: Array<Deferred<typeof topology>> = []
    const setTopology = vi.fn((_next: typeof topology) => {
      const request = deferred<typeof topology>()
      saves.push(request)
      return request.promise
    })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology: async () => topology,
      roles: async () => ({ orchestrator: { provider: 'openai', model: 'gpt' } }),
      profiles: async () => [],
      onAppEvent: () => () => undefined,
      setTopology
    }

    await act(async () => root.render(createElement(AgentsTopologyView)))
    await flush()

    const efforts = container.querySelectorAll<HTMLSelectElement>(
      '[data-target="subagents"] .topology-slot select'
    )
    expect(efforts).toHaveLength(2)

    await act(async () => {
      efforts[0].value = 'high'
      efforts[0].dispatchEvent(new Event('change', { bubbles: true }))
      efforts[1].value = 'low'
      efforts[1].dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setTopology).toHaveBeenCalledTimes(1)
    saves[0].resolve(setTopology.mock.calls[0][0])
    await flush()

    expect(setTopology).toHaveBeenCalledTimes(2)
    expect(setTopology.mock.calls[1][0].subagents.map((slot) => slot.reasoningEffort)).toEqual([
      'high',
      'low'
    ])

    saves[1].resolve(setTopology.mock.calls[1][0])
    await flush()
  })
})
