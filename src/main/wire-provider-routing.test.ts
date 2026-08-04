import { describe, expect, it } from 'vitest'
import { buildProviderStatuses } from './provider-status'
import { ROUTED_PROVIDERS } from './routed-providers'

describe('provider routing product wiring', () => {
  it('routes every provider exposed by the product, including Gemini', () => {
    expect(ROUTED_PROVIDERS).toEqual(['codex', 'claude', 'kimi', 'gemini'])
  })

  it('publishes a real Gemini status and honours standby without probing', () => {
    const statuses = buildProviderStatuses({
      codexTokens: null,
      claudeResponds: false,
      kimiResponds: false,
      geminiResponds: true,
      now: 1_000,
      states: { gemini: { mode: 'standby' } }
    })

    expect(statuses.find((status) => status.provider === 'gemini')).toMatchObject({
      status: 'standby',
      testable: false
    })
  })
})
