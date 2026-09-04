import { describe, expect, it } from 'vitest'
import { buildProviderStatuses } from './provider-status'
import { ROUTED_PROVIDERS } from './routed-providers'

describe('provider routing product wiring', () => {
  it('ne route plus que Claude : Codex, Kimi et Gemini sont des projets abandonnés', () => {
    expect(ROUTED_PROVIDERS).toEqual(['claude'])
  })

  it('ne publie aucun statut pour les moteurs retirés', () => {
    const statuses = buildProviderStatuses({
      codexTokens: null,
      claudeResponds: true,
      kimiResponds: false,
      geminiResponds: true,
      now: 1_000,
      states: {}
    })

    expect(statuses.map((status) => status.provider)).toEqual(['claude'])
  })
})
