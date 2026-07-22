import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { canonicalJson, verifyNodeManifest } from './manifest'

const NOW = new Date('2026-07-22T16:30:00.000Z')

function createSignedManifest() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const fingerprint = createHash('sha256').update(publicDer).digest('hex')
  const body = {
    schema: 'autowin.node-manifest/v1',
    protocol: { min: 1, max: 1 },
    node: {
      id: 'node-gpu-01',
      keyId: 'node-gpu-01-key-1',
      signingPublicKeyFingerprint: fingerprint,
      bootId: 'boot-01'
    },
    sequence: 7,
    issuedAt: '2026-07-22T16:29:30.000Z',
    expiresAt: '2026-07-22T16:34:30.000Z',
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
    ]
  }
  const signature = sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64')
  return {
    manifest: {
      ...body,
      signature: { algorithm: 'Ed25519', keyId: body.node.keyId, value: signature }
    },
    trust: {
      nodeId: body.node.id,
      keyId: body.node.keyId,
      signingPublicKeyFingerprint: fingerprint,
      signingPublicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString()
    }
  }
}

describe('Autowin Node signed manifests', () => {
  it('canonicalizes the signed JSON bytes deterministically', () => {
    expect(
      canonicalJson({
        z: 2,
        a: ['é', true, null],
        nested: { beta: 'b', alpha: 1 }
      })
    ).toBe('{"a":["é",true,null],"nested":{"alpha":1,"beta":"b"},"z":2}')
  })

  it('verifies a real Ed25519 signature and projects resources after verification', () => {
    const fixture = createSignedManifest()

    const verified = verifyNodeManifest(fixture.manifest, fixture.trust, {
      now: NOW,
      lastSequence: 6
    })

    expect(verified.manifestDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(verified.resources).toEqual([
      expect.objectContaining({
        nodeId: 'node-gpu-01',
        id: 'qwen3-32b',
        displayName: 'Qwen3 32B'
      })
    ])
  })

  it('rejects a runtime field changed after the manifest was signed', () => {
    const fixture = createSignedManifest()
    fixture.manifest.resources[0].runtimeVersion = '9.9.9'

    expect(() =>
      verifyNodeManifest(fixture.manifest, fixture.trust, { now: NOW, lastSequence: 6 })
    ).toThrow(/signature/i)
  })

  it.each([
    ['expired', new Date('2026-07-22T16:35:00.000Z'), 6, /expirée/i],
    ['replayed', NOW, 7, /rejouée|rollback/i]
  ])('rejects an %s signed manifest', (_case, now, lastSequence, expected) => {
    const fixture = createSignedManifest()

    expect(() =>
      verifyNodeManifest(fixture.manifest, fixture.trust, { now, lastSequence })
    ).toThrow(expected)
  })

  it('rejects a substituted public key even when the claimed fingerprint is unchanged', () => {
    const fixture = createSignedManifest()
    const substitute = generateKeyPairSync('ed25519').publicKey
    fixture.trust.signingPublicKeyPem = substitute
      .export({ format: 'pem', type: 'spki' })
      .toString()

    expect(() =>
      verifyNodeManifest(fixture.manifest, fixture.trust, { now: NOW, lastSequence: 6 })
    ).toThrow(/fingerprint/i)
  })
})
