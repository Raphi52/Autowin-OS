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

    // Le refus NOMME desormais sa sortie : un refus nu faisait boucler l'agent (huit tentatives
    // identiques mesurees le 2026-08-25). On exige donc le constat ET le geste — plus strict que
    // l'egalite exacte d'avant, qui se satisfaisait d'un cul-de-sac.
    const refus = await bus.exec('navigate', { tab: 'settings' })
    expect(refus.ok).toBe(false)
    expect(refus.error).toContain('Capacité désactivée')
    expect(refus.error).toContain('navigate')
    expect(refus.error).toMatch(/Ouvre les reglages|choisis une commande/i)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('keeps uncatalogued or enabled commands executable', async () => {
    const broadcast = vi.fn()
    const bus = new AppCommandBus({} as never, broadcast, undefined, undefined, () => true)

    await expect(bus.exec('navigate', { tab: 'settings' })).resolves.toEqual({
      ok: true,
      data: { tab: 'settings', section: undefined }
    })
    expect(broadcast).toHaveBeenCalledWith({ type: 'navigate', tab: 'settings' })
  })
})
