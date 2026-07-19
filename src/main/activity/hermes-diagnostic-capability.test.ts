import { describe, expect, it } from 'vitest'
import { HermesDiagnosticCapabilities } from './hermes-diagnostic-capability'

describe('Hermes diagnostic capability', () => {
  it('est liée au renderer, expire et ne sert qu’une fois', () => {
    const capabilities = new HermesDiagnosticCapabilities()
    const wrongSender = capabilities.issue(4, 1_000)
    expect(capabilities.consume(wrongSender, 5, 1_001)).toBe(false)
    const expired = capabilities.issue(4, 1_000)
    expect(capabilities.consume(expired, 4, 61_001)).toBe(false)
    const valid = capabilities.issue(4, 1_000)
    expect(capabilities.consume(valid, 4, 60_999)).toBe(true)
    expect(capabilities.consume(valid, 4, 60_999)).toBe(false)
  })
})
