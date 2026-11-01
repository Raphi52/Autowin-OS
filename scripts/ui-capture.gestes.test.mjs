import { describe, expect, it } from 'vitest'
import {
  clicAltSouris,
  gesteDeLEtape,
  scriptDuGeste,
  scriptDuPoint,
  vueAttendueApresClics
} from './ui-capture.mjs'

/**
 * Pourquoi ce test existe (conv-1038, 2026-10-21) : la chaîne `--click` ne savait que
 * `element.click()`. Deux gestes du chat ne se prouvaient donc sur AUCUNE capture : la barre posée
 * sur un passage SÉLECTIONNÉ, et l'Alt+clic « C'est quoi ça ? ». Les préfixes `selection:` et `alt:`
 * les ajoutent ; une étape sans préfixe garde exactement le clic d'avant.
 *
 * L'entrée qui doit faire échouer une correction fausse : un sélecteur qui CONTIENT « : » sans être
 * un préfixe (`button:not([disabled])`) — le lire comme un geste casserait tous les clics existants.
 */
describe('ui-capture — gestes de la chaîne --click', () => {
  it('sans préfixe : un clic ordinaire, sélecteur intact', () => {
    expect(gesteDeLEtape('.conv-pick')).toEqual({ geste: 'clic', selecteur: '.conv-pick' })
  })

  it('un « : » de pseudo-classe n’est PAS un préfixe de geste', () => {
    expect(gesteDeLEtape('button:not([disabled])')).toEqual({
      geste: 'clic',
      selecteur: 'button:not([disabled])'
    })
  })

  it('alt: → Alt+clic ; selection: → sélection du texte puis relâchement', () => {
    expect(gesteDeLEtape('alt: .msg.assistant .msg-body')).toEqual({
      geste: 'alt-clic',
      selecteur: '.msg.assistant .msg-body'
    })
    expect(gesteDeLEtape('selection:.msg.assistant .msg-body p')).toEqual({
      geste: 'selection',
      selecteur: '.msg.assistant .msg-body p'
    })
  })

  it('le script de chaque geste vise le sélecteur et rend si la cible existe', () => {
    const clic = scriptDuGeste({ geste: 'clic', selecteur: '.a' })
    expect(clic).toContain('document.querySelector(".a")')
    expect(clic).toContain('cible?.click()')
    const alt = scriptDuGeste({ geste: 'alt-clic', selecteur: '.a' })
    expect(alt).toContain('altKey: true')
    expect(alt).not.toContain('cible?.click()')
    const selection = scriptDuGeste({ geste: 'selection', selecteur: '.a' })
    expect(selection).toContain('selectNodeContents')
    expect(selection).toContain("'mouseup'")
  })
})

/**
 * `alt-souris:` (conv-1338, 2026-10-30) : `alt:` n'envoie qu'un événement `click` simulé. Il arrive
 * même sur un bouton grisé, où une vraie souris ne produit aucun `click` (sonde hors écran) : il
 * prouvait donc un geste que l'utilisateur ne fait pas. Celui-ci passe par le vrai pilotage du
 * navigateur (`Input.dispatchMouseEvent`), Alt tenu.
 */
describe('ui-capture — geste alt-souris:', () => {
  it('alt-souris: → vrai clic, sélecteur intact, sans se confondre avec alt:', () => {
    expect(gesteDeLEtape('alt-souris: .a button')).toEqual({
      geste: 'alt-souris',
      selecteur: '.a button'
    })
    expect(gesteDeLEtape('alt: .a').geste).toBe('alt-clic')
  })

  it('le point visé est le centre de la cible, et une cible absente rend null', () => {
    const script = scriptDuPoint('.a')
    expect(script).toContain('document.querySelector(".a")')
    expect(script).toContain('return null')
    expect(script).toContain('r.left + r.width / 2')
  })

  it('les trois ordres de souris tiennent Alt (modificateur 1) du survol au relâchement', () => {
    const ordres = clicAltSouris({ x: 10, y: 20 })
    expect(ordres.map((ordre) => ordre.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased'
    ])
    for (const ordre of ordres) expect(ordre).toMatchObject({ x: 10, y: 20, modifiers: 1 })
    expect(ordres[1]).toMatchObject({ button: 'left', buttons: 1, clickCount: 1 })
    expect(ordres[2]).toMatchObject({ button: 'left', buttons: 0, clickCount: 1 })
  })

  // Le geste amène au chat : la vue à contrôler n'est plus celle de départ.
  it('la vue attendue après un alt-souris: est le chat', () => {
    expect(vueAttendueApresClics('settings', 'alt-souris: .a')).toBe('chat')
  })

  // Jumeau : le `alt:` simulé garde son comportement, il ne promet aucune bascule.
  it('après un alt: simulé, la vue attendue ne change pas', () => {
    expect(vueAttendueApresClics('settings', 'alt: .a')).toBe('settings')
  })
})

/**
 * `saisie:` (conv-1338, 2026-10-30) : le menu `/` de la saisie n'existe qu'après une frappe, et
 * `--taper` joue APRÈS la chaîne de clics : aucune capture ne pouvait donc cliquer une de ses lignes,
 * or c'est là que l'Alt+clic laissait partir l'action posée sur l'appui de la souris.
 */
