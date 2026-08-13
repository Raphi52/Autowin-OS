import { describe, expect, it } from 'vitest'
import { resolveLatestUserMessage } from './agent-pilot'
import { CONTINUATION_INSTRUCTION } from './chat-continuation'
import { classifyMutationConfidence } from './task-mutation-classifier'

describe('AgentPilot continuation routing context', () => {
  it('classifies a continuation from the last real human request', () => {
    const history = [
      { role: 'user' as const, content: 'Analyse ce dépôt en lecture seule' },
      { role: 'assistant' as const, content: 'Je commence l inspection.' },
      { role: 'user' as const, content: CONTINUATION_INSTRUCTION }
    ]

    const routingMessage = resolveLatestUserMessage(history, 'Analyse ce dépôt en lecture seule')

    expect(routingMessage).toBe('Analyse ce dépôt en lecture seule')
    expect(classifyMutationConfidence(routingMessage ?? '')).toBe('read-only')
    expect(resolveLatestUserMessage(history)).toBe(CONTINUATION_INSTRUCTION)
  })
})
