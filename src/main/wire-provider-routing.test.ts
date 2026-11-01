import { describe, expect, it } from 'vitest'
import { buildProviderStatuses } from './provider-status'
import { ROUTED_PROVIDERS } from './routed-providers'

describe('provider routing product wiring', () => {
  it('route Claude puis ChatGPT : Kimi et Gemini sont des projets abandonnés', () => {
    expect(ROUTED_PROVIDERS).toEqual(['claude', 'codex'])
  })

  it('ne publie aucun statut pour les moteurs retirés', () => {
    const statuses = buildProviderStatuses({
      claudeResponds: true,
      now: 1_000,
      states: {
        gemini: { mode: 'active', lastProbe: { status: 'authenticated', checkedAt: 500 } },
        kimi: { mode: 'active', lastProbe: { status: 'authenticated', checkedAt: 500 } }
      }
    })

    expect(statuses.map((status) => status.provider)).toEqual(['claude', 'codex'])
  })
})
