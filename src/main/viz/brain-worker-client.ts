import { Worker } from 'node:worker_threads'
import type { BrainWorkerArgs, BrainWorkerMethod, BrainWorkerResult } from './brain-worker-contract'

type PendingCall = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
  /** Repart pour un tour de silence tolere — appele a chaque signe de vie du worker. */
  rearmer(): ReturnType<typeof setTimeout>
}
type BrainWorkerResponse = {
  id?: number
  ok?: boolean
  value?: unknown
  error?: string
  /** Signe de vie emis pendant un traitement long : ce n'est PAS une reponse. */
  vivant?: boolean
}

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
      /*
       * SIGNE DE VIE GLOBAL — le worker traite en SERIE : pendant une lecture longue, les autres
       * appels attendent dans sa file sans rien recevoir. Un battement adresse a la seule requete en
       * cours les laissait donc mourir. Tant que le worker parle, AUCUN de ses appels n'est perdu.
       */
      if (message.vivant) {
        for (const attente of this.pending.values()) {
          clearTimeout(attente.timeout)
          attente.timeout = attente.rearmer()
        }
        return
      }
      if (message.id === undefined) return
      const call = this.pending.get(message.id)
      if (!call) return
      /*
       * SIGNE DE VIE — mesure du 2026-09-08 : la premiere lecture du Brain sur un partage RESEAU
       * depasse 30 s (17 220 ms rien que pour les themes, puis 40 ms au rappel grace au cache). Le
       * delai tuait alors le worker AVEC son cache, donc l'essai suivant repartait de zero et
       * echouait pareil. On ne sanctionne plus la DUREE du travail, mais le SILENCE : tant que le
       * worker parle, on rearme.
       */
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

  request<M extends BrainWorkerMethod>(
    method: M,
    ...args: BrainWorkerArgs<M>
  ): Promise<BrainWorkerResult<M>> {
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

  requestWithTimeout<M extends BrainWorkerMethod>(
    timeoutMs: number,
    method: M,
    ...args: BrainWorkerArgs<M>
  ): Promise<BrainWorkerResult<M>> {
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
    return new Promise<BrainWorkerResult<M>>((resolve, reject) => {
      const armer = (): ReturnType<typeof setTimeout> => {
        const jeton = setTimeout(() => {
          if (!this.pending.has(id)) return
          const error = new Error(`Worker Brain muet depuis ${boundedTimeoutMs} ms`)
          this.retireWorker(worker, error)
        }, boundedTimeoutMs)
        jeton.unref?.()
        return jeton
      }
      this.pending.set(id, {
        resolve: (value) => resolve(value as BrainWorkerResult<M>),
        reject,
        timeout: armer(),
        rearmer: armer
      })
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
