import { describe, expect, it, vi } from 'vitest'
import { superviseBrainServer } from './brain-server-supervision'

const noopInterval = {
  setIntervalFn: () => 'handle',
  clearIntervalFn: () => {}
}

describe('superviseBrainServer', () => {
  it('réarme les tentatives et ne relance rien tant que le service vit', async () => {
    const ensureStarted = vi.fn()
    const reset = vi.fn()
    const sup = superviseBrainServer({
      pingBrain: async () => true,
      ensureStarted: ensureStarted as never,
      reset,
      ...noopInterval
    })
    expect(await sup.tick()).toBe('alive')
    expect(ensureStarted).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('relance le service quand il est tombé APRÈS le démarrage', async () => {
    const ensureStarted = vi.fn(async () => ({ status: 'starting' as const, detail: 'lancé' }))
    const sup = superviseBrainServer({
      pingBrain: async () => false,
      ensureStarted: ensureStarted as never,
      reset: vi.fn(),
      ...noopInterval
    })
    expect(await sup.tick()).toBe('relaunch-attempted')
    expect(ensureStarted).toHaveBeenCalledTimes(1)
  })

  it('traite un ping en erreur comme un service absent', async () => {
    const ensureStarted = vi.fn(async () => ({ status: 'starting' as const, detail: 'lancé' }))
    const sup = superviseBrainServer({
      pingBrain: async () => {
        throw new Error('ECONNREFUSED')
      },
      ensureStarted: ensureStarted as never,
      reset: vi.fn(),
      ...noopInterval
    })
    expect(await sup.tick()).toBe('relaunch-attempted')
    expect(ensureStarted).toHaveBeenCalledTimes(1)
  })

  it('stop coupe le battement', () => {
    const clear = vi.fn()
    const sup = superviseBrainServer({
      pingBrain: async () => true,
      setIntervalFn: () => 'h',
      clearIntervalFn: clear
    })
    sup.stop()
    expect(clear).toHaveBeenCalledWith('h')
  })
})
