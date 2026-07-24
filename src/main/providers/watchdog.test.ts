import { describe, expect, it, vi } from 'vitest'
import { createStreamWatchdog, withHardDeadline } from './watchdog'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('withHardDeadline', () => {
  it('résout normalement si la promesse gagne la course', async () => {
    await expect(withHardDeadline(Promise.resolve('ok'), 1000, 'trop long')).resolves.toBe('ok')
  })

  it('REJETTE une promesse qui ne se règle jamais (le cas « bloqué des jours »)', async () => {
    const never = new Promise<string>(() => {}) // ne se règle jamais
    await expect(withHardDeadline(never, 20, 'watchdog: figé')).rejects.toThrow(/figé/)
  })

  it('appelle onExpire (kill best-effort) au déclenchement', async () => {
    const onExpire = vi.fn()
    const never = new Promise<string>(() => {})
    await expect(withHardDeadline(never, 20, 'stop', onExpire)).rejects.toThrow()
    expect(onExpire).toHaveBeenCalledOnce()
  })

  it('propage un rejet d’origine sans attendre la deadline', async () => {
    await expect(
      withHardDeadline(Promise.reject(new Error('boom')), 1000, 'trop long')
    ).rejects.toThrow('boom')
  })
})

describe('createStreamWatchdog', () => {
  it('déclenche sur INACTIVITÉ quand aucun beat n’arrive', async () => {
    const onTrip = vi.fn()
    const wd = createStreamWatchdog({ inactivityMs: 30, onTrip })
    await wait(60)
    expect(onTrip).toHaveBeenCalledWith('inactivity')
    wd.dispose()
  })

  it('NE déclenche PAS tant que des beats réguliers arrivent (tâche qui progresse)', async () => {
    const onTrip = vi.fn()
    const wd = createStreamWatchdog({ inactivityMs: 40, onTrip })
    for (let i = 0; i < 4; i++) {
      await wait(20)
      wd.beat()
    }
    expect(onTrip).not.toHaveBeenCalled()
    wd.dispose()
  })

  it('déclenche sur le cap TOTAL même si les beats continuent', async () => {
    const onTrip = vi.fn()
    const wd = createStreamWatchdog({ inactivityMs: 1000, totalMs: 40, onTrip })
    for (let i = 0; i < 5; i++) {
      await wait(15)
      wd.beat()
    }
    expect(onTrip).toHaveBeenCalledWith('total')
    wd.dispose()
  })

  it('ne déclenche qu’UNE fois et dispose() neutralise', async () => {
    const onTrip = vi.fn()
    const wd = createStreamWatchdog({ inactivityMs: 20, onTrip })
    await wait(45)
    wd.dispose()
    await wait(30)
    expect(onTrip).toHaveBeenCalledTimes(1)
  })
})
