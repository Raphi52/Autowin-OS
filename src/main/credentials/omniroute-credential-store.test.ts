import { describe, expect, it } from 'vitest'
import { createOmniRouteCredentialStore, type KeyringEntry } from './omniroute-credential-store'

class MemoryEntry implements KeyringEntry {
  password: string | null = null

  setPassword(value: string): void {
    this.password = value
  }

  getPassword(): string | null {
    return this.password
  }

  deletePassword(): boolean {
    const existed = this.password !== null
    this.password = null
    return existed
  }
}

describe('OmniRoute credential store', () => {
  it('writes, reads and deletes through an OS-keyring-only boundary', () => {
    const entry = new MemoryEntry()
    const store = createOmniRouteCredentialStore(() => entry)
    store.set('gateway-secret')
    expect(store.get()).toBe('gateway-secret')
    expect(store.delete()).toBe(true)
    expect(store.get()).toBeNull()
  })

  it('rejects empty or oversized credentials before touching the keyring', () => {
    const entry = new MemoryEntry()
    const store = createOmniRouteCredentialStore(() => entry)
    expect(() => store.set('   ')).toThrow(/invalide/i)
    expect(() => store.set('x'.repeat(4097))).toThrow(/invalide/i)
    expect(entry.password).toBeNull()
  })
})
