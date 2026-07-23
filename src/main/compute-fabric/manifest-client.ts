import type { FabricManifestClient } from './control-plane'
import { fetchFabricTransport } from './fabric-http-client'
import type { FabricNodeTransport } from './node-transport-store'

const MAX_MANIFEST_BYTES = 1024 * 1024

async function cancelBody(response: Response, reason: string): Promise<void> {
  try {
    await response.body?.cancel(reason)
  } catch {
    // The original validation error remains authoritative.
  }
}

export interface FetchFabricManifestClientOptions {
  timeoutMs?: number
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
    await cancelBody(response, 'manifest-too-large')
    throw new Error('Manifeste Autowin Node trop volumineux')
  }
  if (!response.body) throw new Error('Manifeste Autowin Node vide')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  let exhausted = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        exhausted = true
        break
      }
      received += value.byteLength
      if (received > MAX_MANIFEST_BYTES) {
        await reader.cancel('manifest-too-large')
        throw new Error('Manifeste Autowin Node trop volumineux')
      }
      chunks.push(value)
    }
  } finally {
    if (!exhausted) {
      try {
        await reader.cancel('manifest-read-aborted')
      } catch {
        // The original read/validation error remains authoritative.
      }
    }
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
  private readonly timeoutMs: number

  constructor(options: FetchFabricManifestClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 3_000
  }

  async fetchManifest(transport: FabricNodeTransport): Promise<unknown> {
    const response = await fetchFabricTransport(transport, '/v1/manifest', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(transport.bearerToken ? { authorization: `Bearer ${transport.bearerToken}` } : {})
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) {
      await cancelBody(response, 'manifest-http-error')
      throw new Error(`Autowin Node HTTP ${response.status}`)
    }
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      await cancelBody(response, 'manifest-content-type')
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
