// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
/*
 * LA FENCE ```threejs DEVIENT UNE SCENE VIVANTE DANS LE FIL (Bloc3D.tsx, conv-299) — dans un cadre
 * isole, et seulement une fois la fence close. Ce qui est verrouille ici :
 *   - le decoupage (fermee -> scene ; ouverte, vide ou trop grosse -> code) ;
 *   - l'ISOLEMENT du cadre : `sandbox="allow-scripts"` exactement, jamais `allow-same-origin` ;
 *   - le protocole : le code ne part que vers NOTRE cadre, apres son `pret`.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'
import { decouperMarkdownSansReprise } from './markdown-blocs'
import {
  MAX_SCENE_3D_CHARS,
  NOM_PAGE_SCENE_3D,
  TYPE_MESSAGE_SCENE_3D
} from '../../../shared/scene-3d'

let container: HTMLDivElement
let root: Root

/**
 * L'observateur de visibilite, pilote par le test : happy-dom en fournit un qui ne signale jamais
 * rien, et une scene n'est montee qu'a l'ecran. `aLEcran` decide de ce qu'il rapporte.
 */
let aLEcran = true
const observateurs: Array<{ rappeler: () => void }> = []
class FauxObservateur {
  private readonly rappel: IntersectionObserverCallback
  constructor(rappel: IntersectionObserverCallback) {
    this.rappel = rappel
  }
  observe(cible: Element): void {
    const rappeler = (): void =>
      this.rappel(
        [{ isIntersecting: aLEcran, target: cible } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      )
    observateurs.push({ rappeler })
    rappeler()
  }
  disconnect(): void {
    // Rien a liberer : le faux observateur ne tient aucune ressource.
  }
  unobserve(): void {
    // Idem.
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  aLEcran = true
  observateurs.length = 0
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

const render = (text: string): void => {
  act(() => root.render(createElement(Markdown, { text })))
}
const kinds = (text: string): string[] => decouperMarkdownSansReprise(text).map((bloc) => bloc.kind)
const SCENE = 'const r = new THREE.WebGLRenderer();\ndocument.body.appendChild(r.domElement);'

/** Un faux contenu de cadre, pose sur l'iframe : happy-dom n'execute pas la page de scene. */
function brancherCadre(cadre: HTMLIFrameElement): { postMessage: ReturnType<typeof vi.fn> } {
  const faux = { postMessage: vi.fn() }
  Object.defineProperty(cadre, 'contentWindow', { configurable: true, get: () => faux })
  return faux
}

function message(source: unknown, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }))
  })
}

describe('Markdown — scenes three.js', () => {
  it('rend une fence threejs fermee comme une scene, pas comme du code', () => {
    expect(kinds('Voici :\n\n```threejs\n' + SCENE + '\n```')).toEqual(['text', 'scene-3d'])
    render('Voici :\n\n```threejs\n' + SCENE + '\n```')
    expect(container.querySelector('[data-testid="chat-inline-scene-3d"]')).not.toBeNull()
    expect(container.querySelector('pre.md-code')).toBeNull()
  })

  it('laisse en code une fence ouverte, vide ou au-dela de la borne', () => {
    expect(kinds('```threejs\n' + SCENE)).toEqual(['code'])
    expect(kinds('```threejs\n   \n```')).toEqual(['code'])
    const enorme = 'x'.repeat(MAX_SCENE_3D_CHARS + 1)
    expect(kinds('```threejs\n' + enorme + '\n```')).toEqual(['code'])
    // Un bloc ```js ordinaire qui parle de three.js reste du code.
    expect(kinds('```js\n' + SCENE + '\n```')).toEqual(['code'])
  })

  it('isole le cadre : scripts seulement, jamais la meme origine que l app', () => {
    render('```threejs\n' + SCENE + '\n```')
    const cadre = container.querySelector<HTMLIFrameElement>('[data-testid="scene-3d-cadre"]')
    expect(cadre).not.toBeNull()
    expect(cadre?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(cadre?.getAttribute('src')).toBe(NOM_PAGE_SCENE_3D)
    expect(cadre?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('ne tient aucun cadre hors de l ecran, et le remonte quand la scene revient', () => {
    aLEcran = false
    render('```threejs\n' + SCENE + '\n```')
    expect(container.querySelector('[data-testid="scene-3d-cadre"]')).toBeNull()
    expect(container.querySelector('.bloc-3d__veille')).not.toBeNull()

    aLEcran = true
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(container.querySelector('[data-testid="scene-3d-cadre"]')).not.toBeNull()
  })

  it('envoie le code a SON cadre apres son « pret », et a personne d autre', () => {
    render('```threejs\n' + SCENE + '\n```')
    const cadre = container.querySelector<HTMLIFrameElement>('[data-testid="scene-3d-cadre"]')
    const faux = brancherCadre(cadre as HTMLIFrameElement)
    const intrus = { postMessage: vi.fn() }

    message(intrus, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).not.toHaveBeenCalled()
    expect(intrus.postMessage).not.toHaveBeenCalled()

    message(faux, { type: 'autre-chose', etat: 'pret' })
    expect(faux.postMessage).not.toHaveBeenCalled()

    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).toHaveBeenCalledWith({ type: TYPE_MESSAGE_SCENE_3D, code: SCENE }, '*')
  })

  it('affiche l erreur que la scene remonte, et la source sur demande', () => {
    render('```threejs\n' + SCENE + '\n```')
    const cadre = container.querySelector<HTMLIFrameElement>('[data-testid="scene-3d-cadre"]')
    const faux = brancherCadre(cadre as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'erreur', message: 'x is not defined' })
    expect(container.querySelector('[data-testid="scene-3d-erreur"]')?.textContent).toContain(
      'x is not defined'
    )

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-action="scene-3d-source"]')?.click()
    })
    expect(container.querySelector('[data-testid="scene-3d-cadre"]')).toBeNull()
    expect(container.querySelector('.bloc-3d__source')?.textContent).toBe(SCENE)
  })
})
