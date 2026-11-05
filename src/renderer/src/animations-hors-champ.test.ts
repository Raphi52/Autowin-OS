// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installerPauseHorsChamp, type AnimationPilotable } from './animations-hors-champ'

/**
 * CE QUI N'EST PAS À L'ÉCRAN NE S'ANIME PAS (conv-1610, 2026-11-05 : « Garde la fluidité, mais
 * seulement sur ce qui est visible et sur ma dernière bulle »). Une animation continue sortie du
 * champ est mise en pause ; revenue, elle repart à sa phase d'origine. Les animations finies, dont
 * des vues attendent la fin, ne sont jamais touchées.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : laisser tourner une animation continue hors champ, ne
 * pas la relancer à son retour, perdre son départ, ou mettre en pause une animation finie.
 */

class FauxObservateur {
  static dernier: FauxObservateur | undefined
  readonly suivis = new Set<Element>()
  constructor(private readonly rappel: IntersectionObserverCallback) {
    FauxObservateur.dernier = this
  }
  observe(cible: Element): void {
    this.suivis.add(cible)
  }
  unobserve(cible: Element): void {
    this.suivis.delete(cible)
  }
  disconnect(): void {
    this.suivis.clear()
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  /** Le moteur dit : `cible` est (ou n'est plus) dans le champ. */
  signaler(cible: Element, visible: boolean): void {
    this.rappel(
      [{ target: cible, isIntersecting: visible } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
}

function fausseAnimation(
  cible: Element,
  iterations: number,
  depart = 1234
): AnimationPilotable & { pauses: number } {
  const a = {
    playState: 'running',
    startTime: depart as CSSNumberish | null,
    effect: { target: cible, getTiming: () => ({ iterations }) },
    pauses: 0,
    pause() {
      a.playState = 'paused'
      a.pauses++
    },
    play() {
      a.playState = 'running'
      // Comme Chromium : relancer une animation en pause lui donne un nouveau départ.
      a.startTime = 99_999
    }
  }
  return a
}

function elementAnime(animations: AnimationPilotable[]): HTMLElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  Object.defineProperty(element, 'getAnimations', { configurable: true, value: () => animations })
  return element
}

const demarrer = (element: Element): void => {
  element.dispatchEvent(new Event('animationstart', { bubbles: true }))
}

describe('animations hors champ — en pause tant qu’on ne les voit pas', () => {
  let desinstaller: () => void
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FauxObservateur)
    desinstaller = installerPauseHorsChamp(document)
  })
  afterEach(() => {
    desinstaller()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('met en pause une animation continue sortie du champ, puis la relance à sa phase d’origine', () => {
    const element = elementAnime([])
    const lave = fausseAnimation(element, Infinity, 4200)
    Object.defineProperty(element, 'getAnimations', { configurable: true, value: () => [lave] })
    demarrer(element)
    const obs = FauxObservateur.dernier!
    expect(obs.suivis.has(element)).toBe(true)

    obs.signaler(element, false)
    expect(lave.playState).toBe('paused')

    obs.signaler(element, true)
    expect(lave.playState).toBe('running')
    // Départ restauré : les clignotements restent calés sur l'horloge commune.
    expect(lave.startTime).toBe(4200)
  })

  it('ne touche jamais une animation finie, même hors champ', () => {
    const element = elementAnime([])
    const entree = fausseAnimation(element, 1)
    const lave = fausseAnimation(element, Infinity)
    Object.defineProperty(element, 'getAnimations', {
      configurable: true,
      value: () => [entree, lave]
    })
    demarrer(element)
    FauxObservateur.dernier!.signaler(element, false)
    expect(entree.pauses).toBe(0)
    expect(entree.playState).toBe('running')
    expect(lave.playState).toBe('paused')
  })

  it('ne suit pas un élément qui ne porte que des animations finies ou celles de ses enfants', () => {
    const element = elementAnime([])
    const enfant = document.createElement('span')
    element.appendChild(enfant)
    const finie = fausseAnimation(element, 1)
    const delEnfant = fausseAnimation(enfant, Infinity)
    Object.defineProperty(element, 'getAnimations', {
      configurable: true,
      value: () => [finie, delEnfant]
    })
    demarrer(element)
    expect(FauxObservateur.dernier!.suivis.has(element)).toBe(false)
  })

  it('suspend tout de suite une animation recréée sur un élément déjà hors champ', () => {
    const element = elementAnime([])
    const premiere = fausseAnimation(element, Infinity)
    let animations: AnimationPilotable[] = [premiere]
    Object.defineProperty(element, 'getAnimations', { configurable: true, value: () => animations })
    demarrer(element)
    FauxObservateur.dernier!.signaler(element, false)
    // React réécrit la classe : une nouvelle animation démarre, l'observateur ne redit rien.
    const seconde = fausseAnimation(element, Infinity)
    animations = [premiere, seconde]
    demarrer(element)
    expect(seconde.playState).toBe('paused')
  })

  it('oublie un élément retiré du document', () => {
    const element = elementAnime([])
    const lave = fausseAnimation(element, Infinity)
    Object.defineProperty(element, 'getAnimations', { configurable: true, value: () => [lave] })
    demarrer(element)
    const obs = FauxObservateur.dernier!
    element.remove()
    obs.signaler(element, false)
    expect(obs.suivis.has(element)).toBe(false)
    expect(lave.playState).toBe('running')
  })

  it('se désinstalle en relançant ce qu’il avait mis en pause', () => {
    const element = elementAnime([])
    const lave = fausseAnimation(element, Infinity, 700)
    Object.defineProperty(element, 'getAnimations', { configurable: true, value: () => [lave] })
    demarrer(element)
    FauxObservateur.dernier!.signaler(element, false)
    desinstaller()
    expect(lave.playState).toBe('running')
    expect(lave.startTime).toBe(700)
    // Plus d'écoute : un nouveau démarrage n'est plus suivi.
    const autre = elementAnime([fausseAnimation(document.body, Infinity)])
    demarrer(autre)
    expect(FauxObservateur.dernier!.suivis.size).toBe(0)
    desinstaller = () => undefined
  })
})
