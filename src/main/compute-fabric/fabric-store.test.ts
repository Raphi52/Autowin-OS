import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FABRIC_STATE_SCHEMA,
  FabricStateCorruptionError,
  loadFabricState,
  saveFabricState,
  type FabricState
} from './fabric-store'

const directories: string[] = []

function temporaryFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autowin-fabric-'))
  directories.push(directory)
  return join(directory, 'fabric-state.json')
}

function pairedState(): FabricState {
  return {
    schema: FABRIC_STATE_SCHEMA,
    nodes: [
      {
        nodeId: 'node-gpu-01',
        keyId: 'node-gpu-01:signing:v1',
        signingPublicKeyFingerprint: 'a'.repeat(64),
        signingPublicKeyPem:
          '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----\n',
        transportRef: 'fabric-node:node-gpu-01',
        trust: 'paired',
        lastSequence: 7,
        lastManifestDigest: 'b'.repeat(64),
        lastVerifiedAt: '2026-07-22T16:30:00.000Z'
      }
    ]
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Compute Fabric state persistence', () => {
  it('round-trips paired trust state through an atomic public file', () => {
    const path = temporaryFile()
    const state = pairedState()

    saveFabricState(path, state)

    expect(loadFabricState(path)).toEqual(state)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(state)
  })

  it('rejects a raw network destination before writing public state', () => {
    const path = temporaryFile()
    const polluted = pairedState() as FabricState & {
      nodes: Array<FabricState['nodes'][number] & { endpoint: string }>
    }
    polluted.nodes[0].endpoint = 'https://node.internal:7443'

    expect(() => saveFabricState(path, polluted)).toThrow(/champ.*endpoint/i)
  })

  it('fails closed and preserves an existing corrupted state file', () => {
    const path = temporaryFile()
    const corrupted = '{"schema":"autowin.fabric-state/v1","nodes":['
    writeFileSync(path, corrupted, 'utf8')

    let failure: unknown
    try {
      loadFabricState(path)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(FabricStateCorruptionError)
    expect(failure).toMatchObject({ code: 'FABRIC_STATE_CORRUPT', statePath: path })
    expect(readFileSync(path, 'utf8')).toBe(corrupted)
  })
})
