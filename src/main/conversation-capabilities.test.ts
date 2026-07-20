import { describe, expect, it } from 'vitest'
import { decideConversationCapability } from './conversation-capabilities'

describe('conversation capability policy', () => {
  it('blocks every mutation in Plan mode while allowing reads', () => {
    expect(
      decideConversationCapability({ mode: 'plan', mutates: false, authority: 'automatic' })
    ).toBe('allow')
    expect(
      decideConversationCapability({ mode: 'plan', mutates: true, authority: 'automatic' })
    ).toBe('deny')
  })

  it('requires approval for sensitive work in Ask mode', () => {
    expect(
      decideConversationCapability({ mode: 'ask', mutates: true, authority: 'automatic' })
    ).toBe('allow')
    expect(
      decideConversationCapability({ mode: 'ask', mutates: true, authority: 'sensitive' })
    ).toBe('confirm')
  })

  it('never auto-approves destructive work, even in Auto mode', () => {
    expect(
      decideConversationCapability({ mode: 'auto', mutates: true, authority: 'sensitive' })
    ).toBe('allow')
    expect(
      decideConversationCapability({ mode: 'auto', mutates: true, authority: 'destructive' })
    ).toBe('confirm')
  })
})
