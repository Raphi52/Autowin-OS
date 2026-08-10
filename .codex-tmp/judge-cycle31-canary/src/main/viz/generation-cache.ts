export interface CacheLease<Key> {
  readonly key: Key
  readonly token: object
}

/** Barrière légère pour rejeter une réponse démarrée avant la dernière invalidation. */
export class GenerationFence {
  private epoch = 0

  capture(): number {
    return this.epoch
  }

  invalidate(): void {
    this.epoch += 1
  }

  isCurrent(capturedEpoch: number): boolean {
    return capturedEpoch === this.epoch
  }
}

/** Cache dont une invalidation retire les leases actifs sans conserver de tombstone par clé. */
export class GenerationCache<Key, Value> {
  private readonly values = new Map<Key, Value>()
  private readonly leases = new Map<Key, Set<object>>()

  get(key: Key): Value | undefined {
    return this.values.get(key)
  }

  get pendingLeaseCount(): number {
    let count = 0
    for (const leases of this.leases.values()) count += leases.size
    return count
  }

  get trackedKeyCount(): number {
    return this.leases.size
  }

  capture(key: Key): CacheLease<Key> {
    const token = {}
    const leases = this.leases.get(key) ?? new Set<object>()
    leases.add(token)
    this.leases.set(key, leases)
    return { key, token }
  }

  publish(lease: CacheLease<Key>, value: Value): boolean {
    const leases = this.leases.get(lease.key)
    if (!leases?.delete(lease.token)) return false
    if (leases.size === 0) this.leases.delete(lease.key)
    this.values.set(lease.key, value)
    return true
  }

  abandon(lease: CacheLease<Key>): void {
    const leases = this.leases.get(lease.key)
    if (!leases) return
    leases.delete(lease.token)
    if (leases.size === 0) this.leases.delete(lease.key)
  }

  invalidate(key?: Key): void {
    if (key === undefined) {
      this.values.clear()
      this.leases.clear()
      return
    }
    this.values.delete(key)
    this.leases.delete(key)
  }
}
