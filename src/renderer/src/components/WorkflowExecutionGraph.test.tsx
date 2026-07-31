// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WorkflowExecutionGraph } from './WorkflowExecutionGraph'
import type { HarnessTraceEvent } from './harness-timeline-model'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

function trace(
  id: string,
  sequence: number,
  overrides: Partial<HarnessTraceEvent> = {}
): HarnessTraceEvent {
  return {
    id,
    conversationId: 'conv-a',
    turnId: 'turn-1',
    parentId: undefined,
    timestamp: `2026-07-30T12:00:0${sequence}.000Z`,
    sequence,
    type: 'tool-call',
    status: 'completed',
    channel: 'tool',
    actor: { id: 'agent', kind: 'agent', label: 'Builder' },
    recipient: { id: 'tool', kind: 'tool', label: 'Terminal' },
    payloads: [{ kind: 'tool-call', content: 'contenu sensible', name: 'npm test' }],
    observation: { boundary: 'orchestrator', fidelity: 'exact' },
    metrics: { durationMs: 1250 },
    ...overrides
  }
}

describe('WorkflowExecutionGraph', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.useRealTimers()
  })

  async function render(props: {
    conversationId?: string
    active?: boolean
    live?: boolean
    requestLabel?: string
  }) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(WorkflowExecutionGraph, props))
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  it('met le nom exact de la skill sur la card et réserve provider/modèle au détail', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('old-agent', 1, {
        turnId: 'turn-old',
        timestamp: '2026-07-30T11:00:00.000Z',
        actor: { id: 'old', kind: 'agent', label: 'Ancien agent' }
      }),
      trace('agent', 2, {
        turnId: 'turn-latest',
        type: 'handoff',
        provider: { id: 'codex', model: 'gpt-5.6-codex' },
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-build' }
      }),
      trace('message', 3, {
        turnId: 'turn-latest',
        parentId: 'agent',
        type: 'message',
        provider: { id: 'codex', model: 'gpt-5.6-codex' }
      }),
      trace('response', 4, {
        turnId: 'turn-latest',
        parentId: 'message',
        type: 'model-response',
        provider: { id: 'codex', model: 'gpt-5.6-codex' },
        metrics: { durationMs: 1250 }
      })
    ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })

    const view = await render({
      conversationId: 'conv-a',
      active: true,
      requestLabel: 'Construis le graphe de ma demande'
    })

    expect(causalTrace).toHaveBeenCalledWith('conv-a')
    expect(view.querySelectorAll('[data-execution-node]')).toHaveLength(3)
    expect(view.querySelector('[data-execution-node="request:turn-latest"]')).not.toBeNull()
    expect(view.querySelector('[data-execution-node="agent"]')?.getAttribute('data-depth')).toBe(
      '2'
    )
    expect(view.querySelector('[data-execution-node="old-agent"]')).toBeNull()
    expect(
      [...view.querySelectorAll('[data-execution-node]')].every(
        (node) => node.tagName === 'BUTTON' && node.getAttribute('role') === 'treeitem'
      )
    ).toBe(true)
    expect(view.textContent).toContain('Demande utilisateur')
    expect(view.textContent).toContain('Construis le graphe de ma demande')
    expect(view.textContent).toContain('Builder')
    expect(view.textContent).toContain('1,25 s')
    expect(view.textContent).not.toContain('Ancien agent')
    expect(view.textContent).not.toContain('contenu sensible')
    expect(view.querySelector('.workflow-execution-node.is-critical')).toBeNull()

    const agentNode = view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')
    const agentMeta = agentNode?.querySelector('.workflow-execution-node-meta')
    expect(agentMeta?.querySelector('.workflow-execution-skill')?.textContent).toBe('skill · build')
    expect(agentMeta?.textContent).not.toContain('Workflow Autowin')
    expect(agentMeta?.textContent).not.toContain('codex')
    expect(agentMeta?.textContent).not.toContain('gpt-5.6-codex')
    expect(agentNode?.getAttribute('data-execution-provider')).toBe('codex')
    expect(agentNode?.getAttribute('data-execution-model')).toBe('gpt-5.6-codex')

    await act(async () => agentNode?.click())
    expect(view.querySelector('.workflow-execution-detail')?.textContent).toContain('codex')
    expect(view.querySelector('.workflow-execution-detail')?.textContent).toContain(
      'gpt-5.6-codex'
    )
  })

  it('qualifie une orchestration historique sans inventer de phase', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('legacy-handoff', 1, {
        type: 'handoff',
        provider: undefined,
        execution: undefined,
        observation: { boundary: 'Autowin orchestration exec', fidelity: 'exact' }
      })
    ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })

    const view = await render({ conversationId: 'conv-a', active: true })
    const meta = view
      .querySelector('[data-execution-node="legacy-handoff"]')
      ?.querySelector('.workflow-execution-node-meta')

    expect(meta?.textContent).toContain('skill non tracée')
    expect(meta?.textContent).not.toContain('Workflow Autowin')
    expect(meta?.textContent).not.toContain('provider non exposé')
    expect(meta?.textContent).not.toContain('modèle non exposé')
    expect(view.querySelector('[data-execution-kind="phase"]')).toBeNull()
  })

  it('distingue un chat direct du pipeline Autowin', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('direct-message', 1, {
        type: 'message',
        actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrator' },
        provider: { id: 'codex', model: 'gpt-5.6-codex' },
        execution: undefined
      }),
      trace('direct-tool', 2, {
        type: 'tool-call',
        parentId: 'direct-message',
        actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrator' },
        provider: undefined,
        execution: undefined
      })
    ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })

    const view = await render({ conversationId: 'conv-a', active: true })
    const meta = view
      .querySelector('[data-execution-node="direct-message"]')
      ?.querySelector('.workflow-execution-node-meta')

    expect(meta?.textContent).toContain('aucune skill')
    expect(meta?.textContent).toContain('chat direct')
    expect(meta?.textContent).not.toContain('codex')

    const toolMeta = view
      .querySelector('[data-execution-node="direct-tool"]')
      ?.querySelector('.workflow-execution-node-meta')
    expect(toolMeta?.textContent).toContain('aucune skill')
    expect(toolMeta?.textContent).toContain('chat direct')
  })

  it('relie chaque card enfant avec une flèche orientée vers elle', () => {
    const css = readFileSync(join(__dirname, 'WorkflowExecutionGraph.css'), 'utf8')

    expect(css).toContain('.workflow-execution-edge::after')
    expect(css).toMatch(/border-left:\s*5px solid/)
    expect(css).toMatch(/border-top:\s*4px solid transparent/)
    expect(css).toMatch(/border-bottom:\s*4px solid transparent/)
  })

  it('ignore une réponse obsolète après un changement rapide de conversation', async () => {
    const first = deferred<HarnessTraceEvent[]>()
    const causalTrace = vi.fn((conversationId: string) =>
      conversationId === 'conv-a'
        ? first.promise
        : Promise.resolve([trace('fresh', 1, { conversationId: 'conv-b' })])
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })
    await render({ conversationId: 'conv-a', active: true })

    await act(async () => {
      root?.render(
        createElement(WorkflowExecutionGraph, { conversationId: 'conv-b', active: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => first.resolve([trace('stale', 1)]))

    expect(container?.querySelector('[data-execution-node="fresh"]')).not.toBeNull()
    expect(container?.querySelector('[data-execution-node="stale"]')).toBeNull()
  })

  it('rafraîchit la trace pendant une exécution live', async () => {
    vi.useFakeTimers()
    const causalTrace = vi
      .fn()
      .mockResolvedValueOnce([trace('root', 1)])
      .mockResolvedValueOnce([trace('root', 1), trace('next', 2, { parentId: 'root' })])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })
    await render({ conversationId: 'conv-a', active: true, live: true })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(causalTrace).toHaveBeenCalledTimes(2)
    expect(container?.querySelector('[data-execution-node="next"]')).not.toBeNull()
  })

  it('fait un dernier rafraîchissement quand l’exécution live se termine', async () => {
    const causalTrace = vi
      .fn()
      .mockResolvedValueOnce([trace('root', 1)])
      .mockResolvedValueOnce([
        trace('root', 1),
        trace('final', 2, { parentId: 'root', type: 'response-displayed' })
      ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })
    await render({ conversationId: 'conv-a', active: true, live: true })

    await act(async () => {
      root?.render(
        createElement(WorkflowExecutionGraph, {
          conversationId: 'conv-a',
          active: true,
          live: false
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(causalTrace).toHaveBeenCalledTimes(2)
    expect(container?.querySelector('[data-execution-node="final"]')).not.toBeNull()
  })
})
