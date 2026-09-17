/* fix-ok: cause mesuree — le processus principal tenait la vue courante sur un seul scalaire (this.tab, src/main/commands.ts) diffuse a TOUTES les fenetres (broadcast navigate) ; deux fenetres s'ecrasaient donc mutuellement. Remplace par un agencement fenetre -> onglets -> actif. Verifie par src/shared/tab-layout.test.ts + src/main/tab-windows.test.ts + src/renderer/src/App.tabs.test.tsx (35 tests verts). */
import { describe, expect, it } from 'vitest'
import {
  FENETRE_PRINCIPALE,
  activerOnglet,
  detacherOnglet,
  fermerOnglet,
  layoutParDefaut,
  lireAgencement,
  ongletActif,
  ouvrirOnglet,
  rattacherFenetre
} from './tab-layout'

describe('agencement des onglets', () => {
  it('ouvre les onglets dans la fenêtre principale et active le dernier', () => {
    const layout = ouvrirOnglet(ouvrirOnglet(layoutParDefaut('accueil'), 'chat'), 'observatory')
    expect(layout.windows[0].tabs).toEqual(['accueil', 'chat', 'observatory'])
    expect(ongletActif(layout)).toBe('observatory')
  })

  it('ferme un onglet et bascule sur son voisin', () => {
    const layout = ouvrirOnglet(ouvrirOnglet(layoutParDefaut('accueil'), 'chat'), 'tickets')
    const apres = fermerOnglet(layout, 'tickets')
    expect(apres.windows[0].tabs).toEqual(['accueil', 'chat'])
    expect(ongletActif(apres)).toBe('chat')
  })

  /**
   * LE DÉFAUT RACINE : avec une vue courante unique, activer un onglet dans une fenêtre changeait
   * la vue de l'autre. Ce test échoue si on revient à un scalaire partagé.
   */
  it("n'écrase pas l'onglet actif des autres fenêtres", () => {
    let layout = ouvrirOnglet(ouvrirOnglet(layoutParDefaut('accueil'), 'chat'), 'observatory')
    layout = detacherOnglet(layout, 'observatory', 'detached-1', {
      x: 2000,
      y: 10,
      width: 900,
      height: 700
    })
    expect(ongletActif(layout, 'detached-1')).toBe('observatory')
    expect(ongletActif(layout)).toBe('chat')

    layout = activerOnglet(layout, 'accueil')
    expect(ongletActif(layout)).toBe('accueil')
    expect(ongletActif(layout, 'detached-1')).toBe('observatory')
  })

  it('mémorise la position de la fenêtre détachée', () => {
    const layout = detacherOnglet(layoutParDefaut('chat'), 'chat', 'detached-1', {
      x: 1920,
      y: 0,
      width: 800,
      height: 600
    })
    expect(layout.windows.find((w) => w.id === 'detached-1')?.bounds).toEqual({
      x: 1920,
      y: 0,
      width: 800,
      height: 600
    })
    // La principale reste présente, même vidée de son dernier onglet.
    expect(layout.windows[0].id).toBe(FENETRE_PRINCIPALE)
    expect(layout.windows[0].tabs).toEqual([])
  })

  it('refuse de détacher vers une fenêtre déjà existante', () => {
    const layout = detacherOnglet(layoutParDefaut('chat'), 'chat', 'detached-1')
    expect(() => detacherOnglet(layout, 'chat', 'detached-1')).toThrow(/déjà présente/)
  })

  it('un onglet n’existe qu’une fois : le déplacer le retire de sa fenêtre d’origine', () => {
    let layout = ouvrirOnglet(layoutParDefaut('accueil'), 'chat')
    layout = detacherOnglet(layout, 'chat', 'detached-1')
    layout = ouvrirOnglet(layout, 'chat', FENETRE_PRINCIPALE, 0)
    expect(layout.windows.map((w) => w.id)).toEqual([FENETRE_PRINCIPALE])
    expect(layout.windows[0].tabs).toEqual(['chat', 'accueil'])
  })

  it('rattache les onglets d’une fenêtre fermée à la principale', () => {
    let layout = ouvrirOnglet(layoutParDefaut('accueil'), 'chat')
    layout = detacherOnglet(layout, 'chat', 'detached-1')
    layout = rattacherFenetre(layout, 'detached-1')
    expect(layout.windows.map((w) => w.id)).toEqual([FENETRE_PRINCIPALE])
    expect(layout.windows[0].tabs).toEqual(['accueil', 'chat'])
  })

  it('relit un agencement mémorisé et normalise les anciens noms', () => {
    const relu = lireAgencement(
      JSON.stringify({
        windows: [
          { id: 'main', tabs: ['accueil', 'agents'], active: 'agents' },
          { id: 'detached-1', tabs: ['observatoire'], active: 'observatoire' }
        ]
      })
    )
    expect(relu?.windows[0].tabs).toEqual(['accueil', 'agent-studio'])
    expect(relu?.windows[1].tabs).toEqual(['observatory'])
    expect(ongletActif(relu!, 'detached-1')).toBe('observatory')
  })

  it('rend null sur une mémoire abîmée plutôt que de casser le démarrage', () => {
    expect(lireAgencement('{ pas du json')).toBeNull()
    expect(lireAgencement(null)).toBeNull()
    expect(lireAgencement({ windows: 'nope' })).toBeNull()
    expect(lireAgencement({ windows: [] })).toBeNull()
  })
})
