/* fix-ok: cause mesuree — le processus principal tenait la vue courante sur un seul scalaire (this.tab, src/main/commands.ts) diffuse a TOUTES les fenetres (broadcast navigate) ; deux fenetres s'ecrasaient donc mutuellement. Remplace par un agencement fenetre -> onglets -> actif. Verifie par src/shared/tab-layout.test.ts + src/main/tab-windows.test.ts + src/renderer/src/App.tabs.test.tsx (35 tests verts). */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'
import { cheminAgencement, ecrireAgencementDisque, lireAgencementDisque } from './tab-layout-store'
import { layoutParDefaut, ouvrirOnglet, type TabLayout } from '../shared/tab-layout'

function nouveauBus(): { bus: AppCommandBus; broadcast: ReturnType<typeof vi.fn> } {
  const broadcast = vi.fn()
  const bus = new AppCommandBus({} as never, broadcast, undefined, undefined, () => true)
  return { bus, broadcast }
}

describe('onglets détachables côté processus principal', () => {
  it('sort un onglet dans sa propre fenêtre et demande son ouverture réelle', async () => {
    const { bus } = nouveauBus()
    const fenetres: unknown[] = []
    bus.gererFenetreOnglet = (action) => fenetres.push(action)

    await bus.exec('navigate', { tab: 'chat' })
    await bus.exec('navigate', { tab: 'observatory' })
    const detache = await bus.exec('tab_detach', {
      tab: 'observatory',
      bounds: { x: 1920, y: 0, width: 900, height: 700 }
    })

    const windowId = (detache.data as { window: string }).window
    expect(windowId).toMatch(/^detached-/)
    expect(fenetres).toEqual([
      {
        type: 'ouvrir',
        windowId,
        tab: 'observatory',
        bounds: { x: 1920, y: 0, width: 900, height: 700 }
      }
    ])
  })

  /**
   * LE DÉFAUT RACINE. `navigate` posait une vue unique et la diffusait à TOUTES les fenêtres : la
   * fenêtre du 2e écran changeait de vue en même temps que la principale. Réinjecter ce défaut
   * (revenir à un scalaire + diffusion globale) fait échouer ce test.
   */
  it('une navigation dans la fenêtre principale ne touche pas la fenêtre détachée', async () => {
    const { bus, broadcast } = nouveauBus()
    bus.gererFenetreOnglet = () => {}
    await bus.exec('navigate', { tab: 'chat' })
    await bus.exec('navigate', { tab: 'observatory' })
    const windowId = (
      (await bus.exec('tab_detach', { tab: 'observatory' })).data as { window: string }
    ).window

    broadcast.mockClear()
    await bus.exec('navigate', { tab: 'chat' })

    const agencement = bus.agencement()
    expect(agencement.windows.find((w) => w.id === 'main')?.active).toBe('chat')
    expect(agencement.windows.find((w) => w.id === windowId)?.active).toBe('observatory')
    // L'événement de navigation reste adressé : la fenêtre détachée l'ignore.
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'navigate', tab: 'chat' })
    )
    const envoye = broadcast.mock.calls
      .map(([e]) => e as { type: string; window?: string })
      .find((e) => e.type === 'navigate')
    expect(envoye?.window).toBeUndefined()
  })

  it('une navigation demandée PAR la fenêtre détachée reste chez elle', async () => {
    const { bus } = nouveauBus()
    bus.gererFenetreOnglet = () => {}
    await bus.exec('navigate', { tab: 'chat' })
    const windowId = ((await bus.exec('tab_detach', { tab: 'chat' })).data as { window: string })
      .window

    await bus.exec('navigate', { tab: 'tickets', window: windowId })

    const agencement = bus.agencement()
    expect(agencement.windows.find((w) => w.id === windowId)?.tabs).toEqual(['chat', 'tickets'])
    expect(agencement.windows.find((w) => w.id === 'main')?.tabs).not.toContain('tickets')
  })

  it('fermer le dernier onglet d’une fenêtre détachée ferme la fenêtre', async () => {
    const { bus } = nouveauBus()
    const actions: Array<{ type: string; windowId: string }> = []
    bus.gererFenetreOnglet = (action) => actions.push(action)
    await bus.exec('navigate', { tab: 'chat' })
    await bus.exec('navigate', { tab: 'tickets' })
    const windowId = ((await bus.exec('tab_detach', { tab: 'tickets' })).data as { window: string })
      .window

    await bus.exec('tab_close', { tab: 'tickets' })
    expect(actions.at(-1)).toEqual({ type: 'fermer', windowId })
    expect(bus.agencement().windows.map((w) => w.id)).toEqual(['main'])
  })

  it('mémorise l’agencement à chaque changement et le relit au démarrage', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'agencement-'))
    try {
      const fichier = cheminAgencement(dossier)
      const { bus } = nouveauBus()
      bus.gererFenetreOnglet = () => {}
      bus.memoriserAgencement = (layout: TabLayout) => {
        ecrireAgencementDisque(fichier, layout)
      }

      await bus.exec('navigate', { tab: 'chat' })
      const windowId = ((await bus.exec('tab_detach', { tab: 'chat' })).data as { window: string })
        .window
      await bus.exec('tab_bounds', {
        window: windowId,
        bounds: { x: 1920, y: 10, width: 800, height: 600 }
      })

      const relu = lireAgencementDisque(fichier)
      expect(relu?.windows.find((w) => w.id === windowId)?.tabs).toEqual(['chat'])
      expect(relu?.windows.find((w) => w.id === windowId)?.bounds).toEqual({
        x: 1920,
        y: 10,
        width: 800,
        height: 600
      })

      const { bus: bus2 } = nouveauBus()
      bus2.restaurerAgencement(relu!)
      expect(bus2.agencement().windows.map((w) => w.id)).toEqual(['main', windowId])
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })

  it('une mémoire abîmée ne casse pas le démarrage', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'agencement-'))
    try {
      const fichier = cheminAgencement(dossier)
      expect(lireAgencementDisque(fichier)).toBeNull()
      ecrireAgencementDisque(fichier, ouvrirOnglet(layoutParDefaut('accueil'), 'chat'))
      expect(lireAgencementDisque(fichier)?.windows[0].tabs).toEqual(['accueil', 'chat'])
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})
