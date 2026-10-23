import { describe, expect, it } from 'vitest'
import { gesteDeLEtape, scriptDuGeste } from './ui-capture.mjs'

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
