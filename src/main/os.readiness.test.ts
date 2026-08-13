import { describe, expect, it, vi } from 'vitest'
import { AutowinOS } from './os'
import { ExecutionSupervisor } from './execution-supervisor'

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
    const run = vi.fn().mockResolvedValue({ costUsd: 0 })
    const os = Object.create(AutowinOS.prototype) as AutowinOS & {
      setTaskReadiness(promise: Promise<unknown>): void
    }
    // L'orchestrateur est construit PAR RUN (isolation entre conversations) : c'est la fabrique
    // qu'un harnais remplace, plus le champ d'instance qui n'est plus consulté par `runTask`.
    Object.defineProperty(os, 'orchestrateurPour', { value: () => ({ run }) })
    Object.defineProperty(os, 'executionSupervisor', { value: new ExecutionSupervisor() })

    os.setTaskReadiness(readiness.promise)
    const pending = os.runTask('cadrer le besoin')
    await Promise.resolve()

    expect(run).not.toHaveBeenCalled()

    readiness.resolve()
    await pending

    expect(run).toHaveBeenCalledTimes(1)
    // Les 7ᵉ/8ᵉ arguments sont l'acquis de reprise et la conversation (survie niveau 3) : absents
    // hors reprise → un démarrage normal appelle l'orchestrateur exactement comme avant.
    expect(run.mock.calls[0].slice(0, 4)).toEqual([
      'cadrer le besoin',
      undefined,
      undefined,
      undefined
    ])
    expect(run.mock.calls[0][4]).toBeInstanceOf(AbortSignal)
  })

  it('refuse aussi un chat direct quand la topologie ne peut pas être résolue', async () => {
    const execute = vi.fn().mockResolvedValue({ text: 'ne doit pas partir' })
    const os = Object.create(AutowinOS.prototype) as AutowinOS & {
      setTaskReadiness(promise: Promise<unknown>): void
    }
    Object.defineProperty(os, 'executionSupervisor', { value: new ExecutionSupervisor() })
    os.setTaskReadiness(
      Promise.reject(new Error('Alias de modèle indisponible hors catalogue : codex/flagship'))
    )

    await expect(os.runChatTurn('bonjour', undefined, execute)).rejects.toThrow(
      'Alias de modèle indisponible hors catalogue : codex/flagship'
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('relit le binding du chat après la readiness quand le catalogue revient', async () => {
    const readiness = deferred<void>()
    let binding = {
      provider: 'codex',
      model: 'codex/flagship',
      reasoningEffort: 'medium' as const
    }
    const send = vi.fn(async (_provider, _messages, options) => ({
      text: 'ok',
      provider: 'codex',
      model: options.model,
      systemInjected: true
    }))
    const os = Object.create(AutowinOS.prototype) as AutowinOS & {
      setTaskReadiness(promise: Promise<unknown>): void
    }
    Object.defineProperties(os, {
      executionSupervisor: { value: new ExecutionSupervisor() },
      roles: { value: { getBinding: () => binding } },
      registry: { value: { send } },
      cost: { value: { add: vi.fn() } }
    })
    os.setTaskReadiness(readiness.promise)

    const pending = os.chat(
      undefined,
      'orchestrator',
      [{ role: 'user', content: 'bonjour' }],
      () => {}
    )
    await Promise.resolve()
    binding = { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'medium' }
    readiness.resolve()
    await pending

    expect(send).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({ model: 'gpt-5.6-terra' }),
      expect.any(Function)
    )
  })
  it('attribue le cout au provider et au modele reellement retournes', async () => {
    const add = vi.fn()
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperties(os, {
      executionSupervisor: { value: new ExecutionSupervisor() },
      roles: {
        value: {
          getBinding: () => ({
            provider: 'requested-provider',
            model: 'requested-model',
            reasoningEffort: 'medium'
          })
        }
      },
      registry: {
        value: {
          send: vi.fn(async () => ({
            text: 'ok',
            provider: 'actual-provider',
            model: 'actual-model',
            systemInjected: true,
            usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.01 }
          }))
        }
      },
      cost: { value: { add } }
    })
    await os.chat(undefined, 'orchestrator', [{ role: 'user', content: 'bonjour' }], () => {})
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'actual-provider', model: 'actual-model' })
    )
  })

  it('attend aussi une nouvelle generation de readiness installee pendant la precedente', async () => {
    const first = deferred<void>()
    const send = vi.fn(async () => ({
      text: 'ne doit pas partir',
      provider: 'codex',
      systemInjected: true
    }))
    const os = Object.create(AutowinOS.prototype) as AutowinOS & {
      setTaskReadiness(promise: Promise<unknown>): void
    }
    Object.defineProperties(os, {
      executionSupervisor: { value: new ExecutionSupervisor() },
      roles: {
        value: {
          getBinding: () => ({
            provider: 'codex',
            model: 'codex/flagship',
            reasoningEffort: 'medium'
          })
        }
      },
      registry: { value: { send } },
      cost: { value: { add: vi.fn() } }
    })
    os.setTaskReadiness(first.promise)

    const pending = os.chat(
      undefined,
      'orchestrator',
      [{ role: 'user', content: 'bonjour' }],
      () => {}
    )
    await Promise.resolve()
    os.setTaskReadiness(Promise.reject(new Error('NEW_TOPOLOGY_UNRESOLVED')))
    first.resolve()

    await expect(pending).rejects.toThrow('NEW_TOPOLOGY_UNRESOLVED')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('statut runtime Worktree', () => {
  it('expose le workspace réel et la raison quand le moteur est indisponible', () => {
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperty(os, 'executionWorkspace', {
      value: 'C:\\Users\\alice\\Clients\\Projet-confidentiel'
    })

    const status = os.getWorktreeRuntimeStatus()

    expect(status).toEqual({
      available: false,
      workspacePath: 'C:\\Users\\alice\\Clients\\Projet-confidentiel',
      reason: 'identity-unavailable'
    })
  })
})
