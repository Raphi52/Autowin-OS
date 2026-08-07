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

function runTrace(
  id: string,
  turnId: string,
  sequence: number,
  _runId: string,
  overrides: Record<string, unknown>
): HarnessTraceEvent {
  return trace(id, turnId, sequence, overrides as Partial<HarnessTraceEvent>) as HarnessTraceEvent
}

describe('projectLatestRequestExecution', () => {
  it('affiche le devis entre le workspace et les skills avant tout agent', () => {
    const timeline = buildHarnessTimelineFromTrace([
      runTrace('workspace', 'turn-quote', 1, 'run-quote', {
        type: 'boundary',
        execution: { runId: 'run-quote' },
        run: {
          stage: 'workspace',
          runId: 'run-quote',
          timestampMs: 100,
          workspace: {
            mode: 'worktree',
            repositoryPath: 'C:\\repo',
            path: 'C:\\worktrees\\run-quote'
          }
        }
      }),
      runTrace('quote', 'turn-quote', 2, 'run-quote', {
        type: 'decision',
        execution: { runId: 'run-quote' },
        run: {
          stage: 'quote',
          runId: 'run-quote',
          timestampMs: 110,
          quote: {
            quoteId: 'quote-1',
            regime: 'standard',
            phases: ['frame', 'build'],
            decomposition: { mode: 'disabled', maxNodes: 1 },
            limits: {
              maxProviderCalls: 12,
              maxFreshTokens: 750_000,
              maxTotalTokens: 6_000_000,
              maxAgents: 3,
              maxConcurrency: 3,
              maxDurationMs: 2_700_000,
              maxRecoveries: 1,
              maxUsd: null
            }
          }
        }
      }),
      runTrace('agent', 'turn-quote', 3, 'run-quote', {
        execution: {
          runId: 'run-quote',
          attemptId: 'attempt-1',
          phase: 'build',
          agentId: 'builder',
          taskId: 'task-1'
        }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    const quote = projection.events.find((event) => event.display?.kind === 'quote')
    const skill = projection.events.find((event) => event.display?.kind === 'skill')
    const workspace = projection.events.find(
      (event) => event.display?.kind === 'workspace' && !event.display.workspace?.root
    )

    expect(quote).toMatchObject({
      parentId: workspace?.id,
      display: { kind: 'quote', title: 'Devis d’exécution', runId: 'run-quote' }
    })
    expect(skill?.parentId).toBe(quote?.id)
  })

  it('projette deux runs sous un workspace commun sans collision entre les tours', () => {
    const workspace = (runId: string, path: string) => ({
      stage: 'workspace' as const,
      runId,
      timestampMs: 100,
      workspace: {
        mode: 'worktree' as const,
        repositoryPath: 'C:\\repo',
        path,
        baseBranch: 'main',
        baseSha: 'abc123'
      }
    })
    const timeline = buildHarnessTimelineFromTrace([
      runTrace('run-1-workspace', 'turn-1', 1, 'run-1', {
        type: 'boundary',
        run: workspace('run-1', 'C:\\worktrees\\run-1'),
        execution: { runId: 'run-1' }
      }),
      runTrace('run-1-agent', 'turn-1', 2, 'run-1', {
        execution: {
          runId: 'run-1',
          attemptId: 'attempt-1',
          phase: 'build',
          agentId: 'builder-1',
          taskId: 'task-1'
        }
      }),
      runTrace('run-2-workspace', 'turn-2', 3, 'run-2', {
        timestamp: '2026-07-30T12:01:00.000Z',
        type: 'boundary',
        run: workspace('run-2', 'C:\\worktrees\\run-2'),
        execution: { runId: 'run-2' }
      }),
      runTrace('run-2-agent', 'turn-2', 4, 'run-2', {
        timestamp: '2026-07-30T12:01:01.000Z',
        execution: {
          runId: 'run-2',
          attemptId: 'attempt-2',
          phase: 'judge',
          agentId: 'judge-2',
          taskId: 'task-2'
        }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    const workspaces = projection.events.filter((event) => event.display?.kind === 'workspace')
    const skills = projection.events.filter((event) => event.display?.kind === 'skill')
    const agents = projection.events.filter((event) => event.display?.kind === 'agent')

    expect(workspaces).toHaveLength(3)
    const commonWorkspace = workspaces.find((event) => event.display?.workspace?.mode === 'base')
    const isolatedWorkspaces = workspaces.filter(
      (event) => event.display?.workspace?.mode === 'worktree'
    )
    expect(commonWorkspace?.display?.workspace?.path).toBe('C:\\repo')
    expect(isolatedWorkspaces.map((event) => event.display?.runId).sort()).toEqual([
      'run-1',
      'run-2'
    ])
    expect(isolatedWorkspaces.map((event) => event.parentId)).toEqual([
      commonWorkspace?.id,
      commonWorkspace?.id
    ])
    expect(skills.map((event) => event.display?.runId).sort()).toEqual(['run-1', 'run-2'])
    expect(agents.map((event) => event.execution?.runId).sort()).toEqual(['run-1', 'run-2'])
    expect(new Set(projection.events.map((event) => event.id)).size).toBe(projection.events.length)
  })

  it('conserve chaque membre du fan-out, l’échec et sa reprise comme tentatives distinctes', () => {
    const timeline = buildHarnessTimelineFromTrace([
      runTrace('workspace', 'turn-1', 1, 'run-1', {
        type: 'boundary',
        execution: { runId: 'run-1' },
        run: {
          stage: 'workspace',
          runId: 'run-1',
          timestampMs: 100,
          workspace: {
            mode: 'worktree',
            repositoryPath: 'C:\\repo',
            path: 'C:\\worktrees\\run-1'
          }
        }
      }),
      runTrace('agent-a-failed', 'turn-1', 2, 'run-1', {
        status: 'failed',
        execution: {
          runId: 'run-1',
          attemptId: 'attempt-a-1',
          phase: 'build',
          agentId: 'agent-a',
          taskId: 'a',
          groupId: 'fanout'
        }
      }),
      runTrace('agent-a-retry', 'turn-1', 3, 'run-1', {
        execution: {
          runId: 'run-1',
          attemptId: 'attempt-a-2',
          phase: 'build',
          agentId: 'agent-a',
          taskId: 'a',
          groupId: 'fanout'
        }
      }),
      runTrace('agent-b', 'turn-1', 4, 'run-1', {
        execution: {
          runId: 'run-1',
          attemptId: 'attempt-b-1',
          phase: 'build',
          agentId: 'agent-b',
          taskId: 'b',
          groupId: 'fanout'
        }
      })
    ])

    const agents = projectLatestRequestExecution(timeline).events.filter(
      (event) => event.display?.kind === 'agent'
    )

    expect(agents).toHaveLength(3)
    expect(agents.map((event) => event.execution?.attemptId)).toEqual([
      'attempt-a-1',
      'attempt-a-2',
      'attempt-b-1'
    ])
    expect(agents.map((event) => event.status)).toEqual(['failed', 'completed', 'completed'])
    expect(new Set(agents.map((event) => event.parentId)).size).toBe(1)
    expect([
      ...new Set(projectLatestRequestExecution(timeline).events.map((event) => event.display?.kind))
    ]).toEqual(['workspace', 'skill', 'agent', 'closure'])
  })

  it('projette un seul nœud Git du run, son sort et la clôture avec temps et coût', () => {
    const timeline = buildHarnessTimelineFromTrace([
      runTrace('workspace', 'turn-1', 1, 'run-1', {
        type: 'boundary',
        execution: { runId: 'run-1' },
        run: {
          stage: 'workspace',
          runId: 'run-1',
          timestampMs: 100,
          workspace: {
            mode: 'worktree',
            repositoryPath: 'C:\\repo',
            path: 'C:\\worktrees\\run-1'
          }
        }
      }),
      runTrace('agent', 'turn-1', 2, 'run-1', {
        execution: {
          runId: 'run-1',
          attemptId: 'attempt-1',
          phase: 'build',
          agentId: 'builder',
          taskId: 'task-1'
        }
      }),
      runTrace('git', 'turn-1', 3, 'run-1', {
        type: 'boundary',
        execution: { runId: 'run-1' },
        run: {
          stage: 'git',
          runId: 'run-1',
          timestampMs: 220,
          git: {
            outcome: 'conflict',
            rawOutcome: 'conflict',
            commitSha: 'def456',
            baseBranch: 'main',
            files: ['src/a.ts']
          }
        }
      }),
      runTrace('closure-open', 'turn-1', 4, 'run-1', {
        type: 'gate',
        status: 'running',
        execution: { runId: 'run-1' },
        run: {
          stage: 'closure',
          runId: 'run-1',
          timestampMs: 100,
          closure: { status: 'open', totalDurationMs: 0, totalCostUsd: 0 }
        }
      }),
      runTrace('closure-final', 'turn-1', 5, 'run-1', {
        type: 'gate',
        status: 'completed',
        execution: { runId: 'run-1' },
        run: {
          stage: 'closure',
          runId: 'run-1',
          timestampMs: 240,
          closure: {
            status: 'degraded-closed',
            totalDurationMs: 140,
            totalCostUsd: 0.42,
            integrationOutcome: 'conflict'
          }
        }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    const git = projection.events.filter((event) => event.display?.kind === 'git')
    const closure = projection.events.filter((event) => event.display?.kind === 'closure')

    expect(git).toHaveLength(1)
    expect(git[0].display?.git).toMatchObject({
      outcome: 'conflict',
      commitSha: 'def456',
      files: ['src/a.ts']
    })
    expect(closure).toHaveLength(1)
    expect(closure[0].display?.closure).toMatchObject({
      status: 'degraded-closed',
      totalDurationMs: 140,
      totalCostUsd: 0.42
    })
  })

  it('N1 — n’ajoute aucun nœud Git à un run sans worktree', () => {
    const timeline = buildHarnessTimelineFromTrace([
      runTrace('workspace', 'turn-1', 1, 'run-read', {
        type: 'boundary',
        execution: { runId: 'run-read' },
        run: {
          stage: 'workspace',
          runId: 'run-read',
          timestampMs: 100,
          workspace: { mode: 'base', repositoryPath: 'C:\\repo', path: 'C:\\repo' }
        }
      }),
      runTrace('agent', 'turn-1', 2, 'run-read', {
        execution: {
          runId: 'run-read',
          attemptId: 'attempt-read',
          phase: 'frame',
          agentId: 'reader',
          taskId: 'read'
        }
      }),
      runTrace('closure', 'turn-1', 3, 'run-read', {
        type: 'gate',
        execution: { runId: 'run-read' },
        run: {
          stage: 'closure',
          runId: 'run-read',
          timestampMs: 200,
          closure: { status: 'green', totalDurationMs: 100, totalCostUsd: 0.01 }
        }
      })
    ])

    const projection = projectLatestRequestExecution(timeline)
    expect(projection.events.filter((event) => event.display?.kind === 'git')).toHaveLength(0)
    expect(projection.events.filter((event) => event.display?.kind === 'closure')).toHaveLength(1)
  })

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

  it('termine la skill quand le statut terminal remplace le demarrage de la meme tentative', () => {
    const execution = {
      runId: 'run-1',
      attemptId: 'attempt-1',
      phase: 'build',
      agentId: 'builder',
      taskId: 'task-1'
    }
    const timeline = buildHarnessTimelineFromTrace([
      runTrace('workspace', 'turn-1', 1, 'run-1', {
        type: 'boundary',
        execution: { runId: 'run-1' },
        run: {
          stage: 'workspace',
          runId: 'run-1',
          timestampMs: 100,
          workspace: {
            mode: 'worktree',
            repositoryPath: 'C:\\repo',
            path: 'C:\\worktrees\\run-1'
          }
        }
      }),
      runTrace('agent-running', 'turn-1', 2, 'run-1', {
        status: 'running',
        execution
      }),
      runTrace('agent-completed', 'turn-1', 3, 'run-1', {
        status: 'completed',
        execution
      })
    ])

    const skill = projectLatestRequestExecution(timeline).events.find(
      (event) => event.display?.kind === 'skill'
    )

    expect(skill?.status).toBe('completed')
  })
})

/**
 * UNE ABSENCE NE DOIT PAS S'AFFICHER COMME UNE ACTIVITÉ.
 *
 * Un run non clos (`closure.status === 'open'`, l'état NORMAL d'un run en vol) produisait un nœud
 * intitulé « Clôture du run » au statut `running`, donc rendu « en cours ». Le libellé affirmait que la
 * clôture était en train de se faire, alors que la vérité est que rien n'est clos — et la carte
 * affichait `0 ms · 0 $`, preuve qu'il ne s'y passait rien.
 *
 * Constaté le 2026-08-06 : l'utilisateur a cru sa session arrêtée en voyant cette carte, alors que les
 * phases tournaient normalement. Sur un graphe où tous les autres « en cours » signifient un travail
 * qui avance, celui-là signifiait l'inverse.
 */
describe('nœud de clôture — un run non clos est EN ATTENTE, pas en cours', () => {
  const workspace = (runId: string) =>
    runTrace('workspace', 'turn-c', 1, runId, {
      type: 'boundary',
      execution: { runId },
      run: {
        stage: 'workspace',
        runId,
        timestampMs: 100,
        workspace: { mode: 'worktree', repositoryPath: 'C:\\repo', path: 'C:\\wt\\a' }
      }
    })

  const closure = (runId: string, status: string, sequence = 2) =>
    runTrace(`closure-${status}`, 'turn-c', sequence, runId, {
      type: 'gate',
      execution: { runId },
      run: {
        stage: 'closure',
        runId,
        timestampMs: 200,
        closure: { status, totalDurationMs: 0, totalCostUsd: 0 }
      }
    })

  const noeudDeCloture = (statut: string) => {
    const timeline = buildHarnessTimelineFromTrace([workspace('run-c'), closure('run-c', statut)])
    const projection = projectLatestRequestExecution(timeline)
    return projection.events.find((event) => event.display?.kind === 'closure')
  }

  it('un run OUVERT rend un nœud « en attente », jamais « en cours »', () => {
    const noeud = noeudDeCloture('open')
    expect(noeud).toBeDefined()
    // `pending` est déjà traduit « en attente » par statusLabel : rien à ajouter au rendu.
    expect(noeud?.status).toBe('pending')
    expect(noeud?.status).not.toBe('running')
  })

  it('un run ROUGE reste un échec — discriminant', () => {
    expect(noeudDeCloture('red')?.status).toBe('failed')
  })

  it('un run VERT reste terminé — discriminant', () => {
    expect(noeudDeCloture('green')?.status).toBe('completed')
  })

  it('une clôture dégradée reste terminée — discriminant', () => {
    expect(noeudDeCloture('degraded-closed')?.status).toBe('completed')
  })

  /**
   * SECOND ORDRE, ÉCARTÉ PAR LECTURE plutôt que par un test qui n'aurait rien gardé.
   *
   * Le statut d'un nœud « demande » agrège ses enfants sur `running` seul, ce qui aurait pu faire
   * passer un run abandonné (clôture ouverte à vie) pour « terminé » — un faux vert. Mais
   * `projectLatestRequestExecution` RETOURNE avant de construire ce nœud dès qu'une projection de run
   * existe : cette agrégation appartient à la branche SANS run, où aucune clôture n'est émise. Le
   * chemin corrigé ici ne la traverse jamais.
   */
})
