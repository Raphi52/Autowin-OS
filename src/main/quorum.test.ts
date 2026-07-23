import { describe, it, expect } from 'vitest'
import { defaultQuorumThreshold } from './quorum'

describe('defaultQuorumThreshold', () => {
  it('majorité simple ⌈N/2⌉, minimum 1', () => {
    expect(defaultQuorumThreshold(0)).toBe(1)
    expect(defaultQuorumThreshold(1)).toBe(1)
    expect(defaultQuorumThreshold(2)).toBe(1)
    expect(defaultQuorumThreshold(3)).toBe(2)
    expect(defaultQuorumThreshold(4)).toBe(2)
    expect(defaultQuorumThreshold(5)).toBe(3)
  })
})
