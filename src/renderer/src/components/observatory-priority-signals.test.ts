import { describe, expect, it } from 'vitest'
import { buildObservatoryPrioritySignals } from './observatory-priority-signals'
import type { HarnessAnomaly, HarnessTimelineEvent } from './harness-timeline-model'

function anomaly(overrides: Partial<HarnessAnomaly> & { eventId: string }): HarnessAnomaly {
  return {
    kind: 'large-injection',
    label: 'Bloc d’instructions volumineux',
    count: 1,
    characters: 40_000,
    impact: 40_000,
    turnIds: ['t1'],
    fact: 'fait',
    hypothesis: 'hypothèse',
    recommendation: 'recommandation',
    ...overrides
  }
}

function event(overrides: Partial<HarnessTimelineEvent> & { id: string }): HarnessTimelineEvent {
  return {
    kind: 'error',
    actor: 'outil',
    label: 'Échec outil',
    content: 'boom',
    detail: 'exit 1',
    payloads: [],
    ...overrides
  }
}

describe('buildObservatoryPrioritySignals', () => {
  it('place une erreur AVANT un gros payload sain', () => {
    const signals = buildObservatoryPrioritySignals(
      [anomaly({ eventId: 'inj-1', impact: 400_000, characters: 400_000 })],
      [event({ id: 'err-1', content: 'x' })]
    )
    expect(signals.map((signal) => signal.eventId)).toEqual(['err-1', 'inj-1'])
    expect(signals[0].severity).toBe('error')
  })

  it('classe une injection répétée avant un simple volume, quel que soit l’impact', () => {
    const signals = buildObservatoryPrioritySignals(
      [
        anomaly({ eventId: 'big', impact: 999_999 }),
        anomaly({
          eventId: 'dup',
          kind: 'duplicate-injection',
          impact: 10,
          label: 'Injection répétée'
        })
      ],
      []
    )
    expect(signals.map((signal) => signal.eventId)).toEqual(['dup', 'big'])
  })

  it('trie par impact décroissant à gravité égale, de façon déterministe', () => {
    const signals = buildObservatoryPrioritySignals(
      [anomaly({ eventId: 'a', impact: 100 }), anomaly({ eventId: 'b', impact: 5_000 })],
      []
    )
    expect(signals.map((signal) => signal.eventId)).toEqual(['b', 'a'])
  })

  it('reconnaît un statut d’échec porté par un événement non typé error', () => {
    const signals = buildObservatoryPrioritySignals(
      [anomaly({ eventId: 'big', impact: 999_999 })],
      [event({ id: 'tool-1', kind: 'tool-result', status: 'failed' })]
    )
    expect(signals[0].eventId).toBe('tool-1')
  })
})
