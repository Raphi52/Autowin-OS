import { describe, expect, it } from 'vitest'
import { pilotActionToTraceEvent } from './pilot-action-trace'

describe('pilotActionToTraceEvent', () => {
  it('conserve commande, résultat et parent causal exacts', () => {
    const event = pilotActionToTraceEvent({
      id: 'evt-tool',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      parentId: 'evt-model',
      timestamp: '2026-07-19T12:00:00.000Z',
      sequence: 4,
      kind: 'result',
      name: 'roles.set',
      ok: false,
      data: 'permission refusée'
    })
    expect(event).toMatchObject({ type: 'tool-result', status: 'failed', parentId: 'evt-model' })
    expect(event.payloads[0]).toEqual({
      kind: 'error',
      name: 'roles.set',
      content: 'permission refusée'
    })
  })
  it('rend une nouvelle tentative explicite et causale', () => {
    const event = pilotActionToTraceEvent({
      id: 'evt-retry',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      parentId: 'evt-error',
      timestamp: '2026-07-19T12:00:01.000Z',
      sequence: 5,
      kind: 'retry',
      name: 'codex',
      data: { attempt: 1, maxAttempts: 2 }
    })
    expect(event).toMatchObject({
      type: 'retry',
      status: 'completed',
      parentId: 'evt-error',
      channel: 'internal'
    })
  })
  it('rend une annulation explicite et annulee', () => {
    const event = pilotActionToTraceEvent({
      id: 'evt-cancel',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      parentId: 'evt-model',
      timestamp: '2026-07-19T12:00:02.000Z',
      sequence: 6,
      kind: 'cancellation',
      data: 'utilisateur'
    })
    expect(event).toMatchObject({ type: 'cancellation', status: 'cancelled', channel: 'internal' })
  })
})
