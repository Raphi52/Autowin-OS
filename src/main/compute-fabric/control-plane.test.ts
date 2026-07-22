import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from './manifest'
import { FabricStateCorruptionError } from './fabric-store'
import {
  FabricControlPlane,
  type FabricManifestClient,
  type PairNodeRequest
} from './control-plane'
import type { FabricNodeTransport, FabricNodeTransportStore } from './node-transport-store'

const NOW = new Date('2026-07-22T16:30:00.000Z')
const directories: string[] = []

function signedPairingFixture(): {
  request: PairNodeRequest
  manifest: unknown
  manifestForSequence: (sequence: number) => unknown
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex')
  const manifestForSequence = (sequence: number): unknown => {
    const body = {
      schema: 'autowin.node-manifest/v1',
      protocol: { min: 1, max: 1 },
      node: {
        id: 'node-gpu-01',
        keyId: 'node-gpu-01:signing:v1',
        signingPublicKeyFingerprint: fingerprint,
        bootId: 'boot-01'
      },
      sequence,
      issuedAt: '2026-07-22T16:29:30.000Z',
      expiresAt: '2026-07-22T16:34:30.000Z',
      adapters: [{ id: 'ollama', version: '0.6.0' }],
      resources: [
        {
          id: 'qwen3-32b',
          kind: 'model',
          adapterId: 'ollama',
          displayName: 'Qwen3 32B',
          runtimeVersion: '0.6.0',
          modes: ['local-tools'],
          capabilities: ['chat', 'tools.local'],
          limits: { contextTokens: 32768, maxConcurrentRuns: 2 }
        }
      ]
    }
    const signature = sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64')
    return {
      ...body,
      signature: { algorithm: 'Ed25519', keyId: 'node-gpu-01:signing:v1', value: signature }
    }
  }
  return {
    request: {
      nodeId: 'node-gpu-01',
      keyId: 'node-gpu-01:signing:v1',
      signingPublicKeyFingerprint: fingerprint,
      signingPublicKeyPem: publicKeyPem,
      transport: {
        origin: 'https://node.internal:7443',
        tlsSpkiSha256: 'c'.repeat(64),
        bearerToken: 'secret-token'
      }
    },
    manifest: manifestForSequence(7),
    manifestForSequence
  }
}

class MemoryTransportStore implements FabricNodeTransportStore {
  value: FabricNodeTransport | null = null
  set(value: FabricNodeTransport): void {
    this.value = structuredClone(value)
  }
  get(): FabricNodeTransport | null {
    return this.value ? structuredClone(this.value) : null
  }
  delete(): boolean {
    const existed = this.value !== null
    this.value = null
    return existed
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Compute Fabric control plane', () => {
  it('refuses to initialize from a corrupted trust state without touching network or keyring', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-fabric-control-'))
    directories.push(directory)
    const statePath = join(directory, 'fabric-state.json')
    const corrupted = '{"schema":"autowin.fabric-state/v1","nodes":['
    writeFileSync(statePath, corrupted, 'utf8')
    let manifestCalls = 0
    let keyringWrites = 0

    expect(
      () =>
        new FabricControlPlane({
          statePath,
          manifestClient: {
            fetchManifest: async () => {
              manifestCalls += 1
              return {}
            }
          },
          transportStoreFactory: () => ({
            get: () => null,
            set: () => {
              keyringWrites += 1
            },
            delete: () => false
          })
        })
    ).toThrowError(FabricStateCorruptionError)
    expect(manifestCalls).toBe(0)
    expect(keyringWrites).toBe(0)
    expect(readFileSync(statePath, 'utf8')).toBe(corrupted)
  })

  it('pairs only after manifest verification and returns a redacted online summary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-fabric-control-'))
    directories.push(directory)
    const statePath = join(directory, 'fabric-state.json')
    const fixture = signedPairingFixture()
    const transportStore = new MemoryTransportStore()
    const client: FabricManifestClient = {
      fetchManifest: async () => fixture.manifest
    }
    const controlPlane = new FabricControlPlane({
      statePath,
      manifestClient: client,
      transportStoreFactory: () => transportStore,
      now: () => NOW
    })

    const summary = await controlPlane.pair(fixture.request)

    expect(summary).toEqual(
      expect.objectContaining({
        nodeId: 'node-gpu-01',
        trust: 'paired',
        availability: 'online',
        lastSequence: 7,
        resources: [expect.objectContaining({ id: 'qwen3-32b', nodeId: 'node-gpu-01' })]
      })
    )
    expect(summary).not.toHaveProperty('origin')
    expect(summary).not.toHaveProperty('signingPublicKeyPem')
    expect(readFileSync(statePath, 'utf8')).not.toContain('node.internal')
    expect(readFileSync(statePath, 'utf8')).not.toContain('secret-token')
    expect(transportStore.value).toEqual(fixture.request.transport)
    expect(controlPlane.createLocalToolsAdapter('node-gpu-01', 'qwen3-32b').id).toBe(
      'fabric:node-gpu-01:qwen3-32b'
    )
  })

  it('refreshes a paired Node only with a newer signed manifest sequence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-fabric-control-'))
    directories.push(directory)
    const fixture = signedPairingFixture()
    const manifests = [fixture.manifest, fixture.manifestForSequence(8)]
    const controlPlane = new FabricControlPlane({
      statePath: join(directory, 'fabric-state.json'),
      manifestClient: { fetchManifest: async () => manifests.shift() },
      transportStoreFactory: () => new MemoryTransportStore(),
      now: () => NOW
    })
    await controlPlane.pair(fixture.request)

    const refreshed = await controlPlane.refresh('node-gpu-01')

    expect(refreshed.lastSequence).toBe(8)
    expect(controlPlane.list()[0]).toEqual(refreshed)
  })

  it('keeps the paired checkpoint and marks the Node offline after a network failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-fabric-control-'))
    directories.push(directory)
    const fixture = signedPairingFixture()
    let online = true
    const controlPlane = new FabricControlPlane({
      statePath: join(directory, 'fabric-state.json'),
      manifestClient: {
        fetchManifest: async () => {
          if (online) return fixture.manifest
          throw new Error('ECONNREFUSED')
        }
      },
      transportStoreFactory: () => new MemoryTransportStore(),
      now: () => NOW
    })
    const paired = await controlPlane.pair(fixture.request)
    online = false

    await expect(controlPlane.refresh('node-gpu-01')).rejects.toThrow('ECONNREFUSED')

    expect(controlPlane.list()[0]).toEqual({
      ...paired,
      availability: 'offline',
      resources: []
    })
  })
})
