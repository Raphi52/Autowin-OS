import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'

describe('capability registry runtime gate', () => {
  it('refuses a disabled command before any mutation or broadcast', async () => {
    const broadcast = vi.fn()
    const bus = new AppCommandBus(
      {} as never,
      broadcast,
      undefined,
      undefined,
      (name) => name !== 'navigate'
    )

    await expect(bus.exec('navigate', { tab: 'settings' }, undefined, 'auto')).resolves.toEqual({
      ok: false,
      error: 'Capacité désactivée: navigate'
    })
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('keeps uncatalogued or enabled commands executable', async () => {
    const broadcast = vi.fn()
    const bus = new AppCommandBus({} as never, broadcast, undefined, undefined, () => true)

    await expect(bus.exec('navigate', { tab: 'settings' }, undefined, 'auto')).resolves.toEqual({
      ok: true,
      data: { tab: 'settings', section: undefined }
    })
    expect(broadcast).toHaveBeenCalledWith({ type: 'navigate', tab: 'settings' })
  })
})
