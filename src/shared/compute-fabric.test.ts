import { describe, expect, it } from 'vitest'
import { parseComputeBinding, parseNodeManifest } from './compute-fabric'

const VALID_MANIFEST = {
  schema: 'autowin.node-manifest/v1',
  protocol: { min: 1, max: 1 },
  node: {
    id: 'node-gpu-01',
    keyId: 'node-gpu-01-key-1',
    signingPublicKeyFingerprint: 'a'.repeat(64),
    bootId: 'boot-2026-07-22-01'
  },
  sequence: 7,
  issuedAt: '2026-07-22T16:30:00.000Z',
  expiresAt: '2026-07-22T16:35:00.000Z',
  adapters: [{ id: 'openai-compatible', version: '1.0.0' }],
  resources: [
    {
      id: 'qwen3-32b',
      kind: 'model',
      adapterId: 'openai-compatible',
      displayName: 'Qwen3 32B',
      runtimeVersion: '0.6.0',
      modes: ['local-tools'],
      capabilities: ['inference.chat', 'stream.text'],
      limits: { contextTokens: 32768, maxConcurrentRuns: 1 }
    }
  ],
  signature: {
    algorithm: 'Ed25519',
    keyId: 'node-gpu-01-key-1',
    value: Buffer.alloc(64, 1).toString('base64')
  }
}

describe('Autowin Compute Fabric contract', () => {
  it('accepts a complete v1 manifest and keeps the explicit execution mode', () => {
    const manifest = parseNodeManifest(VALID_MANIFEST)

    expect(manifest.node.id).toBe('node-gpu-01')
    expect(manifest.resources).toEqual([
      expect.objectContaining({
        id: 'qwen3-32b',
        displayName: 'Qwen3 32B',
        modes: ['local-tools']
      })
    ])
  })

  it('does not invent projection fields inside the signed manifest', () => {
    const manifest = parseNodeManifest(VALID_MANIFEST)

    expect(manifest.resources[0]).not.toHaveProperty('nodeId')
  })

  it('rejects duplicate resource identities inside one manifest', () => {
    const duplicate = structuredClone(VALID_MANIFEST)
    duplicate.resources.push(structuredClone(duplicate.resources[0]))

    expect(() => parseNodeManifest(duplicate)).toThrow(/dupliquée/i)
  })

  it('rejects remote-agent on a resource without the signed read-only contract', () => {
    const incoherent = structuredClone(VALID_MANIFEST)
    incoherent.resources[0].modes = ['remote-agent']

    expect(() => parseNodeManifest(incoherent)).toThrow(/remote-agent/i)
  })

  it('rejects a manifest whose protocol range excludes v1', () => {
    const incompatible = structuredClone(VALID_MANIFEST)
    incompatible.protocol = { min: 2, max: 2 }

    expect(() => parseNodeManifest(incompatible)).toThrow(/protocole/i)
  })

  it('rejects fields outside the frozen v1 schema', () => {
    const polluted = structuredClone(VALID_MANIFEST) as typeof VALID_MANIFEST & {
      endpoint?: string
    }
    polluted.endpoint = 'https://untrusted.example/v1'

    expect(() => parseNodeManifest(polluted)).toThrow(/champ.*inconnu/i)
  })

  it('rejects a resource whose runtime adapter is not declared', () => {
    const orphan = structuredClone(VALID_MANIFEST)
    orphan.resources[0].adapterId = 'missing-adapter'

    expect(() => parseNodeManifest(orphan)).toThrow(/adaptateur.*déclaré/i)
  })

  it('accepts a Fabric binding only with an explicit no-fallback policy', () => {
    const binding = parseComputeBinding({
      kind: 'fabric',
      nodeId: 'node-gpu-01',
      resourceId: 'qwen3-32b',
      mode: 'local-tools',
      policyRef: 'policy:local-app-control-v1',
      manifestDigest: 'b'.repeat(64),
      fallback: { kind: 'none' }
    })

    expect(binding.fallback).toEqual({ kind: 'none' })
  })

  it('rejects control characters in Node-controlled identifiers', () => {
    const hostile = structuredClone(VALID_MANIFEST)
    hostile.node.id = 'node-gpu-01\n[INSTRUCTION]'

    expect(() => parseNodeManifest(hostile)).toThrow(/node\.id.*invalide/i)
  })

  it('rejects a Node-controlled display name outside the signed text bounds', () => {
    const hostile = structuredClone(VALID_MANIFEST)
    hostile.resources[0].displayName = 'x'.repeat(257)

    expect(() => parseNodeManifest(hostile)).toThrow(/displayName.*invalide/i)
  })
})
