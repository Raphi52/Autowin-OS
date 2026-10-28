import { describe, expect, it } from 'vitest'
import {
  avecLisereArcEnCiel,
  CANAL_GESTE_MASCOTTE,
  creerGlisserMascotte,
  creerSuiviMascotte,
  cssDeLEtat,
  estLaFermeture,
  etatDeLaMascotte,
  gesteDeMascotte,
  htmlDeMascotte,
  issuePourLaMascotte,
  placerMascotte,
  placerMascotteGardee,
  PRELOAD_MASCOTTE,
  RETRAIT_HALO,
  SEUIL_GLISSER_PX,
  TAILLE_MASCOTTE,
  zoneDesCartes
} from './mascotte'
import { disposerPopups, htmlDePopup, type Rect } from './notification-popup'

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

  it('les cartes sortent à sa gauche, collées au halo sans le recouvrir (conv-1195)', () => {
    const zone = { x: 0, y: 0, width: 1920, height: 1032 }
    const bille = placerMascotte(zone)
    const cartes = disposerPopups(zoneDesCartes(bille, zone), [140, 200])
    // « snap ensemble » : le bord droit de chaque carte touche le halo, sans vide entre eux.
    for (const carte of cartes) expect(carte.x + carte.width).toBe(bille.x + RETRAIT_HALO)
    // La plus récente a son bas au niveau du bas du halo.
    expect(cartes[0].y + cartes[0].height).toBe(bille.y + bille.height - RETRAIT_HALO)
  })

  describe('les cartes suivent la bille glissée ailleurs (conv-1142)', () => {
    const ecran = { x: 0, y: 0, width: 1920, height: 1032 }
    const bille = (x: number, y: number): Rect => ({
      x,
      y,
      width: TAILLE_MASCOTTE,
      height: TAILLE_MASCOTTE
    })
    const recouvre = (a: Rect, b: Rect): boolean =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    /** La partie visible de la bille : la bande transparente de sa fenêtre peut passer sous une carte. */
    const halo = (b: Rect): Rect => ({
      x: b.x + RETRAIT_HALO,
      y: b.y + RETRAIT_HALO,
      width: b.width - 2 * RETRAIT_HALO,
      height: b.height - 2 * RETRAIT_HALO
    })
    /** Quatre cartes (le maximum de la pile), de la plus récente à la plus ancienne. */
    const cartes = (b: Rect, zone: Rect = ecran): Rect[] =>
      disposerPopups(zoneDesCartes(b, zone), [159, 101, 159, 101])

    it('en haut à gauche : à sa droite, la plus récente au niveau de son haut, la pile descend', () => {
      const b = bille(20, 30)
      const [recente, ...autres] = cartes(b)
      expect(recente.x).toBe(20 + TAILLE_MASCOTTE - RETRAIT_HALO)
      expect(recente.y).toBe(30 + RETRAIT_HALO)
      for (const carte of autres) expect(carte.y).toBeGreaterThan(recente.y)
    })

    it('en bas à gauche : à sa droite, la plus récente au niveau de son bas, la pile monte', () => {
      const b = bille(20, 900)
      const [recente, ...autres] = cartes(b)
      expect(recente.x).toBe(20 + TAILLE_MASCOTTE - RETRAIT_HALO)
      expect(recente.y + recente.height).toBe(900 + TAILLE_MASCOTTE - RETRAIT_HALO)
      for (const carte of autres) expect(carte.y).toBeLessThan(recente.y)
    })

    it('en haut au milieu : à sa gauche, et la pile descend', () => {
      const b = bille(1000, 200)
      const [recente] = cartes(b)
      expect(recente.x + recente.width).toBe(1000 + RETRAIT_HALO)
      expect(recente.y).toBe(200 + RETRAIT_HALO)
    })

    it('aucune carte ne recouvre le halo, ni ne sort de l’écran, où que soit la bille', () => {
      for (const [x, y] of [
        [0, 0],
        [20, 30],
        [20, 900],
        [1000, 200],
        [1000, 700],
        [1840, 0],
        [1840, 952],
        [500, 476]
      ]) {
        const b = bille(x, y)
        for (const carte of cartes(b)) {
          expect(recouvre(carte, halo(b)), `bille en ${x},${y}`).toBe(false)
          expect(carte.x).toBeGreaterThanOrEqual(0)
          expect(carte.x + carte.width).toBeLessThanOrEqual(1920)
          expect(carte.y).toBeGreaterThanOrEqual(0)
          expect(carte.y + carte.height).toBeLessThanOrEqual(1032)
        }
      }
    })

    it('sur un second écran : les cartes restent sur cet écran', () => {
      const second = { x: 1920, y: 0, width: 1280, height: 984 }
      for (const carte of cartes(bille(2000, 100), second)) {
        expect(carte.x).toBeGreaterThanOrEqual(1920)
        expect(carte.x + carte.width).toBeLessThanOrEqual(1920 + 1280)
      }
    })
  })

  it('la page n’a aucun script, et sa politique de contenu les interdit (conv-1142)', () => {
    const html = htmlDeMascotte()
    // `\son…=` : un attribut de gestionnaire (`onclick=`), pas le `content=` de la politique.
    expect(html).not.toMatch(/<script|javascript:|\son\w+=/iu)
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    )
  })

  it('chaque état allume son halo et sa pastille', () => {
    const travail = cssDeLEtat({ etat: 'travail', pastille: '3', fil: null })
    expect(travail).toContain('content:"3"')
    expect(travail).toContain('stroke-dasharray')
    const attente = cssDeLEtat({ etat: 'attente', pastille: '1', fil: 'c' })
    expect(attente).toContain('#f0c75e')
    const probleme = cssDeLEtat({ etat: 'probleme', pastille: '!', fil: 'c' })
    expect(probleme).toContain('content:"!"')
    expect(probleme).toContain('#e5534b')
    const calme = cssDeLEtat({ etat: 'calme', pastille: null, fil: null })
    expect(calme).not.toContain('content:')
    expect(calme).toContain('.z{display:block}')
  })

  it('les règles d’état pèsent plus que la page (une feuille insertCSS perd à poids égal)', () => {
    for (const etat of ['calme', 'travail', 'attente', 'probleme'] as const) {
      const css = cssDeLEtat({ etat, pastille: etat === 'calme' ? null : '1', fil: null })
      for (const regle of css.split('\n'))
        for (const selecteur of regle.slice(0, regle.indexOf('{')).split(','))
          expect(selecteur.startsWith('body ')).toBe(true)
    }
  })

  it('toutes les couches de la bille gardent l’ordre de la page, même celle qui tourne', () => {
    // Une couche transformée passe sinon DEVANT ses sœurs : la bille qui tourne cachait le reflet.
    expect(htmlDeMascotte()).toMatch(/\.ob>\*\{[^}]*transform:rotate\(0deg\)/u)
  })

  it('le nombre est au milieu de la bille, pas dans un coin (conv-1142)', () => {
    const regle = /\.n\{([^}]*)\}/u.exec(htmlDeMascotte())?.[1] ?? ''
    expect(regle).toContain('justify-self:center')
    expect(regle).toContain('align-self:center')
    expect(regle).toContain('margin:0;')
  })

  it('aucune zone de glisser Windows : elle mangerait le clic de la bille (conv-1142)', () => {
    const html = htmlDeMascotte()
    expect(html).not.toContain('app-region')
    expect(html).not.toContain('class="g"')
    expect(html).toMatch(/\.ob\{[^}]*cursor:pointer/u)
  })

  it('se ferme par sa croix, lue sur la navigation interne, posée devant la bille (conv-1142)', () => {
    expect(htmlDeMascotte()).toContain('<a class="f" href="#fermer"')
    expect(htmlDeMascotte()).toMatch(/\.f\{position:relative;z-index:2/u)
    expect(estLaFermeture('file:///C:/x/mascotte.html#fermer')).toBe(true)
    expect(estLaFermeture('file:///C:/x/mascotte.html#ailleurs')).toBe(false)
  })

  it('clic ou glisser : tranché par la distance du curseur entre l’appui et le lâcher', () => {
    const geste = creerGlisserMascotte()
    const fenetre = { x: 1000, y: 800 }
    // Un tremblement sous le seuil reste un clic, et la fenêtre ne bouge pas.
    geste.appui({ x: 50, y: 50 }, fenetre)
    expect(geste.bouge({ x: 50 + SEUIL_GLISSER_PX, y: 50 - SEUIL_GLISSER_PX })).toBeNull()
    expect(geste.lache({ x: 52, y: 51 })).toEqual({ type: 'clic' })
    // Au-delà, la fenêtre suit le curseur, et le lâcher la pose au lieu d'ouvrir Autowin.
    geste.appui({ x: 50, y: 50 }, fenetre)
    expect(geste.bouge({ x: 50 + SEUIL_GLISSER_PX + 1, y: 50 })).toEqual({ x: 1005, y: 800 })
    // Revenu près du départ, c'est toujours un glisser.
    expect(geste.bouge({ x: 51, y: 50 })).toEqual({ x: 1001, y: 800 })
    expect(geste.lache({ x: -250, y: -300 })).toEqual({
      type: 'pose',
      position: { x: 700, y: 450 }
    })
    // Un glisser éclair, sans aucun « bouge » reçu : le lâcher seul suffit à le voir.
    geste.appui({ x: 0, y: 0 }, fenetre)
    expect(geste.lache({ x: 40, y: 0 })).toEqual({ type: 'pose', position: { x: 1040, y: 800 } })
  })

  it('sans appui, rien ; un pointeur perdu n’ouvre jamais Autowin mais pose un glisser', () => {
    const geste = creerGlisserMascotte()
    expect(geste.bouge({ x: 9, y: 9 })).toBeNull()
    expect(geste.lache({ x: 9, y: 9 })).toBeNull()
    geste.appui({ x: 0, y: 0 }, { x: 10, y: 10 })
    expect(geste.annule({ x: 1, y: 0 })).toBeNull()
    expect(geste.lache({ x: 1, y: 0 })).toBeNull()
    geste.appui({ x: 0, y: 0 }, { x: 10, y: 10 })
    expect(geste.annule({ x: 30, y: 0 })).toEqual({ type: 'pose', position: { x: 40, y: 10 } })
  })

  it('seuls les quatre gestes connus passent, avec une position en nombres finis', () => {
    for (const nom of ['appui', 'bouge', 'lache', 'annule'])
      expect(gesteDeMascotte(nom, 10, 20)).toEqual({ geste: nom, curseur: { x: 10, y: 20 } })
    for (const autre of ['clic', '', null, 1, { geste: 'appui' }])
      expect(gesteDeMascotte(autre, 10, 20)).toBeNull()
    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Infinity],
      ['1', 2],
      [undefined, 3]
    ])
      expect(gesteDeMascotte('appui', x, y)).toBeNull()
  })

  it('le préchargement n’envoie que le geste et la position du pointeur, pour la bille seulement', () => {
    class FausseCible {
      constructor(private readonly classe: string) {}
      closest(selecteur: string): FausseCible | null {
        return selecteur === `.${this.classe}` ? this : null
      }
      captures = 0
      setPointerCapture(): void {
        this.captures++
      }
    }
    const ecouteurs = new Map<string, (e: unknown) => void>()
    const envois: unknown[][] = []
    const fenetre = {
      addEventListener: (type: string, f: (e: unknown) => void) => ecouteurs.set(type, f)
    }
    const exiger = (nom: string): unknown => {
      expect(nom).toBe('electron')
      return { ipcRenderer: { send: (...args: unknown[]) => envois.push(args) } }
    }
    new Function('require', 'window', 'Element', PRELOAD_MASCOTTE)(exiger, fenetre, FausseCible)
    const bille = new FausseCible('ob')
    const croix = new FausseCible('f')
    const evt = (type: string, e: Record<string, unknown>): void =>
      ecouteurs.get(type)?.({
        pointerId: 1,
        button: 0,
        buttons: 1,
        screenX: 300,
        screenY: 200,
        preventDefault: () => undefined,
        ...e
      })

    // La croix garde son lien ; le bouton droit et un pointeur jamais appuyé ne font rien.
    evt('pointerdown', { target: croix })
    evt('pointerdown', { target: bille, button: 2 })
    evt('pointermove', { target: bille })
    expect(envois).toEqual([])

    evt('pointerdown', { target: bille })
    evt('pointermove', { target: bille, screenX: 340, screenY: 210 })
    evt('pointermove', { target: bille, pointerId: 2 })
    evt('pointerup', { target: bille })
    evt('lostpointercapture', { target: bille })
    evt('pointerdown', { target: bille })
    evt('pointercancel', { target: bille })
    evt('pointerdown', { target: bille })
    // Bouton relâché hors de la fenêtre, sans « pointerup » : le premier mouvement vaut lâcher.
    evt('pointermove', { target: bille, buttons: 0 })
    expect(envois).toEqual(
      [
        ['appui', 300, 200],
        ['bouge', 340, 210],
        ['lache', 300, 200],
        ['appui', 300, 200],
        ['annule', 300, 200],
        ['appui', 300, 200],
        ['lache', 300, 200]
      ].map((geste) => [CANAL_GESTE_MASCOTTE, ...geste])
    )
    // Chaque appui capture le pointeur : le lâcher arrive même si le curseur a quitté la bille.
    expect(bille.captures).toBe(3)
    expect(croix.captures).toBe(0)
  })

  it('revient à la place où on l’a laissée, entière, tant qu’elle est sur un écran', () => {
    const principal = { x: 0, y: 0, width: 1920, height: 1040 }
    const second = { x: 1920, y: 0, width: 1280, height: 984 }
    const bord = { width: TAILLE_MASCOTTE, height: TAILLE_MASCOTTE }
    expect(placerMascotteGardee({ x: 300, y: 200 }, [principal, second], principal)).toEqual({
      x: 300,
      y: 200,
      ...bord
    })
    expect(placerMascotteGardee({ x: 2500, y: 100 }, [principal, second], principal)).toEqual({
      x: 2500,
      y: 100,
      ...bord
    })
    // Débordant du bord : ramenée dedans.
    expect(placerMascotteGardee({ x: 1870, y: 990 }, [principal], principal)).toEqual({
      x: 1920 - TAILLE_MASCOTTE,
      y: 1040 - TAILLE_MASCOTTE,
      ...bord
    })
    // Écran débranché, ou rien de gardé : le coin d'origine.
    expect(placerMascotteGardee({ x: 2500, y: 100 }, [principal], principal)).toEqual(
      placerMascotte(principal)
    )
    expect(placerMascotteGardee(null, [principal], principal)).toEqual(placerMascotte(principal))
  })

  it('le liseré arc-en-ciel ne change que le bord de la carte, et passe après la page', () => {
    const page = htmlDePopup({ title: 't', body: 'b', fil: 'conv-1145', issue: 'prete' }, '14:32')
    const decoree = avecLisereArcEnCiel(page)
    const ajout = decoree.slice(
      decoree.indexOf('</style>') + '</style>'.length,
      decoree.indexOf('</head>')
    )
    // Une seule règle ajoutée, sur `.cadre` seulement : fond, texte et boutons gardent le thème.
    expect(ajout).toMatch(
      /^<style>\.cadre\{background-image:linear-gradient\(90deg,[^}]*\)\}<\/style>$/u
    )
    expect(ajout).toContain('#2f91c7')
    expect(ajout).toContain('#f9c512')
    // Le reste de la page est intact.
    expect(decoree.replace(ajout, '')).toBe(page)
  })

  it('rien d’autre qu’un compte n’entre dans la chaîne CSS de la pastille', () => {
    const css = cssDeLEtat({ etat: 'travail', pastille: '"}*{display:none', fil: null })
    expect(css).not.toContain('content:')
  })
})
