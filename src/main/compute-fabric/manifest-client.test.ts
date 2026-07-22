import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { FabricHttpsRequest } from './fabric-http-client'
import { FetchFabricManifestClient } from './manifest-client'

function requestReturning(
  body: string,
  headers: Record<string, string>,
  observeOptions?: (options: RequestOptions) => void
): FabricHttpsRequest {
  return (options, onResponse) => {
    observeOptions?.(options)
    const request = new EventEmitter() as unknown as ClientRequest
    request.end = (() => {
      const response = Readable.from([Buffer.from(body, 'utf8')]) as unknown as IncomingMessage
      response.statusCode = 200
      response.statusMessage = 'OK'
      response.headers = headers
      onResponse(response)
      return request
    }) as ClientRequest['end']
    return request
  }
}

describe('Compute Fabric manifest HTTP client', () => {
  it('fetches a bounded JSON manifest from the main-owned Node origin', async () => {
    let requestOptions: RequestOptions | undefined
    const manifest = { schema: 'autowin.node-manifest/v1' }
    const options = {
      requestFn: requestReturning(
        JSON.stringify(manifest),
        { 'content-type': 'application/json' },
        (value) => {
          requestOptions = value
        }
      )
    }
    const client = new FetchFabricManifestClient(options)

    await expect(
      client.fetchManifest({
        origin: 'https://node.internal:7443',
        tlsSpkiSha256: 'c'.repeat(64),
        bearerToken: 'secret-token'
      })
    ).resolves.toEqual(manifest)
    expect(requestOptions).toEqual(
      expect.objectContaining({
        hostname: 'node.internal',
        path: '/v1/manifest',
        method: 'GET',
        rejectUnauthorized: true
      })
    )
    expect(requestOptions?.checkServerIdentity).toBeTypeOf('function')
    expect((requestOptions?.headers as Record<string, string>).authorization).toContain(
      'secret-token'
    )
  })

  it('rejects a manifest body declared above the one-megabyte boundary', async () => {
    const options = {
      requestFn: requestReturning('{}', {
        'content-type': 'application/json',
        'content-length': String(1024 * 1024 + 1)
      })
    }
    const client = new FetchFabricManifestClient(options)

    await expect(
      client.fetchManifest({
        origin: 'https://node.internal:7443',
        tlsSpkiSha256: 'c'.repeat(64)
      })
    ).rejects.toThrow(/trop volumineux/i)
  })
})
