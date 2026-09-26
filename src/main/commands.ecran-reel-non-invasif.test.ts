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

// kaizen conv-854, tour 78a0d7d3-6a84-4d86-a3a7-fd1b5cc1393f : clic sur la barre des taches reelle.
describe('desktop_act : bureau cache par defaut', () => {
  const bus = (): AppCommandBus =>
    new AppCommandBus({ executionWorkspace: process.cwd() } as never, () => undefined)
  const clic = { actions: [{ type: 'click', x: 558, y: 978 }] }

  it('refuse le premier clic du tour sur l ecran reel', async () => {
    const r = await bus().exec('desktop_act', clic, undefined, undefined, 'act-1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('`desktop_act` agit sur')
    expect(r.error).toContain('hdesk-lancer.ps1')
    expect(r.error).toContain('hdesk-act.ps1')
  })

  it('le drapeau pose d office au premier appel ne saute pas le refus (tour 78a0d7d3)', async () => {
    const b = bus()
    const premier = await b.exec('desktop_act', { ...clic, ecran_utilisateur: true }, undefined, undefined, 'act-2')
    expect(String(premier.error)).toContain('hdesk-lancer.ps1')
    const second = await b.exec('desktop_act', { ...clic, ecran_utilisateur: true }, undefined, undefined, 'act-2')
    expect(String(second.error)).toContain('hdesk-act.ps1')
  })

  // saisie ts 1790278416518 : le drapeau au 2e appel ne suffit plus, il faut la demande de l'utilisateur.
  const busAvec = (texte: string): AppCommandBus =>
    new AppCommandBus(
      {
        executionWorkspace: process.cwd(),
        conversations: new Map([['c1', { messages: [{ role: 'user', content: texte }] }]])
      } as never,
      () => undefined
    )

  it('refuse au 2e appel si l utilisateur n a pas parle de son ecran (tour 78a0d7d3)', async () => {
    const b = busAvec('mon watchdog me dit ca fais le toi stp')
    await b.exec('desktop_act', { ...clic, ecran_utilisateur: true }, 'c1', undefined, 'act-4')
    const second = await b.exec('desktop_act', { ...clic, ecran_utilisateur: true }, 'c1', undefined, 'act-4')
    expect(String(second.error)).toContain('pas demande')
  })

  it('laisse passer au 2e appel quand l utilisateur demande son ecran', async () => {
    const b = busAvec('clique sur mon écran stp')
    await b.exec('desktop_act', clic, 'c1', undefined, 'act-5')
    const second = await b.exec('desktop_act', clic, 'c1', undefined, 'act-5')
    expect(String(second.error)).toContain('Controle desktop indisponible')
  })

  // kaizen conv-835, tour ac1d0434-51c7-4dee-adf9-a8cb0a8e41f8 (evenements 87-89) : l'appel portait
  // deja le drapeau, et le refus proposait... de reemettre avec le drapeau. Sortie inexistante : le
  // message de l'utilisateur ne parlait pas de son ecran.
  it('sans demande, le premier refus ne propose pas une sortie qui n existe pas (tour ac1d0434)', async () => {
    const b = busAvec('envoi un message teams a leslie pour lui dire ou cest rangé')
    const saisie = { actions: [{ type: 'click', x: 489, y: 69 }, { type: 'type', text: 'Leslie' }], ecran_utilisateur: true }
    const premier = String((await b.exec('desktop_act', saisie, 'c1', undefined, 'act-6')).error)
    expect(premier).not.toContain("reemets l'appel avec `ecran_utilisateur: true`")
    expect(premier).toContain("ne reemets pas l'appel")
    expect(premier).toContain('hdesk-act.ps1')
    // Le contournement effectivement prevu par le modele : rouvrir le lien msteams: sur son ecran.
    expect(premier).toContain('Start-Process')
    expect(premier).toContain('msteams:')
    expect(premier).toContain('DEMANDE-lui')
    const second = String((await b.exec('desktop_act', saisie, 'c1', undefined, 'act-6')).error)
    expect(second).toBe(premier)
  })

  it('avec demande, le premier refus garde la porte de sortie du drapeau', async () => {
    const b = busAvec('clique sur mon écran stp')
    const premier = String((await b.exec('desktop_act', clic, 'c1', undefined, 'act-7')).error)
    expect(premier).toContain("reemets l'appel avec `ecran_utilisateur: true`")
  })

  it('une observation refusee n arme pas le clic', async () => {
    const b = bus()
    await b.exec('desktop_observe', { display: 1 }, undefined, undefined, 'act-3')
    const r = await b.exec('desktop_act', clic, undefined, undefined, 'act-3')
    expect(String(r.error)).toContain('hdesk-lancer.ps1')
  })
})
