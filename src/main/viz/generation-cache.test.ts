import { describe, expect, it } from 'vitest'
import { GenerationCache, GenerationFence } from './generation-cache'

describe('GenerationCache', () => {
  it("refuse la publication tardive d'un chargement capturé avant invalidation", () => {
    const cache = new GenerationCache<string, string>()
    const staleLease = cache.capture('vault')

    cache.invalidate('vault')

    expect(cache.publish(staleLease, 'OLD')).toBe(false)
    expect(cache.get('vault')).toBeUndefined()
  })

  it("n'invalide pas les autres clés quand une seule racine change", () => {
    const cache = new GenerationCache<string, string>()
    const left = cache.capture('left')
    const right = cache.capture('right')
    expect(cache.publish(left, 'LEFT')).toBe(true)
    expect(cache.publish(right, 'RIGHT')).toBe(true)

    cache.invalidate('left')

    expect(cache.get('left')).toBeUndefined()
    expect(cache.get('right')).toBe('RIGHT')
  })

  it('ne retient aucune clé arbitraire invalidée sans chargement actif', () => {
    const cache = new GenerationCache<string, string>()

    for (let index = 0; index < 100_000; index += 1) cache.invalidate(`root-${index}`)

    expect(cache.pendingLeaseCount).toBe(0)
    expect(cache.trackedKeyCount).toBe(0)
  })

  it("libère le lease d'un chargement qui échoue", () => {
    const cache = new GenerationCache<string, string>()
    const lease = cache.capture('vault')

    cache.abandon(lease)

    expect(cache.pendingLeaseCount).toBe(0)
    expect(cache.publish(lease, 'late')).toBe(false)
  })
})

describe('GenerationFence', () => {
  it('rejette une réponse commencée avant la dernière invalidation', () => {
    const fence = new GenerationFence()
    const staleEpoch = fence.capture()

    fence.invalidate()

    expect(fence.isCurrent(staleEpoch)).toBe(false)
    expect(fence.isCurrent(fence.capture())).toBe(true)
  })
})
