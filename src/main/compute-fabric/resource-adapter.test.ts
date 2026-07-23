import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchFabricTransport = vi.hoisted(() => vi.fn())
vi.mock('./fabric-http-client', () => ({ fetchFabricTransport }))

import type { FabricNodeTransportStore } from './node-transport-store'
import { FabricResourceAdapter } from './resource-adapter'

function sseResponse(
  frames: unknown[],
  options: { close?: boolean; cancel?: () => void } = {}
): Response {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        if (options.close !== false) controller.close()
      },
      cancel: options.cancel
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
  )
}

beforeEach(() => fetchFabricTransport.mockReset())

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
    fetchFabricTransport.mockResolvedValueOnce(
      sseResponse([
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
      ])
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
      trustGuard: () => undefined
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
    expect(fetchFabricTransport).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://node.internal:7443' }),
      '/v1/executions/chat',
      expect.objectContaining({ method: 'POST' })
    )
    const request = fetchFabricTransport.mock.calls[0]?.[2] as { body: string; headers: object }
    const requestBody = request.body
    expect(JSON.parse(requestBody)).toEqual(
      expect.objectContaining({
        schema: 'autowin.node-chat-request/v1',
        requestId: 'turn-01',
        resourceId: 'qwen3-32b',
        manifestDigest: 'b'.repeat(64),
        mode: 'local-tools'
      })
    )
    expect(request.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer secret-token' })
    )
  })

  it('rejects a stale trust generation before reading keyring or opening network', async () => {
    const get = vi.fn(() => ({
      origin: 'https://node.internal:7443',
      tlsSpkiSha256: 'c'.repeat(64)
    }))

    const adapter = new FabricResourceAdapter({
      nodeId: 'node-gpu-01',
      resourceId: 'qwen3-32b',
      manifestDigest: 'b'.repeat(64),
      transportStore: { get, set: () => undefined, delete: () => false },
      trustGuard: () => {
        throw new Error('Adapter Compute Fabric périmé')
      }
    })

    const generator = adapter.send([{ role: 'user', content: 'Bonjour' }])

    await expect(generator.next()).rejects.toThrow(/périmé/i)
    expect(get).not.toHaveBeenCalled()
    expect(fetchFabricTransport).not.toHaveBeenCalled()
  })

  it('cancels the SSE body when its consumer stops before completion', async () => {
    const cancel = vi.fn()
    fetchFabricTransport.mockResolvedValueOnce(
      sseResponse(
        [
          {
            schema: 'autowin.node-chat-event/v1',
            requestId: 'turn-cancel',
            sequence: 1,
            type: 'delta',
            delta: 'partial'
          }
        ],
        { close: false, cancel }
      )
    )
    const adapter = new FabricResourceAdapter({
      nodeId: 'node-gpu-01',
      resourceId: 'qwen3-32b',
      manifestDigest: 'b'.repeat(64),
      transportStore: {
        get: () => ({
          origin: 'https://node.internal:7443',
          tlsSpkiSha256: 'c'.repeat(64)
        }),
        set: () => undefined,
        delete: () => false
      },
      trustGuard: () => undefined
    })
    const generator = adapter.send([{ role: 'user', content: 'Bonjour' }], {
      requestId: 'turn-cancel'
    })

    await expect(generator.next()).resolves.toMatchObject({ value: { delta: 'partial' } })
    await generator.return(undefined as never)

    expect(cancel).toHaveBeenCalledWith('chat-stream-aborted')
  })
})
