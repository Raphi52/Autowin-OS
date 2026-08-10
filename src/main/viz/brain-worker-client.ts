import { Worker } from 'node:worker_threads'

type BrainWorkerMethod =
  | 'listBrains'
  | 'loadPreview'
  | 'loadGraph'
  | 'loadThemes'
  | 'loadThemeNodes'
  | 'loadNeighborhood'
  | 'readNodeFile'
  | 'authorizeVault'
  | 'searchBrain'
  | 'fuseRetrieval'
  | 'invalidate'
  | 'graphifyEvidence'
type PendingCall = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}
type BrainWorkerResponse = { id: number; ok: boolean; value?: unknown; error?: string }

export interface BrainWorkerLike {
  on(event: 'message', listener: (message: BrainWorkerResponse) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(message: unknown): void
  terminate?(): Promise<number> | void
}

export type BrainWorkerFactory = (workerPath: string) => BrainWorkerLike

export class BrainWorkerClient {
  private worker: BrainWorkerLike | undefined
  private initialCreationError: Error | undefined
  private readonly pending = new Map<number, PendingCall>()
  private nextId = 0

  constructor(
    private readonly workerPath: string,
    private readonly createWorker: BrainWorkerFactory = (path) => new Worker(path),
    private readonly timeoutMs = 30_000,
    private readonly maxPending = 64
  ) {
    try {
      this.spawnWorker()
    } catch (error) {
      this.initialCreationError = error instanceof Error ? error : new Error(String(error))
    }
  }

  get pendingCount(): number {
    return this.pending.size
  }

  private spawnWorker(): BrainWorkerLike {
    const worker = this.createWorker(this.workerPath)
    this.worker = worker
    worker.on('message', (message) => {
      // Une ancienne génération peut encore vider sa file de messages après `error`. Elle ne doit
      // jamais résoudre un appel appartenant au worker de remplacement.
      if (this.worker !== worker) return
      const call = this.pending.get(message.id)
      if (!call) return
      this.pending.delete(message.id)
      clearTimeout(call.timeout)
      if (message.ok) call.resolve(message.value)
      else call.reject(new Error(message.error ?? 'Erreur inconnue du worker Brain'))
    })
    worker.on('error', (error) => this.failWorker(worker, error))
    worker.on('exit', (code) =>
      this.failWorker(worker, new Error(`Worker Brain arrêté avec le code ${code}`))
    )
    return worker
  }

  request<T>(method: BrainWorkerMethod, ...args: unknown[]): Promise<T> {
    return this.requestWithTimeout(this.timeoutMs, method, ...args)
  }

  /**
   * Invalidation prioritaire : les caches vivent uniquement dans le worker, donc retirer sa
   * génération est l'acquittement le plus fort. Aucun état idle/bloqué ne peut retarder Refresh.
   */
  invalidate(): Promise<void> {
    const worker = this.worker
    if (worker) {
      this.retireWorker(worker, new Error('Worker Brain retiré pour invalidation prioritaire'))
    }
    return Promise.resolve()
  }

  requestWithTimeout<T>(
    timeoutMs: number,
    method: BrainWorkerMethod,
    ...args: unknown[]
  ): Promise<T> {
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new Error(`Worker Brain sature (${this.maxPending} appels en attente)`))
    }
    if (this.initialCreationError) {
      const error = this.initialCreationError
      this.initialCreationError = undefined
      return Promise.reject(error)
    }
    const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, this.timeoutMs))
    const id = ++this.nextId
    let worker: BrainWorkerLike
    try {
      worker = this.worker ?? this.spawnWorker()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) return
        const error = new Error(`Worker Brain sans reponse apres ${boundedTimeoutMs} ms`)
        this.retireWorker(worker, error)
      }, boundedTimeoutMs)
      timeout.unref?.()
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout })
      try {
        worker.postMessage({ id, method, args })
      } catch (error) {
        this.failWorker(worker, error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private failWorker(worker: BrainWorkerLike, error: Error): void {
    if (this.worker !== worker) return
    this.worker = undefined
    this.rejectAll(error)
  }

  private retireWorker(worker: BrainWorkerLike, error: Error): void {
    this.failWorker(worker, error)
    try {
      void Promise.resolve(worker.terminate?.()).catch(() => undefined)
    } catch {
      // La génération est déjà retirée ; l'échec de terminaison ne doit pas masquer le basculement.
    }
  }

  private rejectAll(error: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timeout)
      call.reject(error)
    }
    this.pending.clear()
  }
}
