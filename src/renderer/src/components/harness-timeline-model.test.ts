import { describe, expect, it } from 'vitest'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'

function trace(overrides: Partial<HarnessTraceEvent> = {}): HarnessTraceEvent {
  return {
    id: 'tool-1',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    timestamp: '2026-07-19T12:00:00.000Z',
    sequence: 4,
    type: 'tool-result',
    status: 'completed',
    channel: 'tool',
    actor: { id: 'tool', kind: 'tool', label: 'Shell' },
    injector: { id: 'agent', kind: 'agent', label: 'Orchestrateur' },
    recipient: { id: 'model', kind: 'provider', label: 'Codex' },
    payloads: [{ kind: 'tool-result', content: 'exit 0' }],
    observation: { boundary: 'Autowin', fidelity: 'exact' },
    metrics: { durationMs: 12, inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 },
    ...overrides
  }
}

describe('Harnais timeline canonique', () => {
  it('conserve type, contenu, métriques et provenance sans fabriquer d’étapes', () => {
    const timeline = buildHarnessTimelineFromTrace([trace()])
    expect(timeline.turns[0].events).toHaveLength(1)
    expect(timeline.turns[0].events[0]).toMatchObject({
      kind: 'tool-result',
      actor: 'Shell',
      content: 'exit 0',
      tokens: 5,
      injector: 'Orchestrateur',
      recipient: 'Codex',
      durationMs: 12
    })
    expect(timeline.turns[0].events[0].payloads).toEqual([
      { kind: 'tool-result', content: 'exit 0' }
    ])
  })

  it('détecte une injection exacte répétée entre plusieurs tours', () => {
    const injection = trace({
      type: 'injection',
      payloads: [{ kind: 'system-instruction', content: 'RÈGLE' }]
    })
    const timeline = buildHarnessTimelineFromTrace([
      injection,
      { ...injection, id: 'injection-2', turnId: 'turn-2', sequence: 5 }
    ])
    expect(timeline.anomalies).toContainEqual(
      expect.objectContaining({
        kind: 'duplicate-injection',
        count: 2,
        characters: 5,
        impact: 5,
        eventId: 'tool-1',
        turnIds: ['turn-1', 'turn-2'],
        fact: expect.stringMatching(/2 occurrences.*turn-1, turn-2/),
        hypothesis: expect.stringContaining('peut'),
        recommendation: expect.stringContaining('Vérifier')
      })
    )
  })

  it('ne fusionne pas un même texte entre provenances ou structures différentes', () => {
    const base = trace({
      type: 'injection',
      payloads: [{ kind: 'system-instruction', content: 'A\nB' }]
    })
    const events = [
      base,
      {
        ...base,
        id: 'other-recipient',
        recipient: { id: 'claude', kind: 'provider', label: 'Claude' }
      },
      {
        ...base,
        id: 'other-structure',
        payloads: [
          { kind: 'system-instruction', content: 'A' },
          { kind: 'system-instruction', content: 'B' }
        ]
      }
    ]
    expect(buildHarnessTimelineFromTrace(events).anomalies).toEqual([])
  })

  it('signale un gros bloc au seuil explicite mais pas juste dessous', () => {
    const below = trace({
      id: 'below',
      type: 'injection',
      payloads: [{ kind: 'system-instruction', content: 'x'.repeat(11_999) }]
    })
    const large = trace({
      id: 'large',
      sequence: 5,
      type: 'injection',
      payloads: [{ kind: 'system-instruction', content: 'y'.repeat(12_000) }]
    })
    const anomalies = buildHarnessTimelineFromTrace([below, large]).anomalies
    expect(anomalies.some((item) => item.eventId === 'below')).toBe(false)
    expect(anomalies).toContainEqual(
      expect.objectContaining({ kind: 'large-injection', eventId: 'large', impact: 12_000 })
    )
  })

  it('classe par impact et borne le diagnostic a cinq cartes', () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      trace({
        id: `large-${index}`,
        sequence: index,
        type: 'injection',
        payloads: [{ kind: 'system-instruction', content: String(index).repeat(12_000 + index) }]
      })
    )
    const anomalies = buildHarnessTimelineFromTrace(events).anomalies
    expect(anomalies).toHaveLength(5)
    expect(anomalies.map((item) => item.impact)).toEqual([12_006, 12_005, 12_004, 12_003, 12_002])
  })
})
