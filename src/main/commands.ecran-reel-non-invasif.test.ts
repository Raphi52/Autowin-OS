import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * DEFAUT VECU (conv-586, tour 5e3d954a-f79f-45c6-82ed-c34b4ba9ae63, saisie du 2026-09-16T08:44:46) :
 * pour verifier une modif d'UI qu'il venait de compiler, le chat a appele
 * `desktop_observe {display:1}` — l'ecran REEL de l'utilisateur — alors que le bureau cache
 * (hdesk-lancer / hdesk-observe) etait la voie attendue. L'utilisateur a annule le tour 17 s plus tard.
 *
 * Le controleur desktop n'est volontairement PAS cable ici : le refus non-invasif tombe AVANT lui.
 * Un appel qui passe la garde se reconnait donc a son autre erreur (« Controle desktop indisponible »).
 */
describe('desktop_observe : bureau cache par defaut', () => {
  const bus = (): AppCommandBus =>
    new AppCommandBus({ executionWorkspace: process.cwd() } as never, () => undefined)

  it('refuse le premier appel du tour et nomme le bureau cache', async () => {
    const r = await bus().exec('desktop_observe', { display: 1 }, undefined, undefined, 'tour-1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('hdesk-lancer.ps1')
    expect(r.error).toContain('ecran_utilisateur')
  })

  it('laisse passer quand la capture de son ecran est assumee', async () => {
    const r = await bus().exec(
      'desktop_observe',
      { display: 1, ecran_utilisateur: true },
      undefined,
      undefined,
      'tour-2'
    )
    expect(r.ok).toBe(false)
    expect(r.error).not.toContain('hdesk-lancer.ps1')
    expect(r.error).toContain('Controle desktop indisponible')
  })

  it('ne facture la friction qu une fois par tour', async () => {
    const b = bus()
    const premier = await b.exec('desktop_observe', { display: 2 }, undefined, undefined, 'tour-3')
    const second = await b.exec('desktop_observe', { display: 2 }, undefined, undefined, 'tour-3')
    expect(String(premier.error)).toContain('hdesk-lancer.ps1')
    expect(String(second.error)).toContain('Controle desktop indisponible')
  })

  it('rearme la garde au tour suivant', async () => {
    const b = bus()
    await b.exec('desktop_observe', { display: 2 }, undefined, undefined, 'tour-4')
    const autreTour = await b.exec('desktop_observe', { display: 2 }, undefined, undefined, 'tour-5')
    expect(String(autreTour.error)).toContain('hdesk-lancer.ps1')
  })
})
