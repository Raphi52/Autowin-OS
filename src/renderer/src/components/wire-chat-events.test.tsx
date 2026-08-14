import { describe, expect, it } from 'vitest'
import { refreshesActiveConversation } from './chat-event-routing'

describe('chat event wiring', () => {
  it('reloads only the conversation targeted by a resumed-run refresh', () => {
    expect(refreshesActiveConversation({ type: 'refresh', scope: 'chat', convId: 'a' }, 'a')).toBe(
      true
    )
    expect(refreshesActiveConversation({ type: 'refresh', scope: 'chat', convId: 'a' }, 'b')).toBe(
      false
    )
  })

})
