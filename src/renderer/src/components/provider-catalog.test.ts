import { describe, expect, it } from 'vitest'
import { agentStudioProviderIds } from './provider-catalog'

describe('agentStudioProviderIds', () => {
  it('fusionne uniquement les providers chargés par Agent Studio, sans doublon et dans un ordre stable', () => {
    expect(
      agentStudioProviderIds(
        [{ provider: ' ollama ' }, { provider: 'claude' }, { provider: '' }],
        [{ provider: 'kimi' }, { provider: 'ollama' }, { provider: '  ' }]
      )
    ).toEqual(['claude', 'kimi', 'ollama'])
  })
})
