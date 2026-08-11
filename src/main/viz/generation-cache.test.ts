import { describe, expect, it } from 'vitest'
import { GenerationFence } from './generation-cache'

describe('GenerationFence', () => {
  it('rejette une réponse commencée avant la dernière invalidation', () => {
    const fence = new GenerationFence()
    const staleEpoch = fence.capture()

    fence.invalidate()

    expect(fence.isCurrent(staleEpoch)).toBe(false)
    expect(fence.isCurrent(fence.capture())).toBe(true)
  })
})
