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

  /**
   * AUCUNE « duree inconnue » DANS LE GRAPHE (conv-259). Un marqueur ponctuel (injection, appel
   * d'outil) n'a pas de duree mesuree : la trace porte quand meme son horodatage, donc le bloc dit
   * sa POSITION dans la demande. Test discriminant : le fallback ne doit pas etre un texte
   * d'ignorance, et il ne doit pas non plus inventer une duree de 0 ms.
   */
  it('remplace toute duree manquante par la position de l evenement, jamais par « inconnue »', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('agent', 1, {
        type: 'handoff',
        metrics: undefined,
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-build' }
      }),
      trace('outil', 2, {
        parentId: 'agent',
        metrics: undefined
      })
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })

    expect(view.textContent).not.toContain('inconnue')
    // Le 2e evenement est logue une seconde apres le 1er : sa position est un fait, pas un 0.
    expect(view.textContent).toContain('a +1 s')
  })

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
    // La racine est DATÉE, plus jamais le passe-partout « Demande utilisateur » commun à toutes.
    expect(view.textContent).toMatch(/Demande du \d{2}\/\d{2}\/\d{4}/)
    expect(view.textContent).not.toContain('Demande utilisateur')
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
    ).toEqual(new Set(['request', 'workspace', 'skill', 'agent', 'git', 'closure']))
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
    const agent = view.querySelector('[data-execution-node="direct-message"]')

    // LISSÉ (demande du 2026-10-12) : un chat direct sans skill est le cas NORMAL. « aucune skill ·
    // chat direct · orchestrator » s'écrivait sous chaque bloc sans rien apprendre : le bloc dit
    // désormais seulement « Orchestrateur », et ni l'outil ni lui ne portent de ligne vide de sens.
    expect(agent?.querySelector('.workflow-execution-node-title')?.textContent).toBe(
      'Orchestrateur'
    )
    expect(agent?.querySelector('.workflow-execution-node-meta')).toBeNull()
    expect(view.textContent).not.toContain('aucune skill')
    expect(view.textContent).not.toContain('chat direct')
    expect(view.textContent).not.toContain('codex')
    expect(
      view.querySelector('[data-execution-node="direct-tool"] .workflow-execution-node-meta')
    ).toBeNull()
  })

  it('écrit le « ×N » d’un regroupement HORS du titre coupable, au pluriel', async () => {
    const lecture = (id: string, sequence: number, parentId?: string) =>
      trace(id, sequence, {
        type: 'tool-call',
        parentId,
        actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
        provider: undefined,
        execution: undefined,
        metrics: undefined,
        payloads: [{ kind: 'tool-call', name: 'brain_read', content: '' }]
      })
    const causalTrace = vi.fn().mockResolvedValue([
      trace('appel', 1, {
        type: 'message',
        actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
        provider: { id: 'claude', model: 'claude-opus-5-5' },
        execution: undefined
      }),
      lecture('lu-1', 2, 'appel'),
      lecture('lu-2', 3, 'lu-1'),
      lecture('lu-3', 4, 'lu-2')
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })
    const titre = view.querySelector('[data-execution-node="lu-1"] .workflow-execution-node-title')

    // Panneau de 388 px : le nom se coupe s'il le faut (le <b>), le nombre reste entier à côté.
    expect(titre?.querySelector('b')?.textContent).toBe('Notes lues')
    expect(titre?.querySelector('b')?.textContent).not.toContain('×')
    expect(titre?.querySelector('[data-execution-count]')?.textContent).toBe('×3')
    expect(view.querySelector('[data-execution-node="lu-1"]')?.getAttribute('title')).toBe(
      'Notes lues ×3 — terminé'
    )
  })

  it('nomme la skill invoquée par une commande au lieu de « aucune skill »', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('direct-message', 1, {
        type: 'message',
        actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
        provider: { id: 'claude', model: 'claude-opus-5-5' },
        execution: undefined,
        payloads: [{ kind: 'user-message', content: 'UTILISATEUR: /draft moi le graph parfait' }]
      })
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })

    expect(
      view.querySelector('[data-execution-node="direct-message"] .workflow-execution-skill')
        ?.textContent
    ).toBe('skill · draft')
  })

  it('ne peint pas en rouge une étape annulée : un Stop n’est pas un échec', () => {
    const css = readFileSync(join(__dirname, 'WorkflowExecutionGraph.css'), 'utf8')
    const regleRouge = css.match(/[^{}]*\{[^{}]*background:\s*var\(--err\)[^{}]*\}/)?.[0] ?? ''

    expect(regleRouge).toContain('.is-failed')
    expect(regleRouge).not.toContain('.is-cancelled')
    expect(css).toMatch(/\.is-cancelled \.workflow-execution-dot[^{]*\{[^}]*var\(--text-faint\)/)
  })

  /**
   * L'ARBRE ÉTOILÉ (conv-234) : la flèche en L entre deux cartes est remplacée par un lien courbe
   * de perle à perle. Chaque étape qui a un parent DOIT avoir son lien, sinon une perle flotte
   * sans qu'on sache d'où elle vient ; et le flux ne coule QUE vers ce qui tourne.
   */
  it('relie chaque étape à son parent et fait couler le flux vers ce qui tourne', async () => {
    const causalTrace = vi.fn().mockResolvedValue(executionRunTrace({ agent: 'running' }))
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })
    // En direct : hors direct, une étape restée « en cours » est requalifiée « interrompue ».
    const view = await render({ conversationId: 'conv-a', active: true, live: true })

    const enfants = [...view.querySelectorAll('[data-execution-node]')].filter(
      (node) => !node.classList.contains('is-racine')
    )
    expect(enfants.length).toBeGreaterThan(0)
    for (const node of enfants) {
      const id = node.getAttribute('data-execution-node')
      const lien = view.querySelector(`[data-execution-edge="${id}"]`)
      expect(lien, `lien vers ${id}`).not.toBeNull()
      expect(lien?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+C/)
    }
    const agent = view.querySelector('[data-execution-kind="agent"]')
    expect(agent?.className).toContain('is-running')
    expect(agent?.className).toContain('is-actif')
    // Le flux suit le lien de l'agent qui tourne, et pas celui d'une étape terminée.
    const fluxAgent = view
      .querySelector(`[data-execution-edge="${agent?.getAttribute('data-execution-node')}"]`)
      ?.parentElement?.querySelector('.workflow-execution-flux')
    expect(fluxAgent).not.toBeNull()
    // Une étape HORS du chemin de ce qui tourne (la clôture, sous l'agent) ne reçoit aucun flux.
    // Le dépôt, lui, est désormais sous la demande (2026-10-12) : il est SUR ce chemin, son flux
    // est donc attendu.
    const cloture = view.querySelector('[data-execution-kind="closure"]')
    expect(cloture).not.toBeNull()
    expect(
      view
        .querySelector(`[data-execution-edge="${cloture?.getAttribute('data-execution-node')}"]`)
        ?.parentElement?.querySelector('.workflow-execution-flux')
    ).toBeNull()
  })

  it('peint les perles par jetons de thème, le bleu plein, sans couleur écrite en dur', () => {
    const css = readFileSync(join(__dirname, 'WorkflowExecutionGraph.css'), 'utf8')
    // Le dégradé de la perle part du bleu du thème, sans transparence sur lui (conv-182).
    expect(css).toMatch(/linear-gradient\(135deg, var\(--wx-froid\), var\(--wx-chaud\)\)/)
    expect(css).not.toMatch(/--wx-froid\)?\s*\d+%/)
    // Les seules couleurs écrites en dur sont les replis des jetons, déclarés sur le conteneur.
    const horsJetons = css
      .split('\n')
      .filter((ligne) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(ligne))
      .filter((ligne) => !/^\s*--wx-/.test(ligne))
    expect(horsJetons.filter((ligne) => /wx|perle|flux|fil/i.test(ligne))).toEqual([])
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
      .mockResolvedValueOnce([
        trace('root', 1),
        // Un AUTRE outil : deux `npm test` d'affilée se regrouperaient en un seul bloc « ×2 ».
        trace('next', 2, {
          parentId: 'root',
          payloads: [{ kind: 'tool-call', content: 'contenu sensible', name: 'npm run lint' }]
        })
      ])
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
          actor: { id: 'execution-supervisor', kind: 'system', label: 'Execution supervisor' },
          metrics: { durationMs: 4200, costUsd: 0.12 }
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
    // Le bilan tardif n'est plus un bloc (2026-10-12) : sa durée et son coût s'affichent SOUS la
    // demande. Les voir apparaître prouve que l'usage tardif a bien été relu.
    expect(container?.querySelector('[data-execution-node="chat-late-usage"]')).toBeNull()
    expect(container?.querySelector('[data-execution-totals]')?.textContent).toBe('4,2 s · 0,12 $')
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

  /**
   * UNE DEMANDE SIMPLE, SANS RUN.md : le clic sur la brique montre le prompt envoyé et le retour
   * (demande du 2026-09-23) — la trace causale suffit, aucun RUN.md n'est lu.
   */
  it('montre le prompt envoyé et le retour de l’étape dans le détail d’un nœud', async () => {
    const causalTrace = vi.fn().mockResolvedValue([
      trace('agent', 1, {
        turnId: 'turn-latest',
        type: 'handoff',
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-build' }
      }),
      trace('appel', 2, {
        turnId: 'turn-latest',
        parentId: 'agent',
        type: 'message',
        payloads: [
          { kind: 'user-message', content: 'corrige le bouton Envoyer' },
          { kind: 'tool-call', content: 'contenu sensible' }
        ]
      }),
      trace('reponse', 3, {
        turnId: 'turn-latest',
        parentId: 'agent',
        type: 'model-response',
        payloads: [{ kind: 'model-response', content: 'bouton corrigé dans Composer.tsx' }]
      })
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    const view = await render({ conversationId: 'conv-a', active: true })
    await act(async () =>
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
    )
    const detail = view.querySelector('.workflow-execution-detail')
    // La fiche est ACCROCHÉE à son étape (choix « Fil holo », conv-234) : elle porte l'étape
    // qu'elle décrit, un fil part de cette étape, et elle se glisse juste sous sa ligne — pas en
    // bas de tout l'arbre (le détail du 2026-09-23 voulait déjà la brique dépliée sur place).
    expect(detail?.getAttribute('data-execution-detail-of')).toBe('agent')
    expect(view.querySelector('[data-execution-fil="agent"]')).not.toBeNull()
    const bandeDuNoeud = view.querySelector('[data-execution-node="agent"]')?.parentElement
    expect(bandeDuNoeud?.nextElementSibling).toBe(detail)
    expect(detail?.querySelector('[data-execution-prompt]')?.textContent).toContain(
      'corrige le bouton Envoyer'
    )
    expect(detail?.querySelector('[data-execution-response]')?.textContent).toContain(
      'bouton corrigé dans Composer.tsx'
    )
    expect(detail?.textContent).not.toContain('contenu sensible')
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
    // La fixture porte une charge d'OUTIL (« contenu sensible »). Le pli ne doit pas seulement être
    // absent : le détail ouvert ne doit RIEN laisser fuiter de cette charge — c'est la raison d'être
    // du filtre sur `reasoning` au rendu.
    expect(view.querySelector('.workflow-execution-detail')?.textContent).not.toContain(
      'contenu sensible'
    )
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
  /**
   * LE GRAPHE DOIT POUVOIR PILOTER LE PANNEAU.
   *
   * Tant que la sélection reste enfermée dans le composant, le graphe ne peut pas remplacer les
   * onglets : rien en dehors de lui ne sait sur QUOI l'utilisateur est descendu. Il publie donc sa
   * sélection — identité, nature du nœud, run et tour observés — sans rien décider de l'affichage.
   */
  it('publie la sélection d’un nœud, et sa désélection', async () => {
    const onSelect = vi.fn()
    const causalTrace = vi.fn().mockResolvedValue([
      trace('agent', 1, {
        turnId: 'turn-latest',
        type: 'handoff',
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-build' }
      })
    ])
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(WorkflowExecutionGraph, {
          conversationId: 'conv-a',
          active: true,
          onSelect
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const node = container.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')
    await act(async () => node?.click())

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent', kind: 'agent', turnId: 'turn-latest' })
    )

    await act(async () => node?.click())
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })
})

/**
 * LE GRAPHE NE RAPATRIE PLUS LES CONTENUS QU'IL N'AFFICHE PAS (scout du 2026-10-10).
 *
 * Relu chaque seconde en direct, `causalTrace` copiait toute la conversation, prompts compris — 409 Mo
 * sérialisés sur conv-72, et 23 gels de l'app attribués à ce canal. Le graphe lit désormais la trace
 * SANS contenus, et ne demande les charges d'une étape qu'au moment où on l'ouvre.
 */
describe('WorkflowExecutionGraph — trace allégée, détail à la demande', () => {
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

  async function render(live = false): Promise<HTMLDivElement> {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(WorkflowExecutionGraph, { conversationId: 'conv-a', active: true, live })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  // Ce que rend `os:causalTrace:graphe` : la structure, contenus vidés.
  const structure = (): HarnessTraceEvent[] => [
    trace('agent', 1, {
      turnId: 'turn-latest',
      type: 'handoff',
      execution: { phase: 'build', agentId: 'builder', taskId: 'task-build' },
      payloads: []
    }),
    trace('appel', 2, {
      turnId: 'turn-latest',
      parentId: 'agent',
      type: 'message',
      payloads: [{ kind: 'user-message', content: '' }]
    }),
    trace('reponse', 3, {
      turnId: 'turn-latest',
      parentId: 'agent',
      type: 'model-response',
      payloads: [{ kind: 'model-response', content: '' }]
    })
  ]

  it('lit la structure par le canal allégé, jamais la trace complète', async () => {
    const causalTrace = vi.fn().mockResolvedValue([])
    const causalTraceGraphe = vi.fn().mockResolvedValue(structure())
    const causalTraceCharges = vi.fn().mockResolvedValue({})
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace, causalTraceGraphe, causalTraceCharges }
    })

    const view = await render()

    expect(causalTraceGraphe).toHaveBeenCalledWith('conv-a')
    expect(causalTrace).not.toHaveBeenCalled()
    expect(causalTraceCharges).not.toHaveBeenCalled()
    expect(view.querySelector('[data-execution-node="agent"]')).not.toBeNull()
  })

  it('charge au clic les charges de l’étape, dans l’ordre, aux seuls genres du détail', async () => {
    const charges = deferred<Record<string, Array<{ kind: string; content: string }>>>()
    const causalTraceCharges = vi.fn().mockReturnValue(charges.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(structure()),
        causalTraceCharges
      }
    })
    const view = await render()

    await act(async () =>
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
    )

    expect(causalTraceCharges).toHaveBeenCalledTimes(1)
    const [conversationId, eventIds, kinds] = causalTraceCharges.mock.calls[0]
    expect(conversationId).toBe('conv-a')
    expect(eventIds).toEqual(['agent', 'appel', 'reponse'])
    expect([...kinds].sort()).toEqual(
      ['error', 'model-response', 'reasoning', 'system-instruction', 'user-message'].sort()
    )
    expect(view.querySelector('[data-execution-exchange="chargement"]')).not.toBeNull()

    await act(async () => {
      charges.resolve({
        appel: [{ kind: 'user-message', content: 'corrige le bouton Envoyer' }],
        reponse: [{ kind: 'model-response', content: 'bouton corrigé dans Composer.tsx' }]
      })
      await charges.promise
    })
    const detail = view.querySelector('.workflow-execution-detail')
    expect(detail?.querySelector('[data-execution-prompt]')?.textContent).toContain(
      'corrige le bouton Envoyer'
    )
    expect(detail?.querySelector('[data-execution-response]')?.textContent).toContain(
      'bouton corrigé dans Composer.tsx'
    )
  })

  it('ne relit pas les charges d’une étape ouverte à chaque seconde du direct', async () => {
    vi.useFakeTimers()
    const causalTraceGraphe = vi.fn().mockResolvedValue(structure())
    const causalTraceCharges = vi.fn().mockResolvedValue({
      reponse: [{ kind: 'model-response', content: 'retour' }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { causalTrace: vi.fn(), causalTraceGraphe, causalTraceCharges }
    })
    const view = await render(true)
    await act(async () =>
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(causalTraceGraphe.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(causalTraceCharges).toHaveBeenCalledTimes(1)
  })

  it('dit que le détail est indisponible quand la lecture des charges échoue', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(structure()),
        causalTraceCharges: vi.fn().mockRejectedValue(new Error('trace corrompue ligne 3'))
      }
    })
    const view = await render()

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
      await Promise.resolve()
    })

    expect(view.querySelector('[data-execution-exchange="erreur"]')?.textContent).toContain(
      'trace corrompue ligne 3'
    )
  })

  /*
   * « Aucun prompt ni retour enregistré » sous 377 briques sur 682 (17 conversations, 2026-10-12) :
   * la Demande n'avait AUCUNE source — 252 sur 252 —, et la phrase s'écrivait aussi sous les gestes
   * d'outil et la réponse affichée, qui n'ont pas d'échange par nature.
   */
  it('montre ma demande EN ENTIER sous la brique Demande, sans l’état de l’app', async () => {
    const light = structure()
    // Ce que la trace allégée garde d'un message : l'extrait borné, coupé au premier paragraphe.
    light[1] = {
      ...light[1],
      payloads: [
        { kind: 'user-message', content: 'UTILISATEUR: <message_utilisateur>premier paragraphe' }
      ]
    }
    const causalTraceCharges = vi.fn().mockResolvedValue({
      appel: [
        {
          kind: 'user-message',
          content:
            'ÉTAT DE L\'APP:\n{"secret":"x"}\n\nUTILISATEUR: <message_utilisateur>premier paragraphe\n\nsecond paragraphe</message_utilisateur>\n\n(Réponds à l’utilisateur / agis.)'
        }
      ]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(light),
        causalTraceCharges
      }
    })
    const view = await render()

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-kind="request"]')?.click()
      await Promise.resolve()
    })

    expect(causalTraceCharges).toHaveBeenCalledTimes(1)
    expect(causalTraceCharges.mock.calls[0][1]).toEqual(['appel'])
    const demande = view.querySelector('.workflow-execution-detail [data-execution-demande]')
    expect(demande?.querySelector('summary')?.textContent).toBe('Ta demande')
    expect(demande?.querySelector('pre')?.textContent).toBe(
      'premier paragraphe\n\nsecond paragraphe'
    )
    expect(view.querySelector('.workflow-execution-detail')?.textContent).not.toContain('secret')
    expect(view.querySelector('[data-execution-exchange="vide"]')).toBeNull()
  })

  it('ne dit « aucun prompt » que sous un agent, jamais sous un geste d’outil', async () => {
    const light = [
      ...structure(),
      trace('geste', 4, {
        turnId: 'turn-latest',
        parentId: 'agent',
        type: 'tool-call',
        payloads: [{ kind: 'tool-call', name: 'Read', content: '' }]
      })
    ]
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(light),
        causalTraceCharges: vi.fn().mockResolvedValue({})
      }
    })
    const view = await render()

    const geste = view.querySelector<HTMLButtonElement>('[data-execution-kind="tool"]')
    expect(geste).not.toBeNull()
    await act(async () => {
      geste?.click()
      await Promise.resolve()
    })
    expect(view.querySelector('.workflow-execution-detail')).not.toBeNull()
    expect(view.querySelector('[data-execution-exchange="vide"]')).toBeNull()
    // Un geste propre de l'agent est écrit sans contenu : le détail le DIT, il ne reste pas muet.
    expect(
      view.querySelector('[data-execution-exchange="geste-sans-contenu"]')?.textContent
    ).toContain('seuls son nom, son issue et sa durée')

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
      await Promise.resolve()
    })
    expect(view.querySelector('[data-execution-exchange="vide"]')?.textContent).toContain(
      'Aucun prompt ni retour enregistré'
    )
  })

  // « je vois fait retenu mais quand je clique dessus je voudrais voir quel fait » (2026-10-12).
  const avecRemember = (genre = 'tool-result', status = 'completed'): HarnessTraceEvent[] => [
    ...structure(),
    trace('retenir', 4, {
      turnId: 'turn-latest',
      parentId: 'agent',
      type: 'tool-call',
      payloads: [{ kind: 'tool-call', name: 'remember', content: '' }]
    }),
    trace('retenu', 5, {
      turnId: 'turn-latest',
      parentId: 'retenir',
      type: 'tool-result',
      status,
      actor: { id: 'remember', kind: 'tool', label: 'remember' },
      payloads: [{ kind: genre, name: 'remember', content: '' }]
    })
  ]

  // Un dépôt REFUSÉ est un échec de la commande : la trace range sa réponse en `error`, sur un
  // résultat `failed` (conv-927). C'est ce cas qui affichait « texte du fait illisible » (conv-966).
  async function ouvrirFaitRetenu(reponse: unknown, genre = 'tool-result', status = 'completed') {
    const causalTraceCharges = vi.fn().mockResolvedValue({
      retenu: [
        {
          kind: genre,
          name: 'remember',
          content: typeof reponse === 'string' ? reponse : JSON.stringify(reponse)
        }
      ]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(avecRemember(genre, status)),
        causalTraceCharges
      }
    })
    const view = await render()
    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-kind="tool"]')?.click()
      await Promise.resolve()
    })
    return { view, causalTraceCharges }
  }

  it('montre QUEL fait a été retenu, lu dans la réponse de remember — jamais ses arguments', async () => {
    const { view, causalTraceCharges } = await ouvrirFaitRetenu({
      allowed: true,
      stored: true,
      detail: 'retenu comme CANDIDAT dans la boîte de réception du Brain',
      fact: { title: 'Le graphe montre le fait', body: 'Premier paragraphe.\n\nSecond paragraphe.' }
    })

    expect(causalTraceCharges.mock.calls[0][1]).toEqual(['retenu'])
    // Les réponses en échec aussi, jamais les arguments (`tool-call`).
    expect(causalTraceCharges.mock.calls[0][2]).toEqual(['tool-result', 'error'])
    const fait = view.querySelector('.workflow-execution-detail [data-execution-fait]')
    expect(fait?.querySelector('summary')?.textContent).toBe('Fait retenu')
    expect(fait?.querySelector('.workflow-execution-fait-titre')?.textContent).toBe(
      'Le graphe montre le fait'
    )
    expect(fait?.querySelector('pre')?.textContent).toBe(
      'Premier paragraphe.\n\nSecond paragraphe.'
    )
    expect(fait?.querySelector('.workflow-execution-fait-issue')?.textContent).toContain('CANDIDAT')
  })

  it('un fait refusé ne montre que le motif du refus, jamais son texte', async () => {
    const { view } = await ouvrirFaitRetenu({
      allowed: false,
      reason: 'refusé localement : le fait semble contenir un jeton'
    })

    const detail = view.querySelector('.workflow-execution-detail')
    expect(detail?.querySelector('[data-execution-fait]')).toBeNull()
    expect(detail?.querySelector('[data-execution-fait-refuse]')?.textContent).toBe(
      'Non retenu · refusé localement : le fait semble contenir un jeton'
    )
  })

  it('un dépôt en échec montre POURQUOI, au lieu de réclamer le texte du fait', async () => {
    const { view } = await ouvrirFaitRetenu(
      { allowed: false, stored: false, reason: 'source invalide : chemin relatif refusé' },
      'error',
      'failed'
    )

    const detail = view.querySelector('.workflow-execution-detail')
    expect(detail?.querySelector('[data-execution-exchange="fait-illisible"]')).toBeNull()
    expect(detail?.querySelector('[data-execution-fait-refuse]')?.textContent).toBe(
      'Non retenu · source invalide : chemin relatif refusé'
    )
  })

  // « fais que chaque étape rouge du graphe dise pourquoi elle a échoué » (conv-966) : la cause est
  // en tête de la fiche, entière, sans avoir à ouvrir le bloc « Erreur » voisin.
  it('une étape rouge dit pourquoi en tête de sa fiche', async () => {
    const cause = 'Claude a interrompu l’appel : You’ve hit your session limit · resets 1pm'
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue([
          trace('appel', 1, {
            turnId: 'turn-latest',
            type: 'message',
            channel: 'user',
            actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
            provider: { id: 'claude', model: 'claude-opus-5-5' },
            payloads: [{ kind: 'user-message', content: '' }]
          }),
          trace('erreur', 2, {
            turnId: 'turn-latest',
            parentId: 'appel',
            type: 'error',
            status: 'failed',
            channel: 'internal',
            // La trace allégée garde l'extrait de la cause d'une étape en échec (`trace-allegee.ts`).
            payloads: [{ kind: 'error', content: cause }]
          })
        ]),
        causalTraceCharges: vi.fn().mockResolvedValue({})
      }
    })
    const view = await render()
    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-node="appel"]')?.click()
      await Promise.resolve()
    })

    expect(
      view.querySelector('.workflow-execution-detail [data-execution-pourquoi]')?.textContent
    ).toBe(`Pourquoi · ${cause}`)
  })

  it('un fait refusé par le Brain se dit gardé dans le fil seulement, avec la raison', async () => {
    const { view } = await ouvrirFaitRetenu(
      {
        allowed: true,
        stored: false,
        detail: 'refusé par le Brain : likely personal data detected; candidate rejected',
        fact: { title: 'Dépôt GitHub', body: 'Seule la version courante compte.' }
      },
      'error',
      'failed'
    )

    const fait = view.querySelector('.workflow-execution-detail [data-execution-fait]')
    expect(fait?.querySelector('summary')?.textContent).toBe(
      'Fait retenu · gardé dans ce fil, pas au Brain'
    )
    expect(fait?.querySelector('.workflow-execution-fait-issue')?.textContent).toBe(
      'refusé par le Brain : likely personal data detected; candidate rejected'
    )
  })

  // « pareil pour toutes les pastilles, je dois voir ce qui est fait en détail quand je déplie »
  // (2026-10-12). Le contenu n'arrive qu'au clic : l'arbre, lui, n'en reçoit toujours aucun.
  it('montre ce que chaque appel d’un outil a envoyé et reçu, chargé au clic seulement', async () => {
    const light = [
      ...structure(),
      trace('verifier', 4, {
        turnId: 'turn-latest',
        parentId: 'agent',
        type: 'tool-call',
        payloads: [{ kind: 'tool-call', name: 'verify', content: '' }]
      }),
      trace('verifie', 5, {
        turnId: 'turn-latest',
        parentId: 'verifier',
        type: 'tool-result',
        actor: { id: 'verify', kind: 'tool', label: 'verify' },
        payloads: [{ kind: 'tool-result', name: 'verify', content: '' }]
      })
    ]
    const causalTraceCharges = vi.fn().mockResolvedValue({
      verifier: [{ kind: 'tool-call', name: 'verify', content: '{\n  "type": "typecheck"\n}' }],
      verifie: [{ kind: 'tool-result', name: 'verify', content: '{"ok":true,"exitCode":0}' }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(light),
        causalTraceCharges
      }
    })
    const view = await render()
    expect(view.textContent).not.toContain('typecheck')

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-kind="tool"]')?.click()
      await Promise.resolve()
    })

    expect(causalTraceCharges.mock.calls[0][1]).toEqual(['verifier', 'verifie'])
    expect(causalTraceCharges.mock.calls[0][2]).toEqual(['tool-call', 'tool-result', 'error'])
    const appel = view.querySelector('.workflow-execution-detail [data-execution-appel]')
    expect(appel?.querySelector('summary')?.textContent).toBe('Appel')
    expect(appel?.querySelector('[data-execution-appel-envoye]')?.textContent).toBe(
      '{\n  "type": "typecheck"\n}'
    )
    expect(appel?.querySelector('[data-execution-appel-retour]')?.textContent).toBe(
      '{"ok":true,"exitCode":0}'
    )
  })

  it('montre le texte d’une « Réponse affichée » sous sa brique', async () => {
    const light = [
      ...structure(),
      trace('affichee', 4, {
        turnId: 'turn-latest',
        parentId: 'reponse',
        type: 'response-displayed',
        channel: 'assistant',
        actor: { id: 'autowin-renderer', kind: 'system', label: 'Interface Autowin' },
        recipient: { id: 'human', kind: 'human', label: 'Utilisateur' },
        payloads: [{ kind: 'model-response', content: '' }]
      })
    ]
    const causalTraceCharges = vi.fn().mockResolvedValue({
      affichee: [{ kind: 'model-response', content: 'C’est corrigé : la brique montre le fait.' }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(light),
        causalTraceCharges
      }
    })
    const view = await render()

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-node="affichee"]')?.click()
      await Promise.resolve()
    })

    expect(causalTraceCharges.mock.calls[0][1]).toEqual(['affichee'])
    const texte = view.querySelector('.workflow-execution-detail [data-execution-response]')
    expect(texte?.querySelector('summary')?.textContent).toBe('Texte affiché')
    expect(texte?.querySelector('pre')?.textContent).toBe(
      'C’est corrigé : la brique montre le fait.'
    )
  })

  /*
   * « plein de nodes qui ont une erreur et pas de contenu, surtout pendant les orchestrations »
   * (2026-10-13). Un sous-agent EN COURS n'a pas de durée ni de retour : ni l'un ni l'autre n'est un
   * défaut. Sa fiche montre le prompt écrit au démarrage et dit que le retour viendra ; la phase
   * garde sa limite connue, en ton neutre. Forme du démarrage reprise de conv-913 (build:minimal).
   */
  it('orchestration en cours : prompt affiché, retour attendu, aucun orange sans défaut', async () => {
    const light = executionRunTrace({ agent: 'running' }).map((event) =>
      event.id === 'run-agent-running'
        ? {
            ...event,
            metrics: undefined,
            payloads: [
              { kind: 'app-state', content: '' },
              { kind: 'user-message', content: '' }
            ]
          }
        : event
    )
    const causalTraceCharges = vi.fn().mockResolvedValue({
      'run-agent-running': [{ kind: 'user-message', content: 'MISSION DU SOUS-AGENT' }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(light),
        causalTraceCharges
      }
    })
    const view = await render(true)

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-kind="agent"]')?.click()
      await Promise.resolve()
    })
    const fiche = view.querySelector('.workflow-execution-detail')
    expect(fiche?.querySelector('[data-execution-prompt] pre')?.textContent).toBe(
      'MISSION DU SOUS-AGENT'
    )
    expect(
      fiche?.querySelector('[data-execution-exchange="retour-attendu"]')?.textContent
    ).toContain('son retour s’affichera à sa fin')
    expect(fiche?.querySelector('[data-execution-exchange="vide"]')).toBeNull()
    expect(fiche?.querySelector('.workflow-execution-warning')).toBeNull()

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-kind="skill"]')?.click()
      await Promise.resolve()
    })
    const phase = view.querySelector('.workflow-execution-detail')
    expect(phase?.querySelector('.workflow-execution-warning')).toBeNull()
    expect(phase?.querySelector('[data-execution-note]')?.textContent).toContain(
      'Le runtime transporte la phase'
    )
  })

  /*
   * SOUS-AGENT D'UN RUN ORCHESTRÉ (scout du 2026-10-10, conv-193). Son prompt est relié par TENTATIVE
   * (`attemptId`), pas par parenté, et sa cause d'échec est écrite sur le relais en échec. Avant : la
   * carte taisait la cause et le clic disait « Aucun prompt ni retour enregistré ». Formes reprises
   * des traces réelles conv-139 (sous-agent réussi) et conv-163 (`scout:dette` en échec).
   */
  it('sous-agent de run : cause d’échec sur la carte, prompt et retour unique au clic', async () => {
    const cause = 'checkpoint orchestration causalement invalide : liens de reservation incoherents'
    const execution = (attemptId: string, agentId: string) => ({
      phase: 'scout',
      agentId,
      taskId: agentId,
      runId: 'run-1',
      attemptId
    })
    // Ce que rend `os:causalTrace:graphe` : contenus vidés, sauf l'extrait de la cause d'un échec.
    const graphe: HarnessTraceEvent[] = [
      trace('run-workspace', 1, {
        type: 'boundary',
        run: {
          runId: 'run-1',
          timestampMs: 1,
          stage: 'workspace',
          workspace: { mode: 'worktree', repositoryPath: 'C:\\repo', path: 'C:\\repo-run-1' }
        }
      }),
      trace('ok-start', 2, {
        type: 'handoff',
        status: 'running',
        execution: execution('att-ok', 'scout:ux'),
        payloads: [{ kind: 'app-state', content: '' }]
      }),
      trace('ok-prompt', 3, {
        type: 'message',
        parentId: 'outil-ailleurs',
        execution: execution('att-ok', 'scout:ux'),
        payloads: [{ kind: 'user-message', content: '' }]
      }),
      trace('ok-outil', 4, {
        type: 'tool-call',
        execution: execution('att-ok', 'scout:ux'),
        payloads: [{ kind: 'error', content: '' }]
      }),
      trace('ok-reponse', 5, {
        type: 'model-response',
        execution: execution('att-ok', 'scout:ux'),
        payloads: [{ kind: 'model-response', content: '' }]
      }),
      trace('ok-end', 6, {
        type: 'handoff',
        execution: execution('att-ok', 'scout:ux'),
        payloads: [{ kind: 'model-response', content: '' }]
      }),
      trace('ko-fail', 7, {
        type: 'handoff',
        status: 'failed',
        execution: execution('att-ko', 'scout:dette'),
        payloads: [{ kind: 'model-response', content: cause }]
      })
    ]
    const causalTraceCharges = vi.fn().mockResolvedValue({
      'ok-prompt': [{ kind: 'user-message', content: 'PROMPT DU SOUS-AGENT' }],
      'ok-reponse': [{ kind: 'model-response', content: 'RETOUR DU SOUS-AGENT' }],
      'ok-end': [{ kind: 'model-response', content: 'RETOUR DU SOUS-AGENT' }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn(),
        causalTraceGraphe: vi.fn().mockResolvedValue(graphe),
        causalTraceCharges
      }
    })
    const view = await render()

    const echec = view.querySelector('[data-execution-node="agent:run-1:att-ko"]')
    expect(echec?.querySelector('[data-execution-failure]')?.textContent).toBe(cause)
    expect(
      view.querySelector('[data-execution-node="agent:run-1:att-ok"] [data-execution-failure]')
    ).toBeNull()

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent:run-1:att-ok"]')?.click()
      await Promise.resolve()
    })

    const [, eventIds] = causalTraceCharges.mock.calls[0]
    expect(eventIds).toEqual(['ok-start', 'ok-prompt', 'ok-reponse', 'ok-end'])
    const detail = view.querySelector('.workflow-execution-detail')
    expect(detail?.querySelector('[data-execution-exchange="vide"]')).toBeNull()
    expect(detail?.querySelector('[data-execution-prompt]')?.textContent).toContain(
      'PROMPT DU SOUS-AGENT'
    )
    expect(detail?.querySelectorAll('[data-execution-response] pre')).toHaveLength(1)
  })

  // fix-ok: test ajouté (cas limite 14), pas un correctif ; mesuré : repli remplacé par `Promise.resolve([])` dans WorkflowExecutionGraph.tsx:567, ce test échoue (code 1), restauré il passe
  /*
   * LE REPLI DU MODE DEV. L'écran se recharge à chaud, pas le pont : tant qu'on n'a pas redémarré,
   * `causalTraceGraphe`/`causalTraceCharges` n'existent pas. Le graphe doit alors relire la trace
   * complète comme avant et montrer le détail depuis elle — plus lent, jamais vide.
   */
  it('sans les lectures allégées dans le pont, relit la trace complète et montre le détail', async () => {
    const complete = structure().map((event) =>
      event.id === 'appel'
        ? { ...event, payloads: [{ kind: 'user-message', content: 'PROMPT-REPLI' }] }
        : event
    )
    const causalTrace = vi.fn().mockResolvedValue(complete)
    Object.defineProperty(window, 'api', { configurable: true, value: { causalTrace } })
    const view = await render()

    expect(causalTrace).toHaveBeenCalledWith('conv-a')
    expect(view.querySelector('[data-execution-node="agent"]')).not.toBeNull()

    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-execution-node="agent"]')?.click()
      await Promise.resolve()
    })

    expect(view.querySelector('[data-execution-exchange="chargement"]')).toBeNull()
    expect(
      view.querySelector('.workflow-execution-detail [data-execution-prompt]')?.textContent
    ).toContain('PROMPT-REPLI')
    expect(causalTrace).toHaveBeenCalledTimes(1)
  })
})
