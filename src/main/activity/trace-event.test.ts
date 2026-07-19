import { describe, expect, it } from 'vitest'
import { assertTraceEvent, type TraceEventV1, type TracePayload } from './trace-event'

const payloads: TracePayload[] = [
  { kind: 'user-message', content: 'Analyse ce dossier.' },
  { kind: 'system-instruction', content: 'Respecte le RUN.' },
  { kind: 'app-state', content: '{"view":"chat"}', mediaType: 'application/json' },
  { kind: 'history', content: 'Tour précédent.' },
  { kind: 'resource', content: '# Skill', name: 'SKILL.md', mediaType: 'text/markdown' },
  { kind: 'attachment', content: 'preuve', name: 'preuve.txt', mediaType: 'text/plain' },
  { kind: 'tool-call', content: '{"path":"RUN.md"}', mediaType: 'application/json' },
  { kind: 'tool-result', content: 'status: open' },
  { kind: 'model-response', content: 'Je délègue au juge.' },
  { kind: 'error', content: 'timeout' }
]

function completeEvent(overrides: Partial<TraceEventV1> = {}): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: 'evt-002',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    parentId: 'evt-001',
    timestamp: '2026-07-19T12:00:00.000Z',
    sequence: 2,
    type: 'injection',
    status: 'completed',
    actor: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    injector: { id: 'skill-frame', kind: 'skill', label: 'Frame' },
    recipient: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    channel: 'system',
    payloads,
    observation: {
      boundary: 'pre-provider',
      fidelity: 'exact',
      limitation: 'Transformations internes du provider non observables.'
    },
    provider: { id: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    metrics: { durationMs: 42, inputTokens: 120, outputTokens: 0, cacheReadTokens: 20 },
    ...overrides
  }
}

describe('TraceEvent v1 — contrat causal canonique', () => {
  it('accepte une fixture exhaustive sans tronquer les payloads', () => {
    const longContent = 'x'.repeat(12_000)
    const event = completeEvent({
      payloads: [...payloads, { kind: 'attachment', name: 'long.txt', content: longContent }]
    })
    expect(assertTraceEvent(event)).toBe(event)
    expect(event.payloads.at(-1)?.content).toHaveLength(12_000)
  })

  it.each([
    ['id', { id: '' }],
    ['conversation', { conversationId: '' }],
    ['causal parent', { parentId: 'evt-002' }],
    ['actor', { actor: { id: '', kind: 'agent', label: 'Agent' } }],
    ['payload', { payloads: [] }],
    ['observation boundary', { observation: { boundary: '', fidelity: 'exact' } }]
  ])('rejette un événement sans %s', (_label, mutation) => {
    expect(() => assertTraceEvent(completeEvent(mutation as Partial<TraceEventV1>))).toThrow()
  })

  it('distingue retry, annulation, sous-agent, juge et zone opaque', () => {
    const variants: TraceEventV1[] = [
      completeEvent({ id: 'retry', type: 'retry', status: 'running' }),
      completeEvent({ id: 'cancel', type: 'cancellation', status: 'cancelled' }),
      completeEvent({ id: 'subagent', type: 'handoff', actor: { id: 'sub', kind: 'agent', label: 'Sous-agent' } }),
      completeEvent({ id: 'judge', type: 'verdict', actor: { id: 'judge', kind: 'judge', label: 'Juge' } }),
      completeEvent({ id: 'opaque', type: 'boundary', observation: { boundary: 'inside-provider', fidelity: 'opaque', limitation: 'Non exposé.' } })
    ]
    expect(variants.map(assertTraceEvent)).toEqual(variants)
  })
})
