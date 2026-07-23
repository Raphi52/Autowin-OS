import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import { checkServerIdentity, type PeerCertificate } from 'node:tls'
import { parseFabricNodeTransport, type FabricNodeTransport } from './node-transport-store'

const SHA256_HEX = /^[a-f0-9]{64}$/

export interface FabricTransportRequestInit {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type FabricTransportFetch = (
  transport: FabricNodeTransport,
  relativePath: string,
  init: FabricTransportRequestInit
) => Promise<Response>

export function checkFabricServerIdentity(
  hostname: string,
  certificate: PeerCertificate,
  expectedSpkiSha256: string
): Error | undefined {
  const identityError = checkServerIdentity(hostname, certificate)
  if (identityError) return identityError
  if (!SHA256_HEX.test(expectedSpkiSha256)) {
    return new Error('Pin TLS/SPKI Compute Fabric invalide')
  }
  let spkiDer: Buffer
  try {
    const publicKey = new X509Certificate(certificate.raw).publicKey
    spkiDer = publicKey.export({ format: 'der', type: 'spki' })
  } catch {
    return new Error('Certificat TLS Compute Fabric invalide')
  }
  const actual = createHash('sha256').update(spkiDer).digest()
  const expected = Buffer.from(expectedSpkiSha256, 'hex')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return new Error('Pin TLS/SPKI Compute Fabric non concordant')
  }
  return undefined
}

export function createFabricHttpsRequestOptions(
  transportValue: FabricNodeTransport,
  relativePath: string,
  init: FabricTransportRequestInit
): RequestOptions {
  const transport = parseFabricNodeTransport(transportValue)
  if (!relativePath.startsWith('/') || relativePath.startsWith('//')) {
    throw new Error('Chemin HTTPS Compute Fabric invalide')
  }
  const url = new URL(relativePath, `${transport.origin}/`)
  if (url.origin !== transport.origin) {
    throw new Error('Origine HTTPS Compute Fabric non concordante')
  }
  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
  return {
    protocol: 'https:',
    hostname,
    ...(url.port ? { port: url.port } : {}),
    path: `${url.pathname}${url.search}`,
    method: init.method,
    headers: init.headers,
    agent: false,
    rejectUnauthorized: true,
    checkServerIdentity: (hostname, certificate) =>
      checkFabricServerIdentity(hostname, certificate, transport.tlsSpkiSha256),
    ...(init.signal ? { signal: init.signal } : {})
  }
}

function toResponseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, String(value))
    }
  }
  return headers
}

export const fetchFabricTransport: FabricTransportFetch = async (transport, relativePath, init) =>
  new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      createFabricHttpsRequestOptions(transport, relativePath, init),
      (response) => {
        const status = response.statusCode
        if (!status || status < 200 || status > 599) {
          response.destroy()
          reject(new Error('Statut HTTP Compute Fabric invalide'))
          return
        }
        const hasBody = status !== 204 && status !== 205 && status !== 304
        const body = hasBody
          ? (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>)
          : null
        resolve(
          new Response(body, {
            status,
            statusText: response.statusMessage,
            headers: toResponseHeaders(response)
          })
        )
      }
    )
    request.once('error', reject)
    request.end(init.body)
  })
