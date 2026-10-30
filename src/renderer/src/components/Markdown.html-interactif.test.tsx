// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
/*
 * LA FENCE ```html-interactif DEVIENT UNE PAGE DONT LES SCRIPTS TOURNENT (BlocHtmlInteractif.tsx,
 * conv-1292) — dans le cadre isole des scenes 3D, et seulement une fois la fence close. Verrouille :
 *   - le decoupage (fermee -> page ; ouverte, vide ou trop grosse -> code ; html-render inchange) ;
 *   - l'ISOLEMENT : `sandbox="allow-scripts"` exactement, la page des scenes et rien d'autre ;
 *   - le protocole : le HTML, la feuille de base et le theme ne partent que vers NOTRE cadre ;
 *   - la hauteur suit la page, bornee ; une erreur remontee s'affiche sous le cadre ;
 *   - (conv-1304) la barre (code, relancer, copier), les avis sans doublon, les demandes de la
 *     page (copie et lien seulement apres un vrai clic, stockage rendu a la relance) et la ligne
 *     d'attente d'une page encore en ecriture. `sandbox` : scripts ET formulaires depuis conv-1304 ;
 *   - (conv-1304) un bouton de choix `#autowin-prompt` REMPLIT la saisie du fil, apres un vrai clic
 *     seulement, et n'envoie jamais rien ;
 *   - (conv-1304) « Corriger » sous une page en erreur, l'avis d'une page figee et sa relance, la
 *     vue agrandie, l'enregistrement en .html et la liberation d'une page sans 3D loin de l'ecran.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'
import { RemplirSaisieDuFil } from './saisie-du-fil'
import { decouperMarkdownSansReprise } from './markdown-blocs'
import {
  DELAI_RESSOURCES_MS,
  HAUTEUR_MAX_PAGE,
  PERIODE_SIGNE_DE_VIE_MS,
  SANDBOX_PAGE_INTERACTIVE,
  SEUIL_PAGE_FIGEE_MS,
  STYLE_PAGE_INTERACTIVE
} from './page-interactive'
import {
  MAX_PAGE_INTERACTIVE_CHARS,
  NOM_PAGE_INTERACTIVE,
  NOM_PAGE_SCENE_3D,
  TYPE_MESSAGE_SCENE_3D
} from '../../../shared/scene-3d'
import { CLASSES_PAGES_HTML } from '../../../shared/classes-pages-html'

let container: HTMLDivElement
let root: Root

let aLEcran = true
// Deux distances : `aLEcran` pour l'observateur proche, `pasTropLoin` pour celui de la liberation.
let pasTropLoin = true
const observateurs: Array<{ rappeler: () => void }> = []
class FauxObservateur {
  private readonly rappel: IntersectionObserverCallback
  private readonly lointain: boolean
  constructor(rappel: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rappel = rappel
    this.lointain = options?.rootMargin?.startsWith('1500') === true
  }
  observe(cible: Element): void {
    const rappeler = (): void =>
      this.rappel(
        [
          {
            isIntersecting: this.lointain ? pasTropLoin : aLEcran,
            target: cible
          } as unknown as IntersectionObserverEntry
        ],
        this as unknown as IntersectionObserver
      )
    observateurs.push({ rappeler })
    rappeler()
  }
  disconnect(): void {
    // Rien a liberer.
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
  pasTropLoin = true
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

const render = (text: string, remplirSaisie?: (texte: string) => void): void => {
  const page = createElement(Markdown, { text })
  act(() =>
    root.render(
      remplirSaisie
        ? createElement(RemplirSaisieDuFil.Provider, { value: remplirSaisie }, page)
        : page
    )
  )
}
const kinds = (text: string): string[] => decouperMarkdownSansReprise(text).map((bloc) => bloc.kind)
const PAGE =
  '<button id="b">0</button>\n<script>let n = 0; b.addEventListener("click", () => (b.textContent = ++n))</script>'
const bloc = (contenu: string): string => '```html-interactif\n' + contenu + '\n```'

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

const cadreDuFil = (): HTMLIFrameElement | null =>
  container.querySelector<HTMLIFrameElement>('[data-testid="html-interactif-cadre"]')

describe('Markdown — pages interactives', () => {
  it('rend une fence html-interactif fermee comme une page, et laisse html-render inline', () => {
    expect(kinds('Voici :\n\n' + bloc(PAGE))).toEqual(['text', 'html-interactif'])
    expect(kinds('```html-render\n<p>x</p>\n```')).toEqual(['html-render'])
    render('Voici :\n\n' + bloc(PAGE))
    expect(container.querySelector('[data-testid="chat-inline-html-interactif"]')).not.toBeNull()
    expect(container.querySelector('pre.md-code')).toBeNull()
  })

  it('laisse en code une fence vide ou au-dela de la borne ; une fence ouverte attend', () => {
    // Fence ouverte : le modele l'ecrit encore — une ligne d'attente, rien n'est execute.
    expect(kinds('```html-interactif\n' + PAGE)).toEqual(['html-interactif-en-cours'])
    expect(kinds(bloc('   '))).toEqual(['code'])
    expect(kinds(bloc('x'.repeat(MAX_PAGE_INTERACTIVE_CHARS + 1)))).toEqual(['code'])
    expect(kinds('```html\n' + PAGE + '\n```')).toEqual(['code'])
  })

  it('isole le cadre : la page des scenes, scripts et formulaires, jamais la meme origine', () => {
    render(bloc(PAGE))
    const cadre = cadreDuFil()
    expect(cadre?.getAttribute('sandbox')).toBe(SANDBOX_PAGE_INTERACTIVE)
    expect(SANDBOX_PAGE_INTERACTIVE.split(' ').sort()).toEqual(['allow-forms', 'allow-scripts'])
    // Page sans 3D : la page isolee SANS moteur three.js (conv-1304).
    expect(cadre?.getAttribute('src')).toBe(NOM_PAGE_INTERACTIVE)
    expect(cadre?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('envoie une page qui nomme THREE dans la page des scenes, qui porte le moteur', () => {
    render(bloc('<canvas id="c"></canvas><script>new THREE.Scene()</script>'))
    expect(cadreDuFil()?.getAttribute('src')).toBe(NOM_PAGE_SCENE_3D)
    expect(cadreDuFil()?.getAttribute('sandbox')).toBe(SANDBOX_PAGE_INTERACTIVE)
  })

  it('ne monte le cadre qu a l ecran, et le garde tant qu il n est pas loin', () => {
    aLEcran = false
    render(bloc(PAGE))
    expect(cadreDuFil()).toBeNull()
    aLEcran = true
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).not.toBeNull()
    // Un petit defilement ne la relance pas.
    aLEcran = false
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).not.toBeNull()
  })

  it('libere une page sans 3D tres loin de l ecran, sa place gardee, et la remonte au retour', () => {
    render(bloc(PAGE))
    aLEcran = false
    pasTropLoin = false
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).toBeNull()
    expect(container.querySelector('.bloc-html-interactif__cadre')).not.toBeNull()
    aLEcran = true
    pasTropLoin = true
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).not.toBeNull()
  })

  it('ne libere jamais une page que l utilisateur a touchee : il y perdrait sa saisie', () => {
    render(bloc(PAGE))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'touchee' })
    aLEcran = false
    pasTropLoin = false
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).not.toBeNull()
  })

  it('demonte une page 3D loin de l ecran, comme une scene, et la remonte a son retour', () => {
    render(bloc('<script>const r = new THREE.WebGLRenderer()</script>'))
    expect(cadreDuFil()).not.toBeNull()
    aLEcran = false
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).toBeNull()
    // Sa place garde sa hauteur : le fil ne saute pas.
    expect(container.querySelector('.bloc-html-interactif__cadre')).not.toBeNull()
    aLEcran = true
    act(() => observateurs.forEach((observateur) => observateur.rappeler()))
    expect(cadreDuFil()).not.toBeNull()
  })

  it('envoie la page a SON cadre apres son « pret », avec la feuille de base et le theme', () => {
    render(bloc(PAGE))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    const intrus = { postMessage: vi.fn() }

    message(intrus, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).not.toHaveBeenCalled()
    expect(intrus.postMessage).not.toHaveBeenCalled()

    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage).toHaveBeenCalledTimes(1)
    const [envoi, cible] = faux.postMessage.mock.calls[0]
    expect(cible).toBe('*')
    expect(envoi.type).toBe(TYPE_MESSAGE_SCENE_3D)
    expect(envoi.page.html).toBe(PAGE)
    expect(envoi.page.style).toBe(STYLE_PAGE_INTERACTIVE)
    expect(typeof envoi.page.theme.colorScheme).toBe('string')
    expect(envoi.code).toBeUndefined()
  })

  it('prend la hauteur que la page signale, bornee, et ignore une valeur absurde', () => {
    render(bloc(PAGE))
    const cadre = cadreDuFil() as HTMLIFrameElement
    const faux = brancherCadre(cadre)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'hauteur', hauteur: 231.4 })
    expect(cadre.style.height).toBe('232px')
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'hauteur', hauteur: 'beaucoup' })
    expect(cadre.style.height).toBe('232px')
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'hauteur', hauteur: 1e9 })
    expect(cadre.style.height).toBe(`${HAUTEUR_MAX_PAGE}px`)
  })

  it('affiche sous le cadre l erreur que la page remonte', () => {
    render(bloc(PAGE))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'erreur', message: 'x is not defined' })
    expect(
      container.querySelector('[data-testid="html-interactif-erreur"]')?.textContent
    ).toContain('x is not defined')
  })

  it('empile les avis sans doublon : erreur comptee, alerte fermable, avertissement', () => {
    render(bloc(PAGE))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    const erreur = {
      type: TYPE_MESSAGE_SCENE_3D,
      etat: 'erreur',
      message: 'boum (ligne 3 du bloc)'
    }
    message(faux, erreur)
    message(faux, erreur)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'alerte', message: 'salut' })
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'avertissement', message: 'confirm()' })
    const avis = container.querySelector('[data-testid="html-interactif-avis"]')
    expect(avis?.querySelectorAll('li')).toHaveLength(3)
    expect(avis?.textContent).toContain('boum (ligne 3 du bloc)')
    expect(avis?.textContent).toContain('×2')
    expect(avis?.textContent).toContain('salut')
    const fermer = avis?.querySelector<HTMLButtonElement>('.bloc-html-interactif__fermer')
    act(() => fermer?.click())
    expect(container.querySelectorAll('[data-testid="html-interactif-avis"] li')).toHaveLength(2)
  })

  it('montre le code sans demonter la page, et la relance a neuf', () => {
    render(bloc(PAGE))
    const premier = cadreDuFil() as HTMLIFrameElement
    const faux = brancherCadre(premier)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'erreur', message: 'boum' })
    const bouton = (action: string): HTMLButtonElement =>
      container.querySelector(`[data-action="${action}"]`) as HTMLButtonElement

    act(() => bouton('html-interactif-code').click())
    expect(container.querySelector('[data-testid="html-interactif-code"]')?.textContent).toBe(PAGE)
    expect(cadreDuFil()).toBe(premier)
    expect(premier.hidden).toBe(true)

    act(() => bouton('html-interactif-relancer').click())
    expect(container.querySelector('[data-testid="html-interactif-code"]')).toBeNull()
    expect(cadreDuFil()).not.toBe(premier)
    expect(container.querySelector('[data-testid="html-interactif-avis"]')).toBeNull()
  })

  it('copie le code du bloc depuis la barre', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(bloc(PAGE))
    const bouton = container.querySelector<HTMLButtonElement>(
      '[data-action="html-interactif-copier"]'
    )
    await act(async () => bouton?.click())
    expect(writeText).toHaveBeenCalledWith(PAGE)
    expect(bouton?.dataset.copie).toBe('oui')
  })

  it('ne copie et n ouvre un lien pour la page qu apres un vrai clic', () => {
    const writeText = vi.fn(() => Promise.resolve())
    const activation = { isActive: false }
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
      userActivation: activation
    })
    const clics: string[] = []
    const clicOrigine = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
      clics.push(`${this.href} ${this.target}`)
    }
    try {
      render(bloc(PAGE))
      const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
      const copier = { type: TYPE_MESSAGE_SCENE_3D, etat: 'copier', texte: 'x', demande: 7 }
      const lien = { type: TYPE_MESSAGE_SCENE_3D, etat: 'lien', href: 'https://example.com/a' }

      // Sans geste : refus repondu a la page, lien signale, rien d'ouvert ni de copie.
      message(faux, copier)
      message(faux, lien)
      expect(writeText).not.toHaveBeenCalled()
      expect(faux.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: TYPE_MESSAGE_SCENE_3D, reponse: 7, ok: false }),
        '*'
      )
      expect(clics).toEqual([])
      expect(
        container.querySelector('[data-testid="html-interactif-avis"]')?.textContent
      ).toContain('https://example.com/a')

      // Juste apres un clic de l'utilisateur dans la page.
      activation.isActive = true
      message(faux, copier)
      message(faux, lien)
      expect(writeText).toHaveBeenCalledWith('x')
      expect(clics).toEqual(['https://example.com/a _blank'])

      // Un lien qui n'est ni http ni https n'est jamais lu.
      message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'lien', href: 'file:///C:/x' })
      expect(clics).toHaveLength(1)
    } finally {
      HTMLAnchorElement.prototype.click = clicOrigine
    }
  })

  it('remplit la saisie du fil avec le choix de la page, apres un vrai clic seulement', () => {
    const activation = { isActive: false }
    vi.stubGlobal('navigator', { ...navigator, userActivation: activation })
    const saisie: string[] = []
    render(bloc(PAGE), (texte) => saisie.push(texte))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    const choix = { type: TYPE_MESSAGE_SCENE_3D, etat: 'prompt', texte: '  Affiner   la 2 · Nuit ' }
    const avis = (): string =>
      container.querySelector('[data-testid="html-interactif-avis"]')?.textContent ?? ''

    // Sans geste : la saisie de l'utilisateur n'est pas ecrasee, la page en est avertie.
    message(faux, choix)
    expect(saisie).toEqual([])
    expect(avis()).toMatch(/sans clic/u)

    // Juste apres un clic : le texte, blancs reduits, va dans la saisie — et RIEN n'est envoye
    // (aucune reponse a la page, aucun autre chemin que la saisie).
    activation.isActive = true
    message(faux, choix)
    expect(saisie).toEqual(['Affiner la 2 · Nuit'])
    expect(faux.postMessage).not.toHaveBeenCalled()

    // Vide ou trop long : jamais lu.
    message(faux, { ...choix, texte: '   ' })
    message(faux, { ...choix, texte: 'x'.repeat(4001) })
    expect(saisie).toHaveLength(1)
  })

  it('avertit sous la page quand aucune saisie ne peut recevoir le choix', () => {
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: true } })
    render(bloc(PAGE))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'prompt', texte: 'Implémenter la 1' })
    expect(container.querySelector('[data-testid="html-interactif-avis"]')?.textContent).toContain(
      'Implémenter la 1'
    )
  })

  it('rend a la page son stockage quand elle repart', () => {
    const html = PAGE + '\n<!-- stockage -->'
    render(bloc(html))
    let faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'stockage', donnees: { score: '12' } })
    act(() =>
      (container.querySelector('[data-action="html-interactif-relancer"]') as HTMLElement).click()
    )
    faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
    expect(faux.postMessage.mock.calls[0][0].page.stockage).toEqual({ score: '12' })
  })

  it('pose dans la saisie l erreur, sa ligne et le titre de la page, sans rien envoyer', () => {
    const saisie: string[] = []
    const html = '<h2>Mon budget</h2>\n<script>\nconst x = null\nx.total = 3\n</script>'
    render(bloc(html), (texte) => saisie.push(texte))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    const erreur = "TypeError: Cannot set properties of null (setting 'total') (ligne 4 du bloc)"
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'erreur', message: erreur })
    act(() =>
      (container.querySelector('[data-action="html-interactif-corriger"]') as HTMLElement).click()
    )
    expect(saisie).toEqual([
      `Corrige la page interactive « Mon budget » : ${erreur} — ligne 4 : x.total = 3`
    ])
    expect(faux.postMessage).not.toHaveBeenCalled()
  })

  it('ne propose pas « Corriger » la ou aucune saisie ne peut le recevoir', () => {
    render(bloc(PAGE))
    const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'erreur', message: 'Boum' })
    expect(container.querySelector('[data-testid="html-interactif-erreur"]')).not.toBeNull()
    expect(container.querySelector('[data-action="html-interactif-corriger"]')).toBeNull()
  })

  describe('signe de vie', () => {
    const figee = (): Element | null =>
      container.querySelector('[data-testid="html-interactif-figee"]')
    const attendre = (ms: number): void => {
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    }

    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('dit qu une page ne repond plus, puis efface l avis des qu elle revient', () => {
      render(bloc(PAGE), () => undefined)
      const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
      message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
      attendre(PERIODE_SIGNE_DE_VIE_MS)
      expect(faux.postMessage.mock.calls.some(([m]) => typeof m.ping === 'number')).toBe(true)
      expect(figee()).toBeNull()
      attendre(SEUIL_PAGE_FIGEE_MS + PERIODE_SIGNE_DE_VIE_MS)
      expect(figee()?.textContent).toMatch(/ne répond plus/u)
      message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pong' })
      expect(figee()).toBeNull()
    })

    it('relance une page figee a neuf depuis son avis', () => {
      render(bloc(PAGE))
      const avant = cadreDuFil()
      const faux = brancherCadre(avant as HTMLIFrameElement)
      message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
      attendre(SEUIL_PAGE_FIGEE_MS + PERIODE_SIGNE_DE_VIE_MS * 2)
      act(() =>
        (
          container.querySelector('[data-action="html-interactif-relancer-figee"]') as HTMLElement
        ).click()
      )
      expect(figee()).toBeNull()
      expect(cadreDuFil()).not.toBe(avant)
    })

    it('n accuse pas une page tant que sa fenetre est cachee', () => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      render(bloc(PAGE))
      const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
      message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
      attendre(SEUIL_PAGE_FIGEE_MS * 3)
      expect(figee()).toBeNull()
    })

    it('n accuse pas une page quand c est la minuterie du fil qui a pris du retard', () => {
      render(bloc(PAGE))
      const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
      message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'pret' })
      // Veille du poste : l'horloge saute, aucune minuterie n'a tourne entre-temps.
      vi.spyOn(performance, 'now').mockReturnValue(performance.now() + SEUIL_PAGE_FIGEE_MS * 4)
      attendre(PERIODE_SIGNE_DE_VIE_MS)
      expect(figee()).toBeNull()
    })
  })

  it('agrandit sans deplacer le cadre, et suit l etat du navigateur', () => {
    render(bloc(PAGE))
    const section = container.querySelector(
      '[data-testid="chat-inline-html-interactif"]'
    ) as HTMLElement
    const cadre = cadreDuFil()
    const ouvrir = vi.fn(() => {
      section.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }))
    })
    const fermer = vi.fn(() => {
      section.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' }))
    })
    section.showPopover = ouvrir
    section.hidePopover = fermer
    const bouton = container.querySelector(
      '[data-action="html-interactif-agrandir"]'
    ) as HTMLElement
    act(() => bouton.click())
    expect(ouvrir).toHaveBeenCalledOnce()
    expect(section.dataset.agrandi).toBe('oui')
    expect(bouton.textContent).toBe('Réduire')
    expect(cadreDuFil()).toBe(cadre)
    expect(cadreDuFil()?.style.height).toBe('')

    // Echap dans le cadre : le fil ne voit pas la touche, la page la lui signale.
    const faux = brancherCadre(cadre as HTMLIFrameElement)
    message(faux, { type: TYPE_MESSAGE_SCENE_3D, etat: 'echap' })
    expect(fermer).toHaveBeenCalledOnce()
    expect(section.dataset.agrandi).toBeUndefined()
    expect(bouton.textContent).toBe('Agrandir')
  })

  describe('enregistrer en .html', () => {
    const cliquer = (): void =>
      act(() =>
        (
          container.querySelector('[data-action="html-interactif-enregistrer"]') as HTMLElement
        ).click()
      )

    it('demande les ressources a la page, puis telecharge sous le titre de la page', async () => {
      const blobs: Blob[] = []
      const creer = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        blobs.push(blob as Blob)
        return 'blob:essai'
      })
      const noms: string[] = []
      const clicOrigine = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
        noms.push(this.download)
      }
      try {
        render(bloc('<h2>Budget 2026</h2>\n<p>contenu</p>'))
        const faux = brancherCadre(cadreDuFil() as HTMLIFrameElement)
        cliquer()
        const { ressources } = faux.postMessage.mock.calls[0][0]
        expect(ressources).toBeGreaterThan(0)
        // Une reponse a une autre demande est ignoree.
        const reponse = {
          type: TYPE_MESSAGE_SCENE_3D,
          etat: 'ressources',
          moteur: '',
          graphiques: ''
        }
        message(faux, { ...reponse, demande: ressources + 1 })
        expect(noms).toEqual([])
        message(faux, { ...reponse, demande: ressources })
        expect(noms).toEqual(['Budget-2026.html'])
        const texte = await blobs[0].text()
        expect(texte).toContain('<h2>Budget 2026</h2>')
        expect(texte).toContain('Content-Security-Policy')
      } finally {
        HTMLAnchorElement.prototype.click = clicOrigine
        creer.mockRestore()
      }
    })

    it('dit que l enregistrement a echoue quand la page ne repond pas', () => {
      vi.useFakeTimers()
      try {
        render(bloc(PAGE))
        brancherCadre(cadreDuFil() as HTMLIFrameElement)
        cliquer()
        act(() => {
          vi.advanceTimersByTime(DELAI_RESSOURCES_MS + 1)
        })
        expect(
          container.querySelector('[data-testid="html-interactif-avis"]')?.textContent
        ).toMatch(/Enregistrement impossible/u)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('montre une ligne d attente, pas un mur de code, tant que la page s ecrit', () => {
    render('Voici :\n\n```html-interactif\n<p>un</p>\n<p>deux</p>')
    const attente = container.querySelector('[data-testid="chat-inline-html-interactif-en-cours"]')
    expect(attente?.querySelector('summary')?.textContent).toMatch(/2 lignes/u)
    expect(cadreDuFil()).toBeNull()
  })

  it('definit dans la feuille du cadre chaque classe aw-* que le modele connait', () => {
    for (const { classe } of CLASSES_PAGES_HTML) {
      expect(STYLE_PAGE_INTERACTIVE).toContain(`.${classe}{`)
    }
  })
})
