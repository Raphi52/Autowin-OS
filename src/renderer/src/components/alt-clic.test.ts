// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DELAI_CAPTURE_MS,
  ecouterElementsCibles,
  installerAltClic,
  poserElementCible,
  rectangleVisible,
  type ElementCible
} from './alt-clic'

/**
 * ALT+CLIC SUR TOUTE L'APP (conv-1338, 2026-10-30). Le geste vivait sur la vue chat : ni Réglages, ni
 * Accueil, ni la barre latérale, et rien en mosaïque.
 *
 * Mesures qui fondent ces tests (sonde Electron hors écran avec de vrais clics) :
 *  - un bouton grisé ne reçoit QUE pointerdown et pointerup : aucun `click`, aucun `mousedown` ;
 *  - à zoom 1,5, le rectangle de capture doit être multiplié par le zoom (100 % du bon élément,
 *    contre 0 % sans).
 */

const IMAGE = 'data:image/png;base64,QUJD'
let retirer: () => void
let recus: ElementCible[]
let couper: () => void
let ouvrirChat: ReturnType<typeof vi.fn>
let capturer: ReturnType<typeof vi.fn>

function poser(html: string): HTMLElement {
  const racine = document.createElement('div')
  racine.innerHTML = html
  document.body.append(racine)
  return racine
}

function altClic(element: Element, options: MouseEventInit = {}): MouseEvent {
  const evenement = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    altKey: true,
    ...options
  })
  element.dispatchEvent(evenement)
  return evenement
}

/** Ce qu'un bouton grisé reçoit d'une vraie souris (sonde conv-1338) : ni mousedown ni click. */
function clicSurGrise(element: Element, relache: Element = element, altKey = true): void {
  const init = { bubbles: true, cancelable: true, altKey, button: 0 }
  element.dispatchEvent(new PointerEvent('pointerdown', init))
  relache.dispatchEvent(new PointerEvent('pointerup', init))
}

const attendre = async (): Promise<void> => {
  await vi.waitFor(() => expect(recus.length).toBeGreaterThan(0))
}

beforeEach(() => {
  recus = []
  // Le faux navigateur des tests mesure tout à 0×0 : un élément réel a une taille.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    right: 110,
    bottom: 70
  } as DOMRect)
  ouvrirChat = vi.fn()
  capturer = vi.fn().mockResolvedValue(IMAGE)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { capturerElement: capturer, getZoomFactor: () => 1 }
  })
  retirer = installerAltClic(ouvrirChat)
  couper = ecouterElementsCibles((element) => recus.push(element))
})

