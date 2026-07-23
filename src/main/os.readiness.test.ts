import { describe, expect, it, vi } from 'vitest'
import { AutowinOS } from './os'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('barrière de disponibilité des modèles', () => {
  it('ne lance aucune orchestration avant la synchronisation de la topologie', async () => {
    const readiness = deferred<void>()
    const run = vi.fn().mockResolvedValue({})
    const os = Object.create(AutowinOS.prototype) as AutowinOS & {
      setTaskReadiness(promise: Promise<unknown>): void
    }
    Object.defineProperty(os, 'orchestrator', { value: { run } })

    os.setTaskReadiness(readiness.promise)
    const pending = os.runTask('cadrer le besoin')
    await Promise.resolve()

    expect(run).not.toHaveBeenCalled()

    readiness.resolve()
    await pending

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('cadrer le besoin', undefined, undefined, undefined, undefined)
  })
})

describe('statut runtime Worktree', () => {
  it('ne transmet jamais le chemin absolu du workspace au renderer', () => {
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperty(os, 'executionWorkspace', {
      value: 'C:\\Users\\alice\\Clients\\Projet-confidentiel'
    })

    const status = os.getWorktreeRuntimeStatus()

    expect(status).toEqual({ available: false })
    expect('workspace' in status).toBe(false)
  })
})
