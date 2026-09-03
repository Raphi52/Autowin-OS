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
class WorktreeOperationTimeoutError extends Error {
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

  /**
   * `timeoutMs` par appel, parce qu'un budget unique est une erreur de catégorie.
   *
   * Le budget par défaut est celui d'UNE commande git (30 s + 2). MESURÉ : l'inventaire de
   * récupération, lui, balaie 52 copies — chacune avec plusieurs sous-processus git — et il a été
   * interrompu à 32 000 ms, laissant la récupération en échec alors qu'elle progressait normalement.
   * Le message affiché disait la vérité (« interrompu après 32000 ms ») ; c'est la limite qui était
   * fausse, pas la mesure.
   */
  run<T>(
    request: WorktreeOperationRequest,
    callbacks: {
      onPrepared?: (agentSha: string, baseSha: string) => void
      onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
    } = {},
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
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
        () => finish({ error: new WorktreeOperationTimeoutError(timeoutMs) }),
        timeoutMs
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