afterEach(() => {
  retirer()
  couper()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('le geste', () => {
  it('nominal : référence, image et bascule vers le chat, et le bouton ne se déclenche pas', async () => {
    const racine = poser('<nav class="barre"><button id="b">Réglages</button></nav>')
    const bouton = racine.querySelector('#b')!
    const action = vi.fn()
    bouton.addEventListener('click', action)
    const evenement = altClic(bouton)
    expect(evenement.defaultPrevented).toBe(true)
    await attendre()
    expect(action).not.toHaveBeenCalled()
    expect(recus).toHaveLength(1)
    expect(recus[0].texte).toContain('Élément ciblé [élément pointé : « Réglages »')
    expect(recus[0].image?.type).toBe('image/png')
    expect(ouvrirChat).toHaveBeenCalledTimes(1)
  })

  it('hors du chat : la capture est prise AVANT de quitter la vue', async () => {
    const ordre: string[] = []
    capturer.mockImplementation(async () => {
      ordre.push('capture')
      return IMAGE
    })
    ouvrirChat.mockImplementation(() => ordre.push('bascule'))
    altClic(poser('<div class="v"><p id="c">x</p></div>').querySelector('#c')!)
    await attendre()
    expect(ordre).toEqual(['capture', 'bascule'])
  })

  // Jumeau du geste : le même clic sans Alt reste un clic.
  it('sans Alt : rien', async () => {
    const racine = poser('<div class="v"><button id="b">x</button></div>')
    const action = vi.fn()
    racine.querySelector('#b')!.addEventListener('click', action)
    altClic(racine.querySelector('#b')!, { altKey: false })
    await new Promise((fin) => setTimeout(fin, 10))
    expect(action).toHaveBeenCalledTimes(1)
    expect(recus).toEqual([])
  })

  it('bouton droit avec Alt : rien', async () => {
    const racine = poser('<div class="v"><button id="b">x</button></div>')
    const evenement = altClic(racine.querySelector('#b')!, { button: 2 })
    await new Promise((fin) => setTimeout(fin, 10))
    expect(evenement.defaultPrevented).toBe(false)
    expect(recus).toEqual([])
  })

  it('un champ de saisie : le clic reste ordinaire', async () => {
    const racine = poser('<div class="v"><textarea id="t"></textarea></div>')
    const evenement = altClic(racine.querySelector('#t')!)
    await new Promise((fin) => setTimeout(fin, 10))
    expect(evenement.defaultPrevented).toBe(false)
    expect(recus).toEqual([])
    expect(capturer).not.toHaveBeenCalled()
  })

  it('le fond de la page : le clic reste ordinaire, aucune référence vide', async () => {
    const evenement = altClic(document.body)
    await new Promise((fin) => setTimeout(fin, 10))
    expect(evenement.defaultPrevented).toBe(false)
    expect(recus).toEqual([])
  })
})

describe('bouton grisé : aucun click n’y arrive', () => {
  it('le relâchement du pointeur pose la référence, avec l’état du bouton', async () => {
    const racine = poser('<div class="v"><button id="b" disabled>Joindre</button></div>')
    clicSurGrise(racine.querySelector('#b')!)
    await attendre()
    expect(recus[0].texte).toContain('bouton désactivé')
  })

  it('un élément DANS le bouton grisé : pareil', async () => {
    const racine = poser(
      '<div class="v"><button disabled><span id="s">Joindre</span></button></div>'
    )
    clicSurGrise(racine.querySelector('#s')!)
    await attendre()
    expect(recus[0].texte).toContain('bouton désactivé')
  })

  // Jumeau : un glissé qui finit sur un bouton grisé n'est pas un clic.
  it('appui ailleurs, relâché sur le bouton grisé : rien', async () => {
    const racine = poser(
      '<div class="v"><p id="p">x</p><button id="b" disabled>Joindre</button></div>'
    )
    clicSurGrise(racine.querySelector('#p')!, racine.querySelector('#b')!)
    await new Promise((fin) => setTimeout(fin, 10))
    expect(recus).toEqual([])
  })

  it('sans Alt : rien', async () => {
    const racine = poser('<div class="v"><button id="b" disabled>Joindre</button></div>')
    clicSurGrise(racine.querySelector('#b')!, racine.querySelector('#b')!, false)
    await new Promise((fin) => setTimeout(fin, 10))
    expect(recus).toEqual([])
  })

  // Jumeau : un bouton actif passe par son `click`, jamais deux fois.
  it('bouton actif : le relâchement seul ne pose rien', async () => {
    const racine = poser('<div class="v"><button id="b">Joindre</button></div>')
    clicSurGrise(racine.querySelector('#b')!)
    await new Promise((fin) => setTimeout(fin, 10))
    expect(recus).toEqual([])
  })
})

describe('mosaïque', () => {
  const MOSAIQUE = `
    <div class="chat-layout is-mosaic" data-testid="chat-view" data-active-conversation-id="actif">
      <section class="chat-mosaic-window" data-conv-id="conv-2"><p id="dedans">Bloc</p></section>
      <aside class="liste"><p id="dehors">Fils</p></aside>
    </div>`

  it('le clic va à la fenêtre cliquée, et la référence nomme son fil', async () => {
    altClic(poser(MOSAIQUE).querySelector('#dedans')!)
    await attendre()
    expect(recus[0].fenetre).toBe('conv-2')
    expect(recus[0].texte).toContain('fil conv-2')
    expect(recus[0].texte).not.toContain('fil actif')
  })

  it('hors de toute fenêtre : le clic reste ordinaire', async () => {
    const evenement = altClic(poser(MOSAIQUE).querySelector('#dehors')!)
    await new Promise((fin) => setTimeout(fin, 10))
    expect(evenement.defaultPrevented).toBe(false)
    expect(recus).toEqual([])
  })

  // Accueil pose aussi `data-conv-id` sur ses cartes : ce n'est pas une fenêtre de mosaïque.
  it('une carte d’Accueil n’est pas une fenêtre', async () => {
    const racine = poser('<div class="accueil" data-conv-id="conv-3"><p id="c">Carte</p></div>')
    altClic(racine.querySelector('#c')!)
    await attendre()
    expect(recus[0].fenetre).toBeUndefined()
  })

  // Jumeau : le chat plein nomme son fil sans fenêtre.
  it('chat plein : le fil actif est nommé', async () => {
    const racine = poser(
      '<div class="chat-layout" data-testid="chat-view" data-active-conversation-id="actif"><p id="c">x</p></div>'
    )
    altClic(racine.querySelector('#c')!)
    await attendre()
    expect(recus[0].fenetre).toBeUndefined()
    expect(recus[0].texte).toContain('fil actif')
  })
})

describe('la capture', () => {
  it('le rectangle envoyé tient compte du zoom de l’app', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { capturerElement: capturer, getZoomFactor: () => 1.5 }
    })
    const racine = poser('<div class="v"><p id="c">x</p></div>')
    const cible = racine.querySelector('#c')!
    cible.getBoundingClientRect = () =>
      ({ left: 200, top: 100, right: 300, bottom: 150 }) as DOMRect
    altClic(cible)
    await attendre()
    expect(capturer).toHaveBeenCalledWith({ x: 300, y: 150, largeur: 150, hauteur: 75 })
  })

  it('app pas encore relancée (canal absent) : le texte arrive sans image ni erreur', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    altClic(poser('<div class="v"><p id="c">x</p></div>').querySelector('#c')!)
    await attendre()
    expect(recus[0].image).toBeNull()
    expect(ouvrirChat).toHaveBeenCalled()
  })

  it('la capture échoue : le texte arrive sans image', async () => {
    capturer.mockRejectedValue(new Error('canal absent'))
    altClic(poser('<div class="v"><p id="c">x</p></div>').querySelector('#c')!)
    await attendre()
    expect(recus[0].image).toBeNull()
  })

  it('élément invisible (largeur 0) : aucune capture demandée, le texte arrive', async () => {
    const racine = poser('<div class="v"><p id="c">x</p></div>')
    const cible = racine.querySelector('#c')!
    cible.getBoundingClientRect = () => ({ left: 10, top: 10, right: 10, bottom: 10 }) as DOMRect
    altClic(cible)
    await attendre()
    expect(capturer).not.toHaveBeenCalled()
    expect(recus[0].image).toBeNull()
  })

  it('capture sans réponse : après le délai, l’app bascule avec le texte seul', async () => {
    vi.useFakeTimers()
    capturer.mockReturnValue(new Promise(() => {}))
    altClic(poser('<div class="v"><p id="c">x</p></div>').querySelector('#c')!)
    await vi.advanceTimersByTimeAsync(DELAI_CAPTURE_MS - 1)
    expect(recus).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(recus).toHaveLength(1)
    expect(recus[0].image).toBeNull()
    expect(ouvrirChat).toHaveBeenCalledTimes(1)
  })

  it('deux éléments différents : deux images aux noms distincts', async () => {
    const racine = poser('<div class="v"><p id="a">un</p><p id="b">deux</p></div>')
    altClic(racine.querySelector('#a')!)
    altClic(racine.querySelector('#b')!)
    await vi.waitFor(() => expect(recus).toHaveLength(2))
    expect(recus[0].image?.name).not.toBe(recus[1].image?.name)
  })

  it('le même élément recliqué : le même nom d’image, que la saisie dédoublonne', async () => {
    const racine = poser('<div class="v"><p id="a">un</p></div>')
    altClic(racine.querySelector('#a')!)
    altClic(racine.querySelector('#a')!)
    await vi.waitFor(() => expect(recus).toHaveLength(2))
    expect(recus[0].image?.name).toBe(recus[1].image?.name)
  })
})

