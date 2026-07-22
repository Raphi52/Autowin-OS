import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { FabricHttpsRequest } from './fabric-http-client'
import type { FabricNodeTransportStore } from './node-transport-store'
import { FabricResourceAdapter } from './resource-adapter'

function sseRequest(
  frames: unknown[],
  observeOptions: (options: RequestOptions) => void,
  observeBody: (body: string) => void
): FabricHttpsRequest {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
  return (options, onResponse) => {
    observeOptions(options)
    const request = new EventEmitter() as unknown as ClientRequest
    request.end = ((requestBody?: unknown) => {
      observeBody(typeof requestBody === 'string' ? requestBody : '')
      const response = Readable.from([Buffer.from(body, 'utf8')]) as unknown as IncomingMessage
      response.statusCode = 200
      response.statusMessage = 'OK'
      response.headers = { 'content-type': 'text/event-stream; charset=utf-8' }
      onResponse(response)
      return request
    }) as ClientRequest['end']
    return request
  }
}

async function consume(adapter: FabricResourceAdapter): Promise<{
  chunks: string[]
  result: Awaited<ReturnType<ReturnType<FabricResourceAdapter['send']>['return']>>['value']
}> {
  const generator = adapter.send([{ role: 'user', content: 'Bonjour' }], {
    system: 'Réponds brièvement.',
    requestId: 'turn-01'
  })
  const chunks: string[] = []
  let step = await generator.next()
  while (!step.done) {
    chunks.push(step.value.delta)
    step = await generator.next()
  }
  return { chunks, result: step.value }
}

describe('Compute Fabric local-tools resource adapter', () => {
  it('sends the stable Node request and consumes ordered SSE events', async () => {
    let requestOptions: RequestOptions | undefined
    let requestBody = ''
    const requestFn = sseRequest(
      [
        {
          schema: 'autowin.node-chat-event/v1',
          requestId: 'turn-01',
          sequence: 1,
          type: 'delta',
          delta: 'CONNEXION_'
        },
        {
          schema: 'autowin.node-chat-event/v1',
          requestId: 'turn-01',
          sequence: 2,
          type: 'delta',
          delta: 'OK'
        },
        {
          schema: 'autowin.node-chat-event/v1',
          requestId: 'turn-01',
          sequence: 3,
          type: 'completed',
          usage: { inputTokens: 12, outputTokens: 4 }
        }
      ],
      (value) => {
        requestOptions = value
      },
      (value) => {
        requestBody = value
      }
    )
    const transportStore: FabricNodeTransportStore = {
      get: () => ({
        origin: 'https://node.internal:7443',
        tlsSpkiSha256: 'c'.repeat(64),
        bearerToken: 'secret-token'
      }),
      set: () => undefined,
      delete: () => false
    }
    const options = {
      nodeId: 'node-gpu-01',
      resourceId: 'qwen3-32b',
      manifestDigest: 'b'.repeat(64),
      transportStore,
      requestFn
    }
    const adapter = new FabricResourceAdapter(options)

    const { chunks, result } = await consume(adapter)

    expect(chunks).toEqual(['CONNEXION_', 'OK'])
    expect(result).toEqual(
      expect.objectContaining({
        text: 'CONNEXION_OK',
        provider: 'fabric:node-gpu-01:qwen3-32b',
        systemInjected: true,
        usage: { inputTokens: 12, outputTokens: 4 }
      })
    )
    expect(requestOptions).toEqual(
      expect.objectContaining({
        hostname: 'node.internal',
        path: '/v1/executions/chat',
        method: 'POST',
        rejectUnauthorized: true
      })
    )
    expect(requestOptions?.checkServerIdentity).toBeTypeOf('function')
    expect(JSON.parse(requestBody)).toEqual(
      expect.objectContaining({
        schema: 'autowin.node-chat-request/v1',
        requestId: 'turn-01',
        resourceId: 'qwen3-32b',
        manifestDigest: 'b'.repeat(64),
        mode: 'local-tools'
      })
    )
    expect((requestOptions?.headers as Record<string, string>).authorization).toContain(
      'secret-token'
    )
  })
})
