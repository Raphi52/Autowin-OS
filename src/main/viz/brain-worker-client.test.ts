import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainWorkerClient, type BrainWorkerLike } from './brain-worker-client'

class FakeWorker extends EventEmitter implements BrainWorkerLike {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn().mockResolvedValue(0)
}

describe('BrainWorkerClient lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  it("survit a l'echec de creation initial puis recupere a la requete suivante", async () => {
    const fresh = new FakeWorker()
    const createWorker = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('INITIAL_CREATE_FAILED')
      })
      .mockReturnValueOnce(fresh)
    let client!: BrainWorkerClient

    expect(() => {
      client = new BrainWorkerClient('brain-worker.js', createWorker)
    }).not.toThrow()
    await expect(client.request('listBrains')).rejects.toThrow('INITIAL_CREATE_FAILED')

    const recovered = client.request('listBrains')
    const request = fresh.postMessage.mock.calls[0][0] as { id: number }
    fresh.emit('message', { id: request.id, ok: true, value: 'RECOVERED' })
    await expect(recovered).resolves.toBe('RECOVERED')
    expect(client.pendingCount).toBe(0)
  })

  it('rejette la generation morte puis redemarre sur la requete suivante sans pending residuel', async () => {
    const first = new FakeWorker()
    const second = new FakeWorker()
    const createWorker = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const client = new BrainWorkerClient('brain-worker.js', createWorker)

    const failed = client.request('listBrains')
    first.emit('exit', 1)
    await expect(failed).rejects.toThrow(/code 1/)
    expect(client.pendingCount).toBe(0)

    const recovered = client.request('loadPreview', 'brain')
    expect(createWorker).toHaveBeenCalledTimes(2)
    const request = second.postMessage.mock.calls[0][0] as { id: number }
    second.emit('message', { id: request.id, ok: true, value: 'recovered' })

    await expect(recovered).resolves.toBe('recovered')
    expect(client.pendingCount).toBe(0)
  })

  it('ignore une reponse tardive de la generation en panne', async () => {
    const first = new FakeWorker()
    const second = new FakeWorker()
    const client = new BrainWorkerClient(
      'brain-worker.js',
      vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    )

    const failed = client.request('listBrains')
    const firstId = first.postMessage.mock.calls[0][0].id as number
    first.emit('error', new Error('boom'))
    await expect(failed).rejects.toThrow('boom')

    const recovered = client.request('loadPreview', 'brain')
    const secondId = second.postMessage.mock.calls[0][0].id as number
    first.emit('message', { id: firstId, ok: true, value: 'stale' })
    second.emit('message', { id: secondId, ok: true, value: 'fresh' })

    await expect(recovered).resolves.toBe('fresh')
    expect(client.pendingCount).toBe(0)
  })

  it("convertit l'echec synchrone de creation en rejet puis recupere au prochain appel", async () => {
    const first = new FakeWorker()
    const fresh = new FakeWorker()
    const createWorker = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockImplementationOnce(() => {
        throw new Error('CREATE_WORKER_FAILED')
      })
      .mockReturnValueOnce(fresh)
    const client = new BrainWorkerClient('brain-worker.js', createWorker)
    first.emit('exit', 1)

    let failed: Promise<unknown> | undefined
    expect(() => {
      failed = client.request('searchBrain', 'brain', 'query')
    }).not.toThrow()
    await expect(failed).rejects.toThrow('CREATE_WORKER_FAILED')

    const recovered = client.request('searchBrain', 'brain', 'query')
    const request = fresh.postMessage.mock.calls[0][0] as { id: number }
    fresh.emit('message', { id: request.id, ok: true, value: 'RECOVERED' })
    await expect(recovered).resolves.toBe('RECOVERED')
    expect(client.pendingCount).toBe(0)
  })

  it('borne les appels en attente et expire un worker vivant mais bloque', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const client = new BrainWorkerClient('brain-worker.js', () => worker, 50, 1)

    const blocked = client.request('listBrains')
    const timedOut = expect(blocked).rejects.toThrow(/sans reponse/)
    await expect(client.request('loadPreview', 'brain')).rejects.toThrow(/sature/)
    await vi.advanceTimersByTimeAsync(51)
    await timedOut
    expect(client.pendingCount).toBe(0)
  })

  it('remplace la generation bloquee apres timeout et laisse la suivante reussir', async () => {
    vi.useFakeTimers()
    const first = new FakeWorker()
    const second = new FakeWorker()
    const createWorker = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const client = new BrainWorkerClient('brain-worker.js', createWorker, 50)

    const blocked = client.request('listBrains')
    const timedOut = expect(blocked).rejects.toThrow(/sans reponse/)
    await vi.advanceTimersByTimeAsync(51)
    await timedOut

    const recovered = client.request('loadPreview', 'brain')
    expect(first.terminate).toHaveBeenCalledOnce()
    expect(createWorker).toHaveBeenCalledTimes(2)
    const request = second.postMessage.mock.calls[0][0] as { id: number }
    second.emit('message', { id: request.id, ok: true, value: 'fresh' })

    await expect(recovered).resolves.toBe('fresh')
    expect(client.pendingCount).toBe(0)
  })

  it('un worker de recherche bloque ne fait pas tomber un worker de graphe distinct', async () => {
    vi.useFakeTimers()
    const graphWorker = new FakeWorker()
    const searchWorker = new FakeWorker()
    const graphClient = new BrainWorkerClient('brain-worker.js', () => graphWorker, 2_000)
    const searchClient = new BrainWorkerClient('brain-worker.js', () => searchWorker, 2_000)

    const graph = graphClient.request('loadGraph', 'brain')
    const blockedSearch = searchClient.requestWithTimeout(50, 'searchBrain', 'brain', 'query')
    const timedOut = expect(blockedSearch).rejects.toThrow(/sans reponse/)
    await vi.advanceTimersByTimeAsync(51)
    await timedOut

    const graphRequest = graphWorker.postMessage.mock.calls[0][0] as { id: number }
    graphWorker.emit('message', { id: graphRequest.id, ok: true, value: 'graph-ready' })
    await expect(graph).resolves.toBe('graph-ready')
    expect(searchWorker.terminate).toHaveBeenCalledOnce()
    expect(graphWorker.terminate).not.toHaveBeenCalled()
  })

  it("retire une generation saturee plutot que de refuser l'invalidation", async () => {
    const saturated = new FakeWorker()
    const fresh = new FakeWorker()
    const createWorker = vi.fn().mockReturnValueOnce(saturated).mockReturnValueOnce(fresh)
    const client = new BrainWorkerClient('brain-worker.js', createWorker, 2_000, 1)

    const staleSearch = client.request('searchBrain', 'brain', 'old')
    const staleError = staleSearch.catch((error: unknown) => error)

    await expect(client.invalidate()).resolves.toBeUndefined()
    expect(await staleError).toMatchObject({
      message: expect.stringMatching(/invalidation prioritaire/)
    })
    expect(saturated.terminate).toHaveBeenCalledOnce()
    expect(client.pendingCount).toBe(0)

    const nextSearch = client.request('searchBrain', 'brain', 'new')
    const request = fresh.postMessage.mock.calls[0][0] as { id: number }
    fresh.emit('message', { id: request.id, ok: true, value: 'NEW' })
    await expect(nextSearch).resolves.toBe('NEW')
  })

  it("retire immediatement une generation occupee sans attendre qu'elle soit saturee", async () => {
    const busy = new FakeWorker()
    const fresh = new FakeWorker()
    const createWorker = vi.fn().mockReturnValueOnce(busy).mockReturnValueOnce(fresh)
    const client = new BrainWorkerClient('brain-worker.js', createWorker, 30_000, 64)

    const staleError = client.request('loadGraph', 'brain').catch((error: unknown) => error)
    const invalidation = client.invalidate()

    expect(busy.terminate).toHaveBeenCalledOnce()
    await expect(invalidation).resolves.toBeUndefined()
    expect(await staleError).toMatchObject({
      message: expect.stringMatching(/invalidation prioritaire/)
    })

    const nextGraph = client.request('loadGraph', 'brain')
    const request = fresh.postMessage.mock.calls[0][0] as { id: number }
    fresh.emit('message', { id: request.id, ok: true, value: 'FRESH' })
    await expect(nextGraph).resolves.toBe('FRESH')
  })

  it('retire un vrai worker CPU-bloque sans attendre son timeout general', async () => {
    let generation = 0
    const client = new BrainWorkerClient(
      'unused',
      () => {
        generation += 1
        return new Worker(
          generation === 1
            ? `const { parentPort } = require('node:worker_threads');
               parentPort.on('message', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));`
            : `const { parentPort } = require('node:worker_threads');
               parentPort.on('message', (message) => parentPort.postMessage({ id: message.id, ok: true, value: 'FRESH' }));`,
          { eval: true }
        )
      },
      2_000,
      64
    )

    const blockedError = client.request('loadGraph', 'brain').catch((error: unknown) => error)
    const startedAt = Date.now()
    await client.invalidate()

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(await blockedError).toMatchObject({
      message: expect.stringMatching(/invalidation prioritaire/)
    })
    await expect(client.request('loadGraph', 'brain')).resolves.toBe('FRESH')
  })

  it("retire un worker idle silencieux sans attendre l'acquittement de son invalidate", async () => {
    let generation = 0
    const client = new BrainWorkerClient(
      'unused',
      () => {
        generation += 1
        return new Worker(
          generation === 1
            ? `const { parentPort } = require('node:worker_threads');
               parentPort.on('message', () => undefined);`
            : `const { parentPort } = require('node:worker_threads');
               parentPort.on('message', (message) => parentPort.postMessage({ id: message.id, ok: true, value: 'FRESH' }));`,
          { eval: true }
        )
      },
      2_000,
      64
    )

    const startedAt = Date.now()
    await client.invalidate()

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    await expect(client.request('loadGraph', 'brain')).resolves.toBe('FRESH')
  })

  it('borne et remplace un vrai worker dont le thread natif reste bloque', async () => {
    let generation = 0
    const client = new BrainWorkerClient(
      'unused',
      () => {
        generation += 1
        return new Worker(
          generation === 1
            ? `const { parentPort } = require('node:worker_threads');
               parentPort.on('message', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));`
            : `const { parentPort } = require('node:worker_threads');
               parentPort.on('message', (message) => parentPort.postMessage({ id: message.id, ok: true, value: 'fresh' }));`,
          { eval: true }
        )
      },
      2_000
    )

    const startedAt = Date.now()
    await expect(client.requestWithTimeout(100, 'listBrains')).rejects.toThrow(/sans reponse/)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    await expect(client.request('listBrains')).resolves.toBe('fresh')
  })
})