describe('ui-capture — geste saisie:', () => {
  class Evenement {
    constructor(type, init) {
      this.type = type
      this.bubbles = init?.bubbles === true
    }
  }

  function champ() {
    const recus = []
    return {
      recus,
      value: '',
      focus: () => recus.push('focus'),
      dispatchEvent: (evenement) => recus.push(`${evenement.type}:${evenement.bubbles}`)
    }
  }

  const jouer = (texte, cible) => {
    // Le setter natif est celui que React surveille : une simple affectation ne lui dirait rien.
    const prototype = {}
    Object.defineProperty(prototype, 'value', {
      set(valeur) {
        this.value_natif = valeur
      }
    })
    return new Function(
      'document',
      'Event',
      'HTMLTextAreaElement',
      `return ${scriptDuGeste({ geste: 'saisie', selecteur: texte })}`
    )({ querySelector: (selecteur) => (selecteur === 'textarea' ? cible : null) }, Evenement, {
      prototype
    })
  }

  it('saisie: → le texte tel quel, sans le lire comme un sélecteur', () => {
    expect(gesteDeLEtape('saisie: /dra')).toEqual({ geste: 'saisie', selecteur: '/dra' })
  })

  it('le script pose le texte par le setter natif et prévient React', () => {
    const cible = champ()
    expect(jouer('/dra', cible)).toBe(true)
    expect(cible.value_natif).toBe('/dra')
    expect(cible.recus).toEqual(['focus', 'input:true'])
  })

  // Jumeau : pas de champ à l'écran, la chaîne échoue au lieu de photographier une vue sans le texte.
  it('aucun champ : l’étape échoue', () => {
    expect(jouer('/dra', null)).toBe(false)
  })

  it('une saisie ne change pas la vue attendue', () => {
    expect(vueAttendueApresClics('chat', 'saisie: /dra')).toBe('chat')
  })
})

/**
 * `survol:` (conv-1059, 2026-10-22) : le détail d'une station de la carte du fil ne s'ouvre qu'au
 * SURVOL ou au FOCUS, ce que fait une vraie souris avant son clic — `element.click()` ne fait ni
 * l'un ni l'autre. Sans ce geste, « le détail est transparent, on voit rien » ne se prouvait sur
 * aucune capture. Le script est JOUÉ ici : React écoute `mouseover` (pour onMouseEnter) et `focusin`.
 */
describe('ui-capture — geste survol:', () => {
  it('survol: → survol, sélecteur intact', () => {
    expect(gesteDeLEtape('survol: li:has(.repere) .carte-point')).toEqual({
      geste: 'survol',
      selecteur: 'li:has(.repere) .carte-point'
    })
  })

  it('le script survole ET donne le focus à la cible, sans cliquer', () => {
    const recus = []
    const cible = {
      dispatchEvent: (evenement) => recus.push(`${evenement.type}:${evenement.bubbles}`),
      focus: () => recus.push('focus'),
      click: () => recus.push('click')
    }
    const document = { querySelector: (selecteur) => (selecteur === '.a' ? cible : null) }
    // Les constructeurs d'évènements du navigateur, absents de Node : une doublure suffit ici.
    class Evenement {
      constructor(type, init) {
        this.type = type
        this.bubbles = init?.bubbles === true
      }
    }
    const jouer = (selecteur) =>
      new Function(
        'document',
        'MouseEvent',
        'PointerEvent',
        `return ${scriptDuGeste({ geste: 'survol', selecteur })}`
      )(document, Evenement, Evenement)
    expect(jouer('.a')).toBe(true)
    expect(recus).toEqual(['pointerover:true', 'mouseover:true', 'focus'])
    expect(jouer('.absent')).toBe(false)
  })
})

/**
 * `point:` (conv-1130, 2026-10-23) : un clic sur une colonne de la rivière du Board y amène la loupe
 * d'après la POSITION du clic. `element.click()` part de (0, 0) : la capture montrait une loupe
 * immobile sur un code pourtant correct. Entrée qui doit faire échouer : un clic sans position.
 */
describe('ui-capture — geste point:', () => {
  it('point: → clic positionné, sélecteur intact', () => {
    expect(gesteDeLEtape('point: [data-etage="prouve"]')).toEqual({
      geste: 'point',
      selecteur: '[data-etage="prouve"]'
    })
  })

  it('le script clique au CENTRE de la cible, appui et relâchement compris', () => {
    const recus = []
    const cible = {
      getBoundingClientRect: () => ({ left: 100, top: 40, width: 200, height: 20 }),
      dispatchEvent: (e) => recus.push(`${e.type}@${e.clientX},${e.clientY}`),
      click: () => recus.push('click()')
    }
    const document = { querySelector: (selecteur) => (selecteur === '.a' ? cible : null) }
    class Evenement {
      constructor(type, init) {
        this.type = type
        this.clientX = init?.clientX
        this.clientY = init?.clientY
      }
    }
    const jouer = (selecteur) =>
      new Function(
        'document',
        'MouseEvent',
        'PointerEvent',
        `return ${scriptDuGeste({ geste: 'point', selecteur })}`
      )(document, Evenement, Evenement)
    expect(jouer('.a')).toBe(true)
    expect(recus).toEqual(['pointerdown@200,50', 'pointerup@200,50', 'click@200,50'])
    expect(jouer('.absent')).toBe(false)
  })
})
