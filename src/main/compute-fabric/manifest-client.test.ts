import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchFabricTransport = vi.hoisted(() => vi.fn())
vi.mock('./fabric-http-client', () => ({ fetchFabricTransport }))

import { FetchFabricManifestClient } from './manifest-client'

const transport = {
  origin: 'https://node.internal:7443',
  tlsSpkiSha256: 'c'.repeat(64),
  bearerToken: 'secret-token'
}

beforeEach(() => fetchFabricTransport.mockReset())

describe('Compute Fabric manifest HTTP client', () => {
  it('fetches a bounded JSON manifest from the main-owned Node origin', async () => {
    const manifest = { schema: 'autowin.node-manifest/v1' }
    fetchFabricTransport.mockResolvedValueOnce(
      new Response(JSON.stringify(manifest), {
        headers: { 'content-type': 'application/json' }
      })
    )
    const client = new FetchFabricManifestClient()

    await expect(client.fetchManifest(transport)).resolves.toEqual(manifest)
    expect(fetchFabricTransport).toHaveBeenCalledWith(
      transport,
      '/v1/manifest',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer secret-token' })
      })
    )
  })

  it('rejects a manifest body declared above the one-megabyte boundary', async () => {
    fetchFabricTransport.mockResolvedValueOnce(
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'content-length': String(1024 * 1024 + 1)
        }
      })
    )
    const client = new FetchFabricManifestClient()

    await expect(client.fetchManifest(transport)).rejects.toThrow(/trop volumineux/i)
  })

  it('cancels the response body when the manifest content type is invalid', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    fetchFabricTransport.mockResolvedValueOnce(
      new Response(body, { headers: { 'content-type': 'text/plain' } })
    )
    const client = new FetchFabricManifestClient()

    await expect(client.fetchManifest(transport)).rejects.toThrow(/type de manifeste invalide/i)
    expect(cancel).toHaveBeenCalledWith('manifest-content-type')
  })
})
