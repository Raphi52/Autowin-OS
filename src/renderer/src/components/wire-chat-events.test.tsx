import { describe, expect, it } from 'vitest'
import { isLiveOrchestrationEvent, refreshesActiveConversation } from './chat-event-routing'

describe('chat event wiring', () => {
  it('reloads only the conversation targeted by a resumed-run refresh', () => {
    expect(refreshesActiveConversation({ type: 'refresh', scope: 'chat', convId: 'a' }, 'a')).toBe(
      true
    )
    expect(refreshesActiveConversation({ type: 'refresh', scope: 'chat', convId: 'a' }, 'b')).toBe(
      false
    )
  })

  it('recognises direct orchestration steps before their terminal event', () => {
    expect(isLiveOrchestrationEvent({ type: 'orchestrate-step', convId: 'a' })).toBe(true)
    expect(isLiveOrchestrationEvent({ type: 'orchestrate-end', convId: 'a' })).toBe(true)
  })
})
