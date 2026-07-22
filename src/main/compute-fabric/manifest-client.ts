import type { FabricManifestClient } from './control-plane'
import {
  createFabricTransportFetch,
  type FabricHttpsRequest,
  type FabricTransportFetch
} from './fabric-http-client'
import type { FabricNodeTransport } from './node-transport-store'

const MAX_MANIFEST_BYTES = 1024 * 1024

export interface FetchFabricManifestClientOptions {
  requestFn?: FabricHttpsRequest
  timeoutMs?: number
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
    throw new Error('Manifeste Autowin Node trop volumineux')
  }
  if (!response.body) throw new Error('Manifeste Autowin Node vide')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_MANIFEST_BYTES) {
        await reader.cancel('manifest-too-large')
        throw new Error('Manifeste Autowin Node trop volumineux')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

export class FetchFabricManifestClient implements FabricManifestClient {
  private readonly transportFetch: FabricTransportFetch
  private readonly timeoutMs: number

  constructor(options: FetchFabricManifestClientOptions = {}) {
    this.transportFetch = createFabricTransportFetch(
      options.requestFn ? { requestFn: options.requestFn } : {}
    )
    this.timeoutMs = options.timeoutMs ?? 3_000
  }

  async fetchManifest(transport: FabricNodeTransport): Promise<unknown> {
    const response = await this.transportFetch(transport, '/v1/manifest', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(transport.bearerToken ? { authorization: `Bearer ${transport.bearerToken}` } : {})
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) throw new Error(`Autowin Node HTTP ${response.status}`)
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      throw new Error('Autowin Node a renvoyé un type de manifeste invalide')
    }
    const body = await readBoundedBody(response)
    try {
      return JSON.parse(body)
    } catch {
      throw new Error('Manifeste Autowin Node JSON invalide')
    }
  }
}
