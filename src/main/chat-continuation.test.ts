import { describe, expect, it } from 'vitest'
import { buildContinuationProviderHistory, CONTINUATION_INSTRUCTION } from './chat-continuation'

describe('provider continuation history', () => {
  it('adds an explicit internal continuation without mutating the durable history', () => {
    const durable = [
      { role: 'user' as const, content: 'Inspecte le depot' },
      { role: 'assistant' as const, content: 'Je commence par localiser le workspace.' }
    ]

    const provider = buildContinuationProviderHistory(durable)

    expect(durable).toHaveLength(2)
    expect(provider.slice(0, -1)).toEqual(durable)
    expect(provider.at(-1)).toEqual({ role: 'user', content: CONTINUATION_INSTRUCTION })
    expect(CONTINUATION_INSTRUCTION).toMatch(/reprends|continue/i)
  })
})
