import { describe, expect, it } from 'vitest'
import { responseDisplayedTrace } from './response-displayed-trace'

describe('responseDisplayedTrace', () => {
  it('relie le rendu React au dernier evenement provider', () => {
    expect(
      responseDisplayedTrace({
        conversationId: 'conv-1',
        turnId: 'turn-1',
        parentId: 'provider:3',
        sequence: 4,
        content: 'visible',
        timestamp: '2026-07-19T12:00:01.000Z'
      })
    ).toMatchObject({
      type: 'response-displayed',
      parentId: 'provider:3',
      sequence: 4,
      recipient: { id: 'human' },
      payloads: [{ kind: 'model-response', content: 'visible' }]
    })
  })
})
