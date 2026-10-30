// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
/*
 * LA SCENE 3D VA DANS LE BLOC /draft — conv-318 (2026-10-17), tour
 * 5b0c4fcb-e354-410e-99b6-567740e86db1 : « le bloc 3d doit etre dans le bloc draft ».
 *
 * Depuis conv-1304 (2026-10-30), un carrousel EN VOLUME est UNE page ```html-interactif : le
 * carrousel, la place de la scene et la scene elle-meme, qui tourne dans la page. Le fil n'a plus
 * de montage special (draft-scene-3d.ts et SceneDuCarrousel.tsx sont retires). Verrouille :
 *   - le generateur ecrit un SEUL bloc html-interactif avec une scene, un html-render sans ;
 *   - le fil le rend en une seule page, sans bloc ```threejs a part ;
 *   - dans la page, la scene ecrite pour un cadre entier atterrit dans sa place et suit le rang
 *     affiche, au lancement puis a chaque changement ;
 *   - une scene qui n'ecoute pas ce rang, ou qui fermerait son script, est refusee ;
 *   - une scene d'un ANCIEN /draft (```threejs suivi du carrousel) se rend seule sans planter.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ATTRIBUT_SCRIPT_SCENE,
  SCRIPT_PLACE_SCENE,
  blocDuCarrousel,
  carrouselDraft,
  pageDuCarrousel3d,
  verifierPropositions
} from './draft-carrousel.mjs'
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

function brancherCadre(cadre) {
  const faux = { postMessage: vi.fn() }
  Object.defineProperty(cadre, 'contentWindow', { configurable: true, get: () => faux })
  return faux
}
const depuis = (source, data) =>
  act(() => window.dispatchEvent(new MessageEvent('message', { data, source })))

describe('/draft en volume — une seule page interactive qui porte sa scene', () => {
  it('le generateur ecrit UN bloc html-interactif : carrousel, place, puis scene', () => {
    const bloc = blocDuCarrousel(spec())
    expect(bloc.startsWith('```html-interactif\n')).toBe(true)
    expect(bloc).not.toContain('```threejs')
    expect(bloc.match(/^```/gmu)).toHaveLength(2)
    expect(bloc).toContain(`<div class="${CLASSE_PLACE_SCENE}"></div>`)
    // La scene vient APRES le script de sa place, dans son propre script.
    expect(bloc.indexOf(SCRIPT_PLACE_SCENE)).toBeGreaterThan(bloc.indexOf('class="dkc-car"'))
    expect(bloc.indexOf(`<script ${ATTRIBUT_SCRIPT_SCENE}>\n${SCENE}\n</script>`)).toBeGreaterThan(
      bloc.indexOf(SCRIPT_PLACE_SCENE)
    )
    // Ses boutons le disent : ils remplissent la saisie.
    expect(bloc).toMatch(/ils remplissent ta saisie/u)
    // Sans scene : le carrousel d'avant, html-render, sans place ni script.
    const sansScene = blocDuCarrousel(spec(false))
    expect(sansScene.startsWith('```html-render\n')).toBe(true)
    expect(carrouselDraft(spec(false))).not.toContain(CLASSE_PLACE_SCENE)
    expect(carrouselDraft(spec(false))).not.toMatch(/remplissent ta saisie/u)
    expect(() => pageDuCarrousel3d(spec(false))).toThrow(/scene3d/u)
  })

  it('refuse une scene qui ne suit pas la proposition affichee, ou qui fermerait son script', () => {
    const muette = { ...spec(), scene3d: 'const r = new THREE.WebGLRenderer();' }
    expect(verifierPropositions(muette).join(' ')).toMatch(/autowin\.surChoix/u)
    expect(
      verifierPropositions({ ...spec(), scene3d: 'autowin.surChoix(f)\n```\nx' })
    ).toHaveLength(1)
    expect(
      verifierPropositions({ ...spec(), scene3d: 'autowin.surChoix(f); "</script>"' }).join(' ')
    ).toMatch(/<\/script/u)
    expect(verifierPropositions(spec())).toEqual([])
  })

  it('le fil le rend en UNE page interactive, sans scene a part', () => {
    rendre('Voici les directions.\n\n' + blocDuCarrousel(spec()))
    expect(container.querySelectorAll('[data-testid="chat-inline-html-interactif"]')).toHaveLength(
      1
    )
    expect(container.querySelector('[data-testid="chat-inline-scene-3d"]')).toBeNull()
    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
  })

  it('dans la page, la scene atterrit dans sa place et suit le rang affiche', async () => {
    // La page telle que l'amorce la pose : le HTML dans le corps, puis les scripts executes.
    const hote = document.createElement('div')
    hote.innerHTML = pageDuCarrousel3d(spec()).replace(/<script[\s\S]*?<\/script>/gu, '')
    document.body.appendChild(hote)
    const place = hote.querySelector(`.${CLASSE_PLACE_SCENE}`)
    const vus = []
    window.__vus = vus
    try {
      ;(0, eval)(SCRIPT_PLACE_SCENE)
      ;(0, eval)(
        "const toile = document.createElement('canvas'); document.body.appendChild(toile);" +
          'autowin.surChoix((n) => window.__vus.push(n))'
      )
      // Ajoutee au corps par la scene, la toile est deplacee dans la place (observateur).
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(place.querySelector('canvas')).not.toBeNull()
      expect(vus).toEqual([1])
      const cases = hote.querySelectorAll('.dkc-car > input[type="radio"]')
      expect(cases).toHaveLength(3)
      cases[2].checked = true
      cases[2].dispatchEvent(new Event('change', { bubbles: true }))
      // Un changement qui ne touche pas au rang (Tout voir) ne rappelle personne.
      hote.querySelector('#dkall').dispatchEvent(new Event('change', { bubbles: true }))
      expect(vus).toEqual([1, 3])
      expect(window.autowin.choix).toBe(3)
      // Le rang est retenu : une page 3D demontee loin de l'ecran revient sur lui.
      expect(localStorage.getItem('dkc-choix')).toBe('3')
      // La taille que la scene lit est celle de sa place.
      expect(Object.getOwnPropertyDescriptor(window, 'innerWidth')?.get?.()).toBe(place.clientWidth)
    } finally {
      // Les surcharges posees sur la fenetre de test ne doivent pas fuir vers les autres tests.
      delete window.innerWidth
      delete window.innerHeight
      delete window.autowin
      hote.remove()
    }
  })

  it('la page relancee revient sur la proposition retenue', () => {
    localStorage.setItem('dkc-choix', '2')
    const hote = document.createElement('div')
    hote.innerHTML = pageDuCarrousel3d(spec()).replace(/<script[\s\S]*?<\/script>/gu, '')
    document.body.appendChild(hote)
    try {
      ;(0, eval)(SCRIPT_PLACE_SCENE)
      expect(window.autowin.choix).toBe(2)
      expect(hote.querySelectorAll('.dkc-car > input[type="radio"]')[1].checked).toBe(true)
    } finally {
      delete window.innerWidth
      delete window.innerHeight
      delete window.autowin
      localStorage.clear()
      hote.remove()
    }
  })

  it('une scene d un ANCIEN /draft se rend seule, avec le prelude, au lieu de planter', () => {
    const ancien =
      '```threejs\n' + SCENE + '\n```\n\n```html-render\n' + carrouselDraft(spec()) + '\n```\n'
    rendre(ancien)
    const scene = container.querySelector('[data-testid="chat-inline-scene-3d"]')
    expect(scene).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-inline-html"]').contains(scene)).toBe(false)
    const faux = brancherCadre(container.querySelector('[data-testid="scene-3d-cadre"]'))
    depuis(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).toHaveBeenCalledWith(
      { type: TYPE_MESSAGE_SCENE_3D, code: codeSceneDuCarrousel(SCENE) },
      '*'
    )
  })

  it('une scene ordinaire part telle quelle, sans prelude', () => {
    rendre('```threejs\nconst r = new THREE.WebGLRenderer();\n```')
    const faux = brancherCadre(container.querySelector('[data-testid="scene-3d-cadre"]'))
    depuis(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).toHaveBeenCalledWith(
      { type: TYPE_MESSAGE_SCENE_3D, code: 'const r = new THREE.WebGLRenderer();' },
      '*'
    )
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
    delete window.autowin
  })
})
