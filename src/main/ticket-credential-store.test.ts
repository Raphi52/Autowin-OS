import { describe, expect, it } from 'vitest'
import {
  createTicketCredentialStore,
  parseTicketCredential,
  type TicketKeyringEntry
} from './ticket-credential-store'

class MemoryEntry implements TicketKeyringEntry {
  value: string | null = null
  setPassword(value: string): void {
    this.value = value
  }
  getPassword(): string | null {
    return this.value
  }
  deletePassword(): boolean {
    const existed = this.value !== null
    this.value = null
    return existed
  }
}

describe('keyring Tickets', () => {
  it('conserve le token uniquement dans l?entr?e syst?me', () => {
    const entries = new Map<string, MemoryEntry>()
    const store = createTicketCredentialStore((account) => {
      const entry = new MemoryEntry()
      entries.set(account, entry)
      return entry
    })

    store.set('azure:AmitelGTC:RIG:RigApplication', 'secret-token')

    expect(store.get('azure:AmitelGTC:RIG:RigApplication')).toBe('secret-token')
    expect([...entries.values()][0].value).toBe('secret-token')
    expect(store.has('azure:AmitelGTC:RIG:RigApplication')).toBe(true)
    expect(store.delete('azure:AmitelGTC:RIG:RigApplication')).toBe(true)
  })

  it.each(['', ' x ', 'x\nsecret', 'x'.repeat(4097)])('rejette un token invalide', (token) => {
    expect(() => parseTicketCredential(token)).toThrow(/credential.*invalide/i)
  })

  it('rejette une identit? de source dangereuse', () => {
    const store = createTicketCredentialStore(() => new MemoryEntry())
    expect(() => store.set('../source', 'token')).toThrow(/source.*invalide/i)
  })
})
