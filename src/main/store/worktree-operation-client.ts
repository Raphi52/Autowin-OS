import { Worker } from 'node:worker_threads'
import type {
  WorktreeOperationRequest,
  WorktreeOperationResponse
} from './worktree-operation-protocol'

export interface WorktreeOperationWorkerLike {
  on(event: 'message', listener: (message: WorktreeOperationResponse) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(message: WorktreeOperationRequest): void
  terminate(): Promise<number>
}
export class WorktreeOperationTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Opération worktree interrompue après ${timeoutMs} ms`)
    this.name = 'WorktreeOperationTimeoutError'
  }
}

export class WorktreeOperationClient {
  private active = 0
  private readonly timeoutMs: number
  private readonly workerFactory: () => WorktreeOperationWorkerLike

  constructor(
    workerPath: string,
    options: {
      timeoutMs?: number
      workerFactory?: () => WorktreeOperationWorkerLike
    } = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.workerFactory = options.workerFactory ?? (() => new Worker(workerPath))
  }

  get pendingCount(): number {
    return this.active
  }

  run<T>(
    request: WorktreeOperationRequest,
    callbacks: {
      onPrepared?: (agentSha: string, baseSha: string) => void
      onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
    } = {}
  ): Promise<T> {
    const worker = this.workerFactory()
    this.active += 1
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (outcome: { value: T } | { error: Error }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.active -= 1
        void worker.terminate().catch(() => undefined)
        if ('error' in outcome) reject(outcome.error)
        else resolve(outcome.value)
      }
      const timer = setTimeout(
        () => finish({ error: new WorktreeOperationTimeoutError(this.timeoutMs) }),
        this.timeoutMs
      )
      ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()

      worker.on('message', (message) => {
        if (message.type === 'prepared') {
          callbacks.onPrepared?.(message.agentSha, message.baseSha)
          return
        }
        if (message.type === 'integrated') {
          callbacks.onIntegrated?.(message.integratedSha, message.agentSha, message.baseSha)
          return
        }
        if (message.type === 'error') finish({ error: new Error(message.error) })
        else finish({ value: message.value as T })
      })
      worker.on('error', (error) => finish({ error }))
      worker.on('exit', (code) => {
        if (!settled) finish({ error: new Error(`Worker worktree arrêté avec le code ${code}`) })
      })
      try {
        worker.postMessage(request)
      } catch (error) {
        finish({ error: error instanceof Error ? error : new Error(String(error)) })
      }
    })
  }
}
