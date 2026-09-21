import { describe, expect, it } from 'vitest'
import { classifyProviderFailure, diagnoseProviderFailure } from './provider-failure-diagnosis'

// Message réel, conv-737, promptCall du tour f0e1c2b0-a1c9-4140-8496-dc40709fcab9 (2026-09-21).
const REEL =
  "Claude a interrompu l'appel : The model's tool call could not be parsed (retry also failed)."

describe('appel d’outil illisible (conv-737)', () => {
  it('est classé malformed-tool-call, pas other ni cancelled', () => {
    expect(classifyProviderFailure(REEL)).toBe('malformed-tool-call')
  })
  it('porte un conseil concret', () => {
    const d = diagnoseProviderFailure({ provider: 'claude', message: REEL })
    expect(d.hint).toMatch(/illisible/)
  })
})