describe('rectangleVisible', () => {
  const fenetre = { largeur: 800, hauteur: 600 }
  const boite = (left: number, top: number, right: number, bottom: number): DOMRect =>
    ({ left, top, right, bottom }) as DOMRect

  it('nominal, à zoom 1', () => {
    expect(rectangleVisible(boite(200, 100, 300, 150), fenetre, 1)).toEqual({
      x: 200,
      y: 100,
      largeur: 100,
      hauteur: 50
    })
  })

  it('plus grand que la fenêtre : la partie visible seulement', () => {
    expect(rectangleVisible(boite(-50, -20, 1000, 900), fenetre, 1)).toEqual({
      x: 0,
      y: 0,
      largeur: 800,
      hauteur: 600
    })
  })

  it.each([
    ['largeur nulle', boite(10, 10, 10, 50)],
    ['hauteur nulle', boite(10, 10, 50, 10)],
    ['à droite de la fenêtre', boite(900, 10, 950, 50)],
    ['au-dessus de la fenêtre', boite(10, -80, 50, -10)]
  ])('rien à capturer : %s', (_nom, valeur) => {
    expect(rectangleVisible(valeur, fenetre, 1)).toBeNull()
  })
})

describe('la file vers le chat', () => {
  it('chat jamais ouvert : aucun élément perdu, et l’ordre est gardé', () => {
    couper()
    poserElementCible({ texte: 'un', image: null })
    poserElementCible({ texte: 'deux', image: null })
    expect(recus).toEqual([])
    couper = ecouterElementsCibles((element) => recus.push(element))
    expect(recus.map((element) => element.texte)).toEqual(['un', 'deux'])
  })

  it('la file se vide une seule fois', () => {
    couper()
    poserElementCible({ texte: 'un', image: null })
    couper = ecouterElementsCibles((element) => recus.push(element))
    couper()
    couper = ecouterElementsCibles((element) => recus.push(element))
    expect(recus).toHaveLength(1)
  })
})
