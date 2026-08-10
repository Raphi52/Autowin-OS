import { describe, expect, it } from 'vitest'
import { assertTraceEvent, type TraceAuthorityReceipt, type TraceEventV1 } from './trace-event'

function authorityEvent(
  authority: TraceAuthorityReceipt,
  status: TraceEventV1['status'] = 'completed'
): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: 'evt',
    conversationId: 'conv',
    turnId: 'turn',
    timestamp: '2026-08-08T10:00:00.000Z',
    sequence: 1,
    type: 'decision',
    status,
    actor: { id: 'autowin-authority', kind: 'system', label: 'Autorite' },
    channel: 'internal',
    payloads: [{ kind: 'tool-call', content: '{}' }],
    observation: { boundary: 'app-command-bus', fidelity: 'exact' },
    authority
  }
}

const base = { mode: 'ask', commandAuthority: 'sensitive', mutates: true } as const

describe('invariants du recu d autorite', () => {
  it.each([
    ['confirm sans decisionId', { ...base, decision: 'confirm' as const }, 'pending' as const],
    [
      'resolution sans resolvedBy',
      { ...base, decision: 'confirm' as const, decisionId: 'd', resolution: 'approve' as const },
      'completed' as const
    ],
    [
      'resolvedBy sans resolution',
      { ...base, decision: 'confirm' as const, decisionId: 'd', resolvedBy: 'user' as const },
      'completed' as const
    ],
    [
      'allow avec annulation',
      {
        ...base,
        decision: 'allow' as const,
        resolution: 'cancel' as const,
        resolvedBy: 'user' as const
      },
      'completed' as const
    ],
    [
      'deny avec decisionId',
      { ...base, decision: 'deny' as const, decisionId: 'd' },
      'failed' as const
    ],
    [
      'confirm resolu mais pending',
      {
        ...base,
        decision: 'confirm' as const,
        decisionId: 'd',
        resolution: 'approve' as const,
        resolvedBy: 'user' as const
      },
      'pending' as const
    ]
  ])('rejette %s', (_label, authority, status) => {
    expect(() => assertTraceEvent(authorityEvent(authority, status))).toThrow(/authority/)
  })

  it('rejette une decision contraire a la politique ou portee par une enveloppe provider', () => {
    expect(() =>
      assertTraceEvent(
        authorityEvent({
          mode: 'plan',
          commandAuthority: 'destructive',
          mutates: true,
          decision: 'allow'
        })
      )
    ).toThrow(/authority/)

    expect(() =>
      assertTraceEvent({
        ...authorityEvent({ ...base, decision: 'allow' }),
        type: 'model-response',
        actor: { id: 'agent', kind: 'agent', label: 'Agent' },
        observation: { boundary: 'provider-output', fidelity: 'exact' }
      })
    ).toThrow(/authority/)
  })
})
