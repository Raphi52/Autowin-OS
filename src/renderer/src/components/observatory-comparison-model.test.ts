import { describe, expect, it } from 'vitest'
import { compareObservatoryEvents } from './observatory-comparison-model'
import type { HarnessTimelineEvent } from './harness-timeline-model'

function event(overrides: Partial<HarnessTimelineEvent>): HarnessTimelineEvent {
  return {
    id: 'event',
    kind: 'model-response',
    actor: 'agent',
    label: 'Réponse',
    content: 'avant',
    detail: '',
    payloads: [],
    provider: 'codex',
    model: 'gpt-a',
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.1,
    durationMs: 1000,
    ...overrides
  }
}

describe('comparaison sémantique Observatory', () => {
  it('distingue les changements de contexte, route et métriques', () => {
    const comparison = compareObservatoryEvents(
      event({ id: 'a' }),
      event({
        id: 'b',
        provider: 'claude',
        model: 'opus',
        content: 'après',
        inputTokens: 80,
        costUsd: 0.08,
        durationMs: 700
      })
    )

    expect(comparison.changed).toBeGreaterThan(0)
    expect(comparison.rows.find((row) => row.key === 'provider')).toMatchObject({
      change: 'changed',
      before: 'codex',
      after: 'claude'
    })
    expect(comparison.rows.find((row) => row.key === 'inputTokens')).toMatchObject({ delta: -20 })
    expect(comparison.rows.find((row) => row.key === 'costUsd')).toMatchObject({ delta: -0.02 })
    expect(comparison.rows.find((row) => row.key === 'content')).toMatchObject({
      change: 'changed'
    })
  })

  it('ne fabrique aucune régression pour deux événements identiques', () => {
    const source = event({ id: 'a' })
    const comparison = compareObservatoryEvents(source, { ...source, id: 'b' })
    expect(comparison.changed).toBe(0)
    expect(comparison.rows.every((row) => row.change === 'same')).toBe(true)
  })
})
