// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
/*
 * LA SCENE 3D VA DANS LE BLOC /draft — conv-318 (2026-10-17), tour
 * 5b0c4fcb-e354-410e-99b6-567740e86db1 : « le bloc 3d doit etre dans le bloc draft ».
 *
 * Le /draft de conv-315 (tour a6fcfb6e-c5ce-41c9-86c8-dcde195c67f2) rendait une scene ```threejs
 * avec ses propres boutons, PUIS un carrousel de fiches en texte : deux blocs. Ce qui est verrouille :
 *   - le generateur ecrit la scene juste avant le carrousel, qui lui laisse une place ;
 *   - le FIL monte cette scene DANS le carrousel (un seul bloc a l'ecran) ;
 *   - la scene recoit le rang de la proposition affichee, au lancement et a chaque changement ;
 *   - une scene qui n'ecoute pas ce rang est refusee par le generateur.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blocHtmlRender, carrouselDraft, verifierPropositions } from './draft-carrousel.mjs'
import { Markdown } from '../src/renderer/src/components/Markdown'
import { TYPE_MESSAGE_SCENE_3D } from '../src/shared/scene-3d'
import {
  CLASSE_PLACE_SCENE,
  PRELUDE_CHOIX_SCENE,
  codeSceneDuCarrousel
} from '../src/renderer/scene-3d/choix-scene.mjs'

const SCENE = [
  'const r = new THREE.WebGLRenderer();',
  'document.body.appendChild(r.domElement);',
  'autowin.surChoix((n) => { r.setClearColor(n * 1000) });'
].join('\n')

const spec = (avecScene = true) => ({
  titre: 'La ville de gauche',
  propositions: [1, 2, 3].map((n) => ({
    nom: `Direction ${n}`,
    resume: `ce qui change ${n}`,
    html: `<p class="fv-fiche">fiche ${n}</p>`
  })),
  ...(avecScene ? { scene3d: SCENE } : {})
})

class FauxObservateur {
  constructor(rappel) {
    this.rappel = rappel
  }
  observe(cible) {
    this.rappel([{ isIntersecting: true, target: cible }], this)
  }
  disconnect() {
    // Rien a liberer : le faux observateur ne tient aucune ressource.
  }
  unobserve() {
    // Idem.
  }
  takeRecords() {
    return []
  }
}

let container
let root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('IntersectionObserver', FauxObservateur)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const rendre = (texte) => act(() => root.render(createElement(Markdown, { text: texte })))

/** Un faux contenu de cadre : happy-dom n'execute pas la page de scene. */
function brancherCadre(cadre) {
  const faux = { postMessage: vi.fn() }
  Object.defineProperty(cadre, 'contentWindow', { configurable: true, get: () => faux })
  return faux
}
const depuis = (source, data) =>
  act(() => window.dispatchEvent(new MessageEvent('message', { data, source })))

describe('/draft en volume — la scene 3D dans le carrousel', () => {
  it('le generateur ecrit la scene avant le carrousel, et lui laisse une place', () => {
    const bloc = blocHtmlRender(spec())
    expect(bloc.startsWith('```threejs\n')).toBe(true)
    expect(bloc.indexOf('```html-render')).toBeGreaterThan(bloc.indexOf(SCENE))
    expect(bloc).toContain(`<div class="${CLASSE_PLACE_SCENE}"></div>`)
    // Sans scene : le carrousel d'avant, sans place ni clôture threejs.
    const sansScene = blocHtmlRender(spec(false))
    expect(sansScene.startsWith('```html-render\n')).toBe(true)
    expect(carrouselDraft(spec(false))).not.toContain(CLASSE_PLACE_SCENE)
  })

  it('refuse une scene qui ne suit pas la proposition affichee', () => {
    const muette = { ...spec(), scene3d: 'const r = new THREE.WebGLRenderer();' }
    expect(verifierPropositions(muette).join(' ')).toMatch(/autowin\.surChoix/)
    expect(
      verifierPropositions({ ...spec(), scene3d: 'autowin.surChoix(f)\n```\nx' })
    ).toHaveLength(1)
    expect(verifierPropositions(spec())).toEqual([])
  })

  it('le fil monte la scene DANS le carrousel : un seul bloc a l ecran', () => {
    rendre('Voici les directions.\n\n' + blocHtmlRender(spec()))
    const scenes = container.querySelectorAll('[data-testid="chat-inline-scene-3d"]')
    expect(scenes).toHaveLength(1)
    const carrousel = container.querySelector('[data-testid="chat-inline-html"] .dkc-car')
    expect(carrousel).not.toBeNull()
    expect(carrousel.contains(scenes[0])).toBe(true)
    expect(scenes[0].parentElement.classList.contains(CLASSE_PLACE_SCENE)).toBe(true)
  })

  it('une scene seule, sans carrousel qui l attend, reste un bloc a part', () => {
    rendre('```threejs\n' + SCENE + '\n```\n\n' + blocHtmlRender(spec(false)))
    const scene = container.querySelector('[data-testid="chat-inline-scene-3d"]')
    expect(scene).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-inline-html"]').contains(scene)).toBe(false)
  })

  it('la scene recoit le rang affiche : au lancement, puis a chaque changement', () => {
    rendre(blocHtmlRender(spec()))
    const cadre = container.querySelector('[data-testid="scene-3d-cadre"]')
    const faux = brancherCadre(cadre)
    depuis(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).toHaveBeenCalledWith(
      { type: TYPE_MESSAGE_SCENE_3D, code: codeSceneDuCarrousel(SCENE) },
      '*'
    )
    depuis(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'lancee' })
    expect(faux.postMessage).toHaveBeenLastCalledWith(
      { type: TYPE_MESSAGE_SCENE_3D, choix: 1 },
      '*'
    )
    const cases = container.querySelectorAll('.dkc-car > input[type="radio"]')
    expect(cases).toHaveLength(3)
    act(() => {
      cases[2].checked = true
      cases[2].dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(faux.postMessage).toHaveBeenLastCalledWith(
      { type: TYPE_MESSAGE_SCENE_3D, choix: 3 },
      '*'
    )
    // Un 'lancee' venu d'ailleurs que de notre cadre n'envoie rien.
    const appels = faux.postMessage.mock.calls.length
    depuis({ postMessage: vi.fn() }, { type: TYPE_MESSAGE_SCENE_3D, etat: 'lancee' })
    expect(faux.postMessage.mock.calls.length).toBe(appels)
  })

  it('le prelude de la scene : rang courant tout de suite, puis ceux du parent seulement', () => {
    expect(PRELUDE_CHOIX_SCENE).toContain(`'${TYPE_MESSAGE_SCENE_3D}'`)
    expect(PRELUDE_CHOIX_SCENE).not.toContain('\n')
    const vus = []
    window.__vus = vus
    ;(0, eval)(codeSceneDuCarrousel('autowin.surChoix((n) => window.__vus.push(n))'))
    expect(vus).toEqual([1])
    // happy-dom : la fenetre de test est son propre parent.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: TYPE_MESSAGE_SCENE_3D, choix: 4 },
        source: window.parent
      })
    )
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: TYPE_MESSAGE_SCENE_3D, choix: 5 }, source: {} })
    )
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'autre', choix: 6 }, source: window.parent })
    )
    expect(vus).toEqual([1, 4])
    expect(window.autowin.choix).toBe(4)
  })
})
