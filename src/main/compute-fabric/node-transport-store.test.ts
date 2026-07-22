import { describe, expect, it } from 'vitest'
import {
  createFabricNodeTransportStore,
  FabricNodeTransportCorruptionError,
  parseFabricNodeTransport,
  type KeyringEntry
} from './node-transport-store'

class MemoryEntry implements KeyringEntry {
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

describe('Compute Fabric Node transport keyring', () => {
  it('round-trips an HTTPS origin, TLS SPKI pin and bearer only through the keyring entry', () => {
    const entry = new MemoryEntry()
    const store = createFabricNodeTransportStore('node-gpu-01', () => entry)

    store.set({
      origin: 'https://node.internal:7443/',
      tlsSpkiSha256: 'c'.repeat(64),
      bearerToken: 'secret-token'
    })

    expect(store.get()).toEqual({
      origin: 'https://node.internal:7443',
      tlsSpkiSha256: 'c'.repeat(64),
      bearerToken: 'secret-token'
    })
    expect(entry.value).toContain('secret-token')
  })

  it.each([
    'http://node.internal:7443',
    'https://user:password@node.internal:7443',
    'https://node.internal:7443/?token=secret'
  ])('rejects an unsafe Node origin: %s', (origin) => {
    const store = createFabricNodeTransportStore('node-gpu-01', () => new MemoryEntry())

    expect(() => store.set({ origin, tlsSpkiSha256: 'c'.repeat(64) })).toThrow(/origine.*invalide/i)
  })

  it.each([undefined, '', 'c'.repeat(63), 'C'.repeat(64)])(
    'rejects a missing or malformed TLS SPKI pin: %s',
    (tlsSpkiSha256) => {
      expect(() =>
        parseFabricNodeTransport({ origin: 'https://node.internal:7443', tlsSpkiSha256 })
      ).toThrow(/pin TLS\/SPKI.*invalide/i)
    }
  )

  it.each([
    ['un JSON malformé', '{'],
    ['un transport legacy sans pin', JSON.stringify({ origin: 'https://node.internal:7443' })]
  ])('fails closed and preserves %s in the keyring', (_label, stored) => {
    const entry = new MemoryEntry()
    entry.value = stored
    const store = createFabricNodeTransportStore('node-gpu-01', () => entry)
    let failure: unknown

    try {
      store.get()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(FabricNodeTransportCorruptionError)
    expect(failure).toMatchObject({
      code: 'FABRIC_TRANSPORT_CORRUPT',
      nodeId: 'node-gpu-01'
    })
    expect(entry.value).toBe(stored)
  })
})
