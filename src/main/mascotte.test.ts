import { describe, expect, it } from 'vitest'
import {
  creerSuiviMascotte,
  cssDeLEtat,
  etatDeLaMascotte,
  htmlDeMascotte,
  issuePourLaMascotte,
  lienDuFragment,
  placerMascotte,
  TAILLE_MASCOTTE,
  zoneDesCartes
} from './mascotte'
import { disposerPopups } from './notification-popup'

const VIDE = { toursEnCours: 0, runsActifs: 0, filsEnAttente: [], filsEnEchec: [] }

describe('mascotte du bureau — Bille · pastille (conv-1145)', () => {
  it('calme quand rien ne tourne ni n’attend : pas de pastille, le clic ouvre Autowin', () => {
    expect(etatDeLaMascotte(VIDE)).toEqual({ etat: 'calme', pastille: null, fil: null })
  })

  it('au travail : la pastille compte les réponses de chat ET les runs en cours', () => {
    expect(etatDeLaMascotte({ ...VIDE, toursEnCours: 2, runsActifs: 1 })).toEqual({
      etat: 'travail',
      pastille: '3',
      fil: null
    })
    expect(etatDeLaMascotte({ ...VIDE, toursEnCours: 12 }).pastille).toBe('9+')
  })

  it('pour toi l’emporte sur le travail ; le clic ouvre le fil le plus récent', () => {
    expect(
      etatDeLaMascotte({ ...VIDE, toursEnCours: 3, filsEnAttente: ['conv-1', 'conv-2'] })
    ).toEqual({ etat: 'attente', pastille: '2', fil: 'conv-2' })
  })

  it('un échec l’emporte sur tout, pastille « ! »', () => {
    expect(
      etatDeLaMascotte({ ...VIDE, toursEnCours: 1, filsEnAttente: ['a'], filsEnEchec: ['b'] })
    ).toEqual({ etat: 'probleme', pastille: '!', fil: 'b' })
  })

  it('un fil n’est qu’à une place, sa dernière issue l’emporte ; regarder Autowin efface tout', () => {
    const suivi = creerSuiviMascotte()
    suivi.finDeTour('conv-1', 'echec')
    suivi.finDeTour('conv-2', 'prete')
    suivi.finDeTour('conv-1', 'prete')
    expect(suivi.filsEnEchec()).toEqual([])
    expect(suivi.filsEnAttente()).toEqual(['conv-2', 'conv-1'])
    suivi.regarde()
    expect(suivi.filsEnAttente()).toEqual([])
    expect(suivi.filsEnEchec()).toEqual([])
  })

  it('même règle que la carte de fin de tour : arrêté, de fond ou regardé ne compte pas', () => {
    const fin = { ok: true, cancelled: false, text: 'fini' }
    expect(issuePourLaMascotte(fin, false)).toBe('prete')
    expect(issuePourLaMascotte({ ...fin, ok: false, error: 'boom' }, false)).toBe('echec')
    expect(issuePourLaMascotte({ ...fin, cancelled: true }, false)).toBeNull()
    expect(issuePourLaMascotte({ ...fin, tourDeFond: true }, false)).toBeNull()
    expect(issuePourLaMascotte(fin, true)).toBeNull()
  })

  it('posée dans le coin de la zone de travail, donc au-dessus de l’horloge', () => {
    const zone = { x: 0, y: 0, width: 1920, height: 1032 }
    const rect = placerMascotte(zone)
    expect(rect.width).toBe(TAILLE_MASCOTTE)
    expect(rect.x + rect.width).toBeLessThanOrEqual(zone.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(zone.height)
    expect(rect.x + rect.width).toBeGreaterThan(zone.width - 20)
  })

  it('les cartes sortent à sa gauche : aucune ne recouvre la bille', () => {
    const zone = { x: 0, y: 0, width: 1920, height: 1032 }
    const bille = placerMascotte(zone)
    const cartes = disposerPopups(zoneDesCartes(zone), [140, 200])
    for (const carte of cartes) expect(carte.x + carte.width).toBeLessThan(bille.x)
  })

  it('la page n’a aucun script et deux liens qui alternent', () => {
    const html = htmlDeMascotte()
    expect(html).not.toMatch(/<script|javascript:|on\w+=/iu)
    expect(html).toContain('href="#o1"')
    expect(html).toContain('href="#o2"')
    expect(lienDuFragment('file:///C:/x/mascotte.html#o1')).toBe(1)
    expect(lienDuFragment('file:///C:/x/mascotte.html#o2')).toBe(2)
    expect(lienDuFragment('file:///C:/x/mascotte.html#ailleurs')).toBeNull()
  })

  it('chaque état allume son halo et sa pastille, et seul le lien actif reçoit le clic', () => {
    const travail = cssDeLEtat({ etat: 'travail', pastille: '3', fil: null }, 1)
    expect(travail).toContain('.l1{display:block}')
    expect(travail).toContain('content:"3"')
    expect(travail).toContain('stroke-dasharray')
    const attente = cssDeLEtat({ etat: 'attente', pastille: '1', fil: 'c' }, 2)
    expect(attente).toContain('.l2{display:block}')
    expect(attente).toContain('#f0c75e')
    const probleme = cssDeLEtat({ etat: 'probleme', pastille: '!', fil: 'c' }, 1)
    expect(probleme).toContain('content:"!"')
    expect(probleme).toContain('#e5534b')
    const calme = cssDeLEtat({ etat: 'calme', pastille: null, fil: null }, 1)
    expect(calme).not.toContain('content:')
    expect(calme).toContain('.z{display:block}')
  })

  it('les règles d’état pèsent plus que la page (une feuille insertCSS perd à poids égal)', () => {
    for (const etat of ['calme', 'travail', 'attente', 'probleme'] as const) {
      const css = cssDeLEtat({ etat, pastille: etat === 'calme' ? null : '1', fil: null }, 1)
      for (const regle of css.split('\n'))
        for (const selecteur of regle.slice(0, regle.indexOf('{')).split(','))
          expect(selecteur.startsWith('body ')).toBe(true)
    }
  })

  it('toutes les couches de la bille gardent l’ordre de la page, même celle qui tourne', () => {
    // Une couche transformée passe sinon DEVANT ses sœurs : la bille qui tourne cachait le reflet.
    expect(htmlDeMascotte()).toMatch(/\.ob>\*\{[^}]*transform:rotate\(0deg\)/u)
  })

  it('le lien du clic passe devant les couches de la bille', () => {
    // Couches transformées = peintes au-dessus du lien, qui ne recevait plus le clic (constaté le
    // 2026-10-25 dans le bureau caché : clic reçu par la fenêtre, aucune navigation).
    expect(htmlDeMascotte()).toMatch(/\ba\{[^}]*position:relative;z-index:1/u)
  })

  it('rien d’autre qu’un compte n’entre dans la chaîne CSS de la pastille', () => {
    const css = cssDeLEtat({ etat: 'travail', pastille: '"}*{display:none', fil: null }, 1)
    expect(css).not.toContain('content:')
  })
})
