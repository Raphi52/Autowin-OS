import { describe, expect, it } from 'vitest'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'
import { projectLatestRequestExecution } from './request-execution-tree-model'

function trace(
  id: string,
  turnId: string,
  sequence: number,
  overrides: Partial<HarnessTraceEvent> = {}
): HarnessTraceEvent {
  return {
    id,
    conversationId: 'conv-1',
    turnId,
    timestamp: `2026-07-30T12:00:${String(sequence).padStart(2, '0')}.000Z`,
    sequence,
    type: 'handoff',
    status: 'completed',
    channel: 'internal',
    actor: { id: 'builder', kind: 'agent', label: 'Builder' },
    recipient: { id: 'orchestrator', kind: 'agent', label: 'Orchestrator' },
    payloads: [{ kind: 'app-state', content: 'payload privé' }],
    observation: { boundary: 'orchestration', fidelity: 'exact' },
    provider: { id: 'codex', model: 'gpt-5.6-codex' },
    metrics: { durationMs: 800 },
    ...overrides
  }
}

describe('projectLatestRequestExecution', () => {
  it('borne le graphe au tour le plus récent et crée une racine Demande unique', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('old-agent', 'turn-old', 1, {
        timestamp: '2026-07-30T11:00:00.000Z',
        actor: { id: 'old', kind: 'agent', label: 'Ancien agent' }
      }),
      trace('new-agent', 'turn-new', 2, {
        parentId: 'old-agent',
        execution: { phase: 'build', agentId: 'builder', taskId: 'task-new' }
      })
    ])

    const projection = projectLatestRequestExecution(timeline, {
      requestLabel: 'Corrige la vue Graphe'
    })

    expect(projection.turnId).toBe('turn-new')
    expect(projection.events.filter((event) => event.display?.kind === 'request')).toHaveLength(1)
    expect(projection.events.map((event) => event.id)).not.toContain('old-agent')
    expect(projection.events.map((event) => event.actor)).not.toContain('Ancien agent')
    expect(projection.events.find((event) => event.id === 'new-agent')).toMatchObject({
      parentId: 'request:turn-new:phase:build',
      provider: 'codex',
      model: 'gpt-5.6-codex'
    })
  })

  it('représente un fan-out comme des agents frères sous la même phase', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('agent-a', 'turn-1', 1, {
        actor: { id: 'scout-a', kind: 'agent', label: 'Scout A' },
        execution: { phase: 'scout', agentId: 'scout-a', taskId: 'a', groupId: 'scout-panel' }
      }),
      trace('agent-b', 'turn-1', 2, {
        actor: { id: 'scout-b', kind: 'agent', label: 'Scout B' },
        provider: { id: 'claude', model: 'claude-opus-4-8' },
        execution: { phase: 'scout', agentId: 'scout-b', taskId: 'b', groupId: 'scout-panel' }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    const phase = projection.events.find((event) => event.display?.kind === 'phase')
    const agents = projection.events.filter((event) => event.display?.kind === 'agent')

    expect(phase?.label).toBe('Scout')
    expect(agents).toHaveLength(2)
    expect(agents.map((event) => event.parentId)).toEqual([phase?.id, phase?.id])
    expect(agents.map((event) => `${event.actor}:${event.provider}:${event.model}`)).toEqual([
      'Scout A:codex:gpt-5.6-codex',
      'Scout B:claude:claude-opus-4-8'
    ])
  })

  it('ne fabrique pas de causalité entre deux phases indépendantes', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('build-agent', 'turn-1', 1, {
        execution: { phase: 'build', agentId: 'builder', taskId: 'build-1' }
      }),
      trace('judge-agent', 'turn-1', 2, {
        type: 'verdict',
        actor: { id: 'judge', kind: 'agent', label: 'Judge' },
        execution: { phase: 'judge', agentId: 'judge', taskId: 'judge-1' }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    const phases = projection.events.filter((event) => event.display?.kind === 'phase')

    expect(phases.map((event) => [event.execution?.phase, event.parentId])).toEqual([
      ['build', 'request:turn-1'],
      ['judge', 'request:turn-1']
    ])
  })

  it('conserve le parent observé lors d’une convergence multi-dépendances', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('agent-a', 'turn-1', 1, {
        execution: { phase: 'build', agentId: 'a', taskId: 'a' }
      }),
      trace('agent-b', 'turn-1', 2, {
        execution: { phase: 'build', agentId: 'b', taskId: 'b' }
      }),
      trace('agent-c', 'turn-1', 3, {
        parentId: 'agent-b',
        execution: {
          phase: 'build',
          agentId: 'c',
          taskId: 'c',
          dependencyIds: ['a', 'b']
        }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)

    expect(projection.events.find((event) => event.id === 'agent-c')).toMatchObject({
      parentId: 'agent-b',
      display: { dependencyIds: ['a', 'b'] }
    })
  })

  it('présente le quorum local comme un événement sans identité provider', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('quorum', 'turn-1', 1, {
        type: 'verdict',
        actor: { id: 'judge:quorum', kind: 'system', label: 'orchestrator' },
        provider: undefined,
        execution: {
          phase: 'judge',
          agentId: 'judge:quorum',
          taskId: 'judge:quorum',
          groupId: 'judge:quorum',
          dependencyIds: ['judge:a', 'judge:b']
        }
      })
    ])

    const quorum = projectLatestRequestExecution(timeline).events.find(
      (event) => event.id === 'quorum'
    )

    expect(quorum).toMatchObject({
      provider: undefined,
      model: undefined,
      display: { kind: 'event', title: 'Agrégation locale' }
    })
  })

  it('regroupe les événements techniques d’un appel provider dans le nœud agent', () => {
    const execution = { phase: 'build', agentId: 'builder', taskId: 'build-1' }
    const timeline = buildHarnessTimelineFromTrace([
      trace('handoff', 'turn-1', 1, { execution }),
      trace('message', 'turn-1', 2, {
        parentId: 'handoff',
        type: 'message',
        execution
      }),
      trace('injection', 'turn-1', 3, {
        parentId: 'message',
        type: 'injection',
        execution
      }),
      trace('boundary', 'turn-1', 4, {
        parentId: 'injection',
        type: 'boundary',
        execution
      }),
      trace('response', 'turn-1', 5, {
        parentId: 'boundary',
        type: 'model-response',
        execution,
        metrics: { durationMs: 1250 }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)

    expect(projection.events.map((event) => event.id)).toEqual([
      'request:turn-1',
      'request:turn-1:phase:build',
      'handoff'
    ])
    expect(
      projection.events.find((event) => event.id === 'handoff')?.display?.observedEventIds
    ).toEqual(['handoff', 'message', 'injection', 'boundary', 'response'])
    expect(projection.events.find((event) => event.id === 'handoff')?.durationMs).toBe(1250)
  })

  it('propage la phase de l’agent sur toute une chaîne de cards auxiliaires', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('agent', 'turn-1', 1, {
        execution: { phase: 'build', agentId: 'builder', taskId: 'build-1' }
      }),
      trace('tool', 'turn-1', 2, {
        parentId: 'agent',
        type: 'tool-call',
        provider: undefined,
        execution: undefined
      }),
      trace('result', 'turn-1', 3, {
        parentId: 'tool',
        type: 'tool-result',
        provider: undefined,
        execution: undefined
      })
    ])

    const projection = projectLatestRequestExecution(timeline)

    expect(projection.events.find((event) => event.id === 'tool')?.display).toMatchObject({
      workflow: 'autowin',
      skillName: 'build'
    })
    expect(projection.events.find((event) => event.id === 'result')?.display).toMatchObject({
      workflow: 'autowin',
      skillName: 'build'
    })
  })

  it('reste honnête avec un chat direct sans métadonnée d’exécution', () => {
    const timeline = buildHarnessTimelineFromTrace([
      trace('message', 'turn-legacy', 1, {
        type: 'message',
        actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrator' },
        execution: undefined
      }),
      trace('response', 'turn-legacy', 2, {
        parentId: 'message',
        type: 'model-response',
        execution: undefined
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    const agent = projection.events.find((event) => event.display?.kind === 'agent')

    expect(projection.events).toHaveLength(2)
    expect(agent).toMatchObject({
      id: 'message',
      parentId: 'request:turn-legacy',
      actor: 'Orchestrator',
      provider: 'codex',
      model: 'gpt-5.6-codex'
    })
    expect(agent?.display).toMatchObject({
      workflow: 'direct'
    })
    expect(agent?.display?.skillName).toBeUndefined()
    expect(agent?.display?.limitation).toContain('Chat direct')
  })
})
