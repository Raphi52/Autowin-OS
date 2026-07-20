import { Worker } from 'node:worker_threads'

type BrainWorkerMethod =
  | 'listBrains'
  | 'loadPreview'
  | 'loadGraph'
  | 'loadThemes'
  | 'loadThemeNodes'
  | 'loadNeighborhood'
  | 'readNodeFile'
  | 'searchBrain'
type PendingCall = { resolve(value: unknown): void; reject(error: Error): void }

export class BrainWorkerClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingCall>()
  private nextId = 0

  constructor(workerPath: string) {
    this.worker = new Worker(workerPath)
    this.worker.on(
      'message',
      (message: { id: number; ok: boolean; value?: unknown; error?: string }) => {
        const call = this.pending.get(message.id)
        if (!call) return
        this.pending.delete(message.id)
        if (message.ok) call.resolve(message.value)
        else call.reject(new Error(message.error ?? 'Erreur inconnue du worker Brain'))
      }
    )
    this.worker.on('error', (error) => this.rejectAll(error))
    this.worker.on('exit', (code) => {
      if (code !== 0) this.rejectAll(new Error(`Worker Brain arrêté avec le code ${code}`))
    })
  }

  request<T>(method: BrainWorkerMethod, ...args: unknown[]): Promise<T> {
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      this.worker.postMessage({ id, method, args })
    })
  }

  private rejectAll(error: Error): void {
    for (const call of this.pending.values()) call.reject(error)
    this.pending.clear()
  }
}
