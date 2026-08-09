import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainWorkerClient, type BrainWorkerLike } from './brain-worker-client'

class FakeWorker extends EventEmitter implements BrainWorkerLike {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn().mockResolvedValue(0)
}

describe('BrainWorkerClient lifecycle', () => {
  afterEach(() => vi.useRealTimers())
  it('rejette la generation morte puis redemarre sur la requete suivante sans pending residuel', async () => {
    const first = new FakeWorker()
    const second = new FakeWorker()
    const createWorker = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const client = new BrainWorkerClient('brain-worker.js', createWorker)

    const failed = client.request('listBrains')
    first.emit('exit', 1)
    await expect(failed).rejects.toThrow(/code 1/)
    expect(client.pendingCount).toBe(0)

    const recovered = client.request<string>('loadPreview', 'brain')
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

    const recovered = client.request<string>('loadPreview', 'brain')
    const secondId = second.postMessage.mock.calls[0][0].id as number
    first.emit('message', { id: firstId, ok: true, value: 'stale' })
    second.emit('message', { id: secondId, ok: true, value: 'fresh' })

    await expect(recovered).resolves.toBe('fresh')
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

    const recovered = client.request<string>('loadPreview', 'brain')
    expect(first.terminate).toHaveBeenCalledOnce()
    expect(createWorker).toHaveBeenCalledTimes(2)
    const request = second.postMessage.mock.calls[0][0] as { id: number }
    second.emit('message', { id: request.id, ok: true, value: 'fresh' })

    await expect(recovered).resolves.toBe('fresh')
    expect(client.pendingCount).toBe(0)
  })
})
