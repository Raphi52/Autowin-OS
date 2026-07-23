import { createHash, X509Certificate } from 'node:crypto'
import { rootCertificates, type DetailedPeerCertificate } from 'node:tls'
import { describe, expect, it } from 'vitest'
import * as fabricHttpClient from './fabric-http-client'
import { checkFabricServerIdentity, createFabricHttpsRequestOptions } from './fabric-http-client'

function certificateFor(hostname: string, certificateDer: Buffer): DetailedPeerCertificate {
  return {
    subject: { CN: hostname },
    issuer: { CN: 'Autowin test CA' },
    subjectaltname: `DNS:${hostname}`,
    raw: certificateDer
  } as DetailedPeerCertificate
}

function rootSpki(index: number): { certificateDer: Buffer; sha256: string } {
  const certificate = new X509Certificate(rootCertificates[index])
  const der = certificate.publicKey.export({ format: 'der', type: 'spki' })
  return {
    certificateDer: certificate.raw,
    sha256: createHash('sha256').update(der).digest('hex')
  }
}

describe('Compute Fabric pinned HTTPS transport', () => {
  it('does not expose a replaceable HTTPS request seam in the production API', () => {
    expect(fabricHttpClient).not.toHaveProperty('createFabricTransportFetch')
  })

  it('accepts the expected TLS SPKI after standard hostname verification', () => {
    const spki = rootSpki(0)

    expect(
      checkFabricServerIdentity(
        'node.internal',
        certificateFor('node.internal', spki.certificateDer),
        spki.sha256
      )
    ).toBeUndefined()
  })

  it('rejects a TLS certificate whose SPKI does not match the pinned fingerprint', () => {
    const presented = rootSpki(0)
    const expected = rootSpki(1)

    const error = checkFabricServerIdentity(
      'node.internal',
      certificateFor('node.internal', presented.certificateDer),
      expected.sha256
    )

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toMatch(/pin TLS\/SPKI/i)
  })

  it('wires the Node pin into strict HTTPS request options', () => {
    const expected = rootSpki(0)
    const presented = rootSpki(1)
    const options = createFabricHttpsRequestOptions(
      {
        origin: 'https://node.internal:7443',
        tlsSpkiSha256: expected.sha256
      },
      '/v1/manifest',
      { method: 'GET', headers: { accept: 'application/json' } }
    )

    expect(options).toEqual(
      expect.objectContaining({
        protocol: 'https:',
        hostname: 'node.internal',
        port: '7443',
        path: '/v1/manifest',
        method: 'GET',
        agent: false,
        rejectUnauthorized: true
      })
    )
    expect(
      options.checkServerIdentity?.(
        'node.internal',
        certificateFor('node.internal', presented.certificateDer)
      )
    ).toBeInstanceOf(Error)
  })

  it('rejects a request path that could escape the paired Node origin', () => {
    expect(() =>
      createFabricHttpsRequestOptions(
        {
          origin: 'https://node.internal:7443',
          tlsSpkiSha256: 'c'.repeat(64)
        },
        '//attacker.invalid/v1/manifest',
        { method: 'GET', headers: { accept: 'application/json' } }
      )
    ).toThrow(/chemin HTTPS.*invalide/i)
  })

  it('normalizes a bracketed IPv6 origin for Node HTTPS socket resolution', () => {
    const options = createFabricHttpsRequestOptions(
      { origin: 'https://[::1]:7443', tlsSpkiSha256: 'c'.repeat(64) },
      '/v1/manifest',
      { method: 'GET', headers: { accept: 'application/json' } }
    )

    expect(options.hostname).toBe('::1')
    expect(options.port).toBe('7443')
  })
})
