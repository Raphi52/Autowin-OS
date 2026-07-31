import { describe, expect, it } from 'vitest'
import { mergeLiveAndPersisted, scopedRunsFromTimeline } from './subagent-thread-from-trace'
import type { HarnessTimeline, HarnessTimelineEvent } from './harness-timeline-model'
import type { ScopedLiveRun } from './chat-view-model'

// Fixture : les champs optionnels sont ajoutés seulement s'ils sont fournis (exactOptionalPropertyTypes).
const event = (over: Partial<HarnessTimelineEvent>): HarnessTimelineEvent =>
  ({
    id: 'e1',
    kind: 'model-response',
    actor: 'agent',
    label: '',
    content: '',
    detail: '',
    ...Object.fromEntries(Object.entries(over).filter(([, value]) => value !== undefined))
  }) as HarnessTimelineEvent

const timeline = (turns: HarnessTimeline['turns']): HarnessTimeline => ({
  turns,
  anomalies: [],
  totalTokens: 0,
  totalCostUsd: 0
} as unknown as HarnessTimeline)

const turn = (id: string, events: HarnessTimelineEvent[]): HarnessTimeline['turns'][number] =>
  ({ id, ts: '2026-07-31T10:00:00Z', events, tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 })

/**
 * Le fil des sous-agents ne vivait qu'en mémoire : « Aucune orchestration dans cette conversation »
 * s'affichait dès le remontage de la vue, alors que le GRAPHE de la même conversation restait
 * rempli — il lit la trace persistée. On projette depuis cette même source.
 */
describe('fil des sous-agents reconstruit depuis la trace persistée', () => {
  it('rend un run par tour d’orchestration, avec ses étapes', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ id: 'm', kind: 'message', content: 'ajoute un module' }),
          event({ id: 'a', kind: 'model-response', provider: 'codex', model: 'gpt', costUsd: 0.4 }),
          event({ id: 'j', kind: 'verdict', provider: 'claude' }),
          event({ id: 'g', kind: 'gate' })
        ])
      ]),
      'conv-1'
    )

    expect(runs).toHaveLength(1)
    expect(runs[0].task).toBe('ajoute un module')
    expect(runs[0].steps.map((step) => step.step)).toEqual(['exec', 'judge', 'gate'])
    expect(runs[0].steps[0]).toMatchObject({ provider: 'codex', model: 'gpt', costUsd: 0.4 })
  })

  it('un tour SANS étape de sous-agent (simple réponse) n’est pas un run', () => {
    const runs = scopedRunsFromTimeline(
      timeline([turn('turn-1', [event({ kind: 'message', content: 'bonjour' })])]),
      'conv-1'
    )
    expect(runs).toEqual([])
  })

  it('une étape en échec met le run au rouge', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ kind: 'message', content: 'tâche' }),
          event({ kind: 'model-response', status: 'failed' })
        ])
      ]),
      'conv-1'
    )
    expect(runs[0].status).toBe('red')
    expect(runs[0].steps[0].status).toBe('failed')
  })

  it('plusieurs tours donnent plusieurs runs — la trace ne s’écrase pas', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [event({ kind: 'message', content: 'premier' }), event({ kind: 'gate' })]),
        turn('turn-2', [event({ kind: 'message', content: 'second' }), event({ kind: 'gate' })])
      ]),
      'conv-1'
    )
    expect(runs.map((run) => run.task)).toEqual(['premier', 'second'])
    expect(runs.map((run) => run.runPath)).toEqual(['turn-1', 'turn-2'])
  })
})

describe('fusion direct + persisté', () => {
  const persisted = (runPath: string): ScopedLiveRun<never> => ({
    convId: 'conv-1',
    runPath,
    task: 'ancien',
    steps: [],
    status: 'green'
  })

  it('le run VIVANT fait autorité sur son tour — pas de doublon', () => {
    const live: Array<[string, ScopedLiveRun<never>]> = [
      ['k', { convId: 'conv-1', runPath: 'turn-2', task: 'en cours', steps: [], status: 'running' }]
    ]
    const merged = mergeLiveAndPersisted(live, [persisted('turn-1'), persisted('turn-2')])

    expect(merged.map(([, run]) => run.task)).toEqual(['ancien', 'en cours'])
    expect(merged.filter(([, run]) => run.runPath === 'turn-2')).toHaveLength(1)
  })

  it('sans run vivant, tout le persisté s’affiche — c’est le cas qui manquait', () => {
    const merged = mergeLiveAndPersisted([], [persisted('turn-1'), persisted('turn-2')])
    expect(merged).toHaveLength(2)
  })
})
