import { describe, expect, it } from 'vitest'
import { classifyProviderFailure, describeFanoutFailure } from './provider-failure-diagnosis'

// Message REEL du tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 (conv-540), phase build.
const REEL =
  "Claude a interrompu l'appel : API Error: Opus 5's safeguards flagged this message (https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations."

describe('refus du filtre de securite du modele', () => {
  it('se classe refused, pas other', () => {
    expect(classifyProviderFailure(REEL)).toBe('refused')
  })
  it("dit qu'une relance a l'identique echouera", () => {
    const msg = describeFanoutFailure('build', 'subagent', [{ provider: 'claude', model: 'claude-opus-5', message: REEL }])
    expect(msg).toMatch(/identique échouera/)
  })
})
