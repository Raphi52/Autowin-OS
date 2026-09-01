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

function executionRunTrace(
  options: {
    agent?: 'running' | 'completed'
    closed?: boolean
  } = {}
): HarnessTraceEvent[] {
  const events: HarnessTraceEvent[] = [
    trace('run-workspace', 1, {
      type: 'boundary',
      run: {
        runId: 'run-1',
        timestampMs: 1,
        stage: 'workspace',
        workspace: {
          mode: 'worktree',
          repositoryPath: 'C:\\repo',
          path: 'C:\\repo-run-1',
          baseBranch: 'main',
          baseSha: 'abc123'
        }
      }
    }),
    trace('run-open', 2, {
      type: 'gate',
      status: 'running',
      run: {
        runId: 'run-1',
        timestampMs: 2,
        stage: 'closure',
        closure: { status: 'open', totalDurationMs: 0, totalCostUsd: 0 }
      }
    })
  ]
  if (options.agent) {
    events.push(
      trace(`run-agent-${options.agent}`, 3, {
        type: 'handoff',
        status: options.agent,
        actor: { id: 'subagent', kind: 'agent', label: 'Sous-agent' },
        provider: { id: 'codex', model: 'gpt-5.6-codex' },
        execution: {
          phase: 'build',
          agentId: 'builder-1',
          taskId: 'task-build',
          groupId: 'build:fanout',
          dependencyIds: [],
          runId: 'run-1',
          attemptId: 'attempt-1'
        }
      })
    )
  }
  if (options.closed) {
    events.push(
      trace('run-git', 4, {
        type: 'boundary',
        run: {
          runId: 'run-1',
          timestampMs: 4,
          stage: 'git',
          git: {
            outcome: 'merged',
            commitSha: 'def456',
            baseBranch: 'main',
            worktreePath: 'C:\\repo-run-1',
            files: ['src/app.ts']
          }
        }
      }),
      trace('run-green', 5, {
        type: 'gate',
        run: {
          runId: 'run-1',
          timestampMs: 5,
          stage: 'closure',
          closure: {
            status: 'green',
            totalDurationMs: 12_500,
            totalCostUsd: 0.042,
            integrationOutcome: 'merged'
          }
        }
      })
    )
  }
  return events
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
    expect(view.querySelector('.workflow-execution-detail')?.textContent).toContain('gpt-5.6-codex')
  })

  it('ouvre un détail propre à chacun des cinq types du run', async () => {
    const causalTrace = vi
      .fn()
      .mockResolvedValue(executionRunTrace({ agent: 'completed', closed: true }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })
    const view = await render({ conversationId: 'conv-a', active: true })

    const cases = [
      ['workspace:run:run-1', ['Chemin effectif', 'C:\\repo-run-1', 'Mode', 'Copie isolée']],
      ['skill:run-1:build', ['Phase observée', 'build', 'Identité', 'Alias de phase']],
      [
        'agent:run-1:attempt-1',
        ['Agent', 'builder-1', 'Attempt', 'attempt-1', 'Provider', 'codex', 'Modèle']
      ],
      ['git:run-1', ['Sort Git', 'Fusionnée', 'Révision', 'def456', 'Branche de base', 'main']],
      [
        'closure:run-1',
        ['État de clôture', 'Green', 'Temps total', '12,5 s', 'Coût total', '0,042 $']
      ]
    ] as const

    expect(
      new Set(
        [...view.querySelectorAll('[data-execution-kind]')].map((node) =>
          node.getAttribute('data-execution-kind')
        )
      )
    ).toEqual(new Set(['workspace', 'skill', 'agent', 'git', 'closure']))
    for (const [id, labels] of cases) {
      await act(async () =>
        view.querySelector<HTMLButtonElement>(`[data-execution-node="${id}"]`)?.click()
      )
      const detail = view.querySelector('.workflow-execution-detail')?.textContent ?? ''
      for (const label of labels) expect(detail).toContain(label)
    }
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

  it('fait apparaître puis termine les nœuds du même run sans rechargement', async () => {
    vi.useFakeTimers()
    const causalTrace = vi
      .fn()
      .mockResolvedValueOnce(executionRunTrace())
      .mockResolvedValueOnce(executionRunTrace({ agent: 'running' }))
      .mockResolvedValueOnce(executionRunTrace({ agent: 'completed', closed: true }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace }
    })
    const view = await render({ conversationId: 'conv-a', active: true, live: true })

    // `is-pending` et NON `is-running` : la clôture d'un run encore ouvert n'a pas commencé. Cette
    // assertion verrouillait l'ancien libellé « en cours », qui présentait une ABSENCE comme une
    // activité et a fait croire à une session arrêtée. Le nœud reste bien visible et non terminal —
    // le CSS traite `is-pending` et `is-running` avec la même pastille — mais il dit « en attente ».
    expect(view.querySelector('[data-execution-node="closure:run-1"]')?.className).toContain(
      'is-pending'
    )
    expect(view.querySelector('[data-execution-kind="agent"]')).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(view.querySelector('[data-execution-kind="agent"]')?.className).toContain('is-running')
    expect(view.querySelector('[data-execution-kind="git"]')).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(view.querySelector('[data-execution-kind="git"]')).not.toBeNull()
    expect(view.querySelector('[data-execution-node="closure:run-1"]')?.className).toContain(
      'is-completed'
    )
    expect(causalTrace).toHaveBeenCalledTimes(3)
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

  it('recharge la cloture quand un usage provider tardif est publie', async () => {
    let appEvent: ((event: Record<string, unknown>) => void) | undefined
    const causalTrace = vi
      .fn()
      .mockResolvedValueOnce([trace('root', 1)])
      .mockResolvedValueOnce([
        trace('root', 1),
        trace('late-usage', 2, { parentId: 'root', type: 'response-displayed' })
      ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace,
        onAppEvent: (listener: (event: Record<string, unknown>) => void) => {
          appEvent = listener
          return () => undefined
        }
      }
    })
    await render({ conversationId: 'conv-a', active: true, live: false })

    await act(async () => {
      appEvent?.({ type: 'orchestrate-usage', convId: 'conv-a' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(causalTrace).toHaveBeenCalledTimes(2)
    expect(container?.querySelector('[data-execution-node="late-usage"]')).not.toBeNull()
  })

  it('recharge aussi un usage tardif du chat deja terminal sans navigation', async () => {
    let appEvent: ((event: Record<string, unknown>) => void) | undefined
    const causalTrace = vi
      .fn()
      .mockResolvedValueOnce([trace('root', 1)])
      .mockResolvedValueOnce([
        trace('root', 1),
        trace('chat-late-usage', 2, {
          parentId: 'root',
          type: 'boundary',
          actor: { id: 'execution-supervisor', kind: 'system', label: 'Execution supervisor' }
        })
      ])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace,
        onAppEvent: (listener: (event: Record<string, unknown>) => void) => {
          appEvent = listener
          return () => undefined
        }
      }
    })
    await render({ conversationId: 'conv-a', active: true, live: false })

    await act(async () => {
      appEvent?.({ type: 'causal-trace-updated', convId: 'conv-a' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(causalTrace).toHaveBeenCalledTimes(2)
    expect(container?.querySelector('[data-execution-node="chat-late-usage"]')).not.toBeNull()
  })
  /**
   * RUN ZOMBIE DANS LE GRAPHE. Une etape d'un run tue avec l'app est reconciliee en `interrupted`.
   * `statusLabel` ne connaissait pas ce statut : il retombait sur son defaut « termine ». Le graphe
   * annoncait donc terminee une etape qui ne s'est jamais achevee — le contraire de la verite.
   */
  it('une etape reconciliee « interrupted » est dite interrompue, pas terminee', async () => {
    const causalTrace = vi
      .fn()
      .mockResolvedValue([
        trace('etape-zombie', 1, { turnId: 'turn-latest', status: 'interrupted' })
      ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })
    const node = view.querySelector('[data-execution-node="etape-zombie"]')

    expect(node?.textContent).toContain('interrompu')
    expect(node?.textContent).not.toContain('terminé')
    // La pastille doit porter le statut reconcilie, sinon elle reste verte comme un succes.
    expect(node?.className).toContain('is-interrupted')
  })
  /**
   * LA PENSÉE DU SOUS-AGENT EXISTE DANS LES DONNÉES DU GRAPHE ET N'ÉTAIT JAMAIS RENDUE.
   *
   * `stepPayloads` pousse une charge `reasoning` ; `buildHarnessTimelineFromTrace` la RECOPIE dans
   * `event.payloads`. Mais aucun chemin de rendu ne la lisait : ni le titre, ni la meta, ni le
   * détail — qui s'arrêtait à Acteur / Durée / Skill / Provider / Modèle / Observation. La descente
   * « jusqu'à la pensée » butait donc sur son dernier échelon.
   *
   * Le pli reste FERMÉ : la délibération est longue, et le détail doit rester lisible.
   */
  it('descend jusqu’au raisonnement du sous-agent dans le détail d’un nœud', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('agent', 1, {
        turnId: 'turn-latest',
        type: 'handoff',
        provider: { id: 'codex', model: 'gpt-5.6-codex' },
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-build' }
      }),
      trace('reponse', 2, {
        turnId: 'turn-latest',
        parentId: 'agent',
        type: 'model-response',
        provider: { id: 'codex', model: 'gpt-5.6-codex' },
        payloads: [
          { kind: 'model-response', content: 'conclusion : je pars sur B' },
          { kind: 'reasoning', content: 'A coûte moins cher mais casse le gate ; donc B' }
        ]
      })
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })
    // Fermé tant qu'aucun nœud n'est sélectionné : la pensée ne fuit pas dans l'arbre.
    expect(view.textContent).not.toContain('casse le gate')

    await act(async () =>
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
    )
    const detail = view.querySelector('.workflow-execution-detail')
    const pli = detail?.querySelector<HTMLDetailsElement>('[data-execution-reasoning]')

    expect(pli).not.toBeNull()
    expect(pli?.open).toBe(false)
    expect(pli?.querySelector('summary')?.textContent).toContain('Raisonnement')
    expect(pli?.textContent).toContain('A coûte moins cher mais casse le gate ; donc B')
  })

  /** Sans charge `reasoning`, aucun pli vide ne s'invite dans le détail — discriminant. */
  it('n’affiche aucun pli de raisonnement quand la trace n’en porte pas', async () => {
    const causalTrace = vi
      .fn()
      .mockResolvedValue([trace('sans-pensee', 1, { turnId: 'turn-latest' })])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })
    await act(async () =>
      view.querySelector<HTMLButtonElement>('[data-execution-node="sans-pensee"]')?.click()
    )

    expect(view.querySelector('.workflow-execution-detail')).not.toBeNull()
    expect(view.querySelector('[data-execution-reasoning]')).toBeNull()
  })
  /**
   * REMONTER DANS LE TEMPS SANS CHANGER D'ONGLET.
   *
   * Le graphe ne projetait que `timeline.turns[0]` : l'historique de la conversation existait dans
   * la trace et restait hors d'atteinte. Les onglets Sous-agents et Run, eux, listent TOUS les
   * tours — le graphe ne pouvait pas les remplacer sans savoir revenir en arrière.
   */
  it('offre un sélecteur de tour et projette celui qu’on choisit', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('m-vieux', 1, {
        turnId: 'turn-vieux',
        timestamp: '2026-07-30T11:00:00.000Z',
        type: 'message',
        payloads: [{ kind: 'text', content: 'UTILISATEUR: repare le gate' }]
      }),
      trace('a-vieux', 2, {
        turnId: 'turn-vieux',
        timestamp: '2026-07-30T11:00:01.000Z',
        type: 'handoff',
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-vieux' }
      }),
      trace('m-recent', 3, {
        turnId: 'turn-recent',
        timestamp: '2026-07-30T12:00:00.000Z',
        type: 'message',
        payloads: [{ kind: 'text', content: 'UTILISATEUR: ajoute un module' }]
      }),
      trace('a-recent', 4, {
        turnId: 'turn-recent',
        timestamp: '2026-07-30T12:00:01.000Z',
        type: 'handoff',
        execution: { phase: 'judge', agentId: 'juge', taskId: 'task-recent' }
      })
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })
    const selecteur = view.querySelector<HTMLSelectElement>('[data-execution-turn-select]')

    expect(selecteur).not.toBeNull()
    expect([...(selecteur?.options ?? [])].map((option) => option.value)).toEqual([
      'turn-recent',
      'turn-vieux'
    ])
    expect(selecteur?.value).toBe('turn-recent')
    expect(view.querySelector('[data-execution-node="a-recent"]')).not.toBeNull()
    expect(view.querySelector('[data-execution-node="a-vieux"]')).toBeNull()

    await act(async () => {
      selecteur!.value = 'turn-vieux'
      selecteur!.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(view.querySelector('[data-execution-node="a-vieux"]')).not.toBeNull()
    expect(view.querySelector('[data-execution-node="a-recent"]')).toBeNull()
  })

  /** Un seul tour : pas de sélecteur, une commande inutile est du bruit. */
  it('n’affiche pas de sélecteur quand la conversation n’a qu’un tour', async () => {
    const causalTrace = vi
      .fn()
      .mockResolvedValue([trace('seul', 1, { turnId: 'turn-unique', type: 'handoff' })])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })

    expect(view.querySelector('[data-execution-turn-select]')).toBeNull()
  })
})
