import { describe, expect, it } from 'vitest'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  coalesceAssistantParts,
  isChatNearBottom,
  resolveChatRuntimeIdentity
} from './chat-view-model'

describe('resolveChatRuntimeIdentity', () => {
  it('resolves the actual orchestrator provider, model and effort from the dynamic catalog', () => {
    expect(
      resolveChatRuntimeIdentity(
        {
          orchestrator: {
            slotId: 'orchestrator',
            provider: 'future-provider',
            modelId: 'future-provider/stellar',
            reasoningEffort: 'ultra'
          }
        },
        [
          {
            id: 'future-provider/stellar',
            provider: 'future-provider',
            model: 'stellar-v2',
            label: 'Stellar V2'
          }
        ]
      )
    ).toEqual({
      provider: 'future-provider',
      model: 'stellar-v2',
      modelLabel: 'Stellar V2',
      reasoningEffort: 'ultra'
    })
  })

  it('falls back to truthful ids instead of inventing a known provider', () => {
    expect(
      resolveChatRuntimeIdentity(
        {
          orchestrator: {
            slotId: 'orchestrator',
            provider: 'custom',
            modelId: 'custom/missing',
            reasoningEffort: 'high'
          }
        },
        []
      )
    ).toEqual({
      provider: 'custom',
      model: 'custom/missing',
      modelLabel: 'custom/missing',
      reasoningEffort: 'high'
    })
  })
})

describe('coalesceAssistantParts', () => {
  it('merges only consecutive text fragments into one readable block', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: 'Premiere phrase.' },
        { kind: 'text', text: 'Deuxieme phrase.' },
        { kind: 'action', name: 'navigate', ok: true, data: { tab: 'memory' } },
        { kind: 'text', text: 'Conclusion.' }
      ])
    ).toEqual([
      { kind: 'text', text: 'Premiere phrase.\n\nDeuxieme phrase.' },
      { kind: 'action', name: 'navigate', ok: true, data: { tab: 'memory' } },
      { kind: 'text', text: 'Conclusion.' }
    ])
  })

  it('does not create empty text blocks', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: '  ' },
        { kind: 'action', name: 'get_state' },
        { kind: 'text', text: '' }
      ])
    ).toEqual([{ kind: 'action', name: 'get_state' }])
  })
})

describe('chat scrolling and layout rules', () => {
  it('follows the tail only when the reader is close to the bottom', () => {
    expect(isChatNearBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1040 })).toBe(true)
    expect(isChatNearBottom({ scrollTop: 300, clientHeight: 300, scrollHeight: 1040 })).toBe(false)
  })

  it('keeps the conversation library within usable bounds', () => {
    expect(clampConversationPaneWidth(100)).toBe(CHAT_PANE_LIMITS.conversations.min)
    expect(clampConversationPaneWidth(999)).toBe(CHAT_PANE_LIMITS.conversations.max)
    expect(clampConversationPaneWidth(344.6)).toBe(345)
  })
})
