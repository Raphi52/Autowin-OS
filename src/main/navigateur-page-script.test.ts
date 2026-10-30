// @vitest-environment happy-dom
/**
 * Les scripts de page du navigateur intégré, joués dans un VRAI DOM (conv-1286, lot 1/5).
 *
 * happy-dom ne calcule pas de mise en page : `getBoundingClientRect` y rend un rectangle nul, donc
 * tout serait « invisible ». On le remplace par une taille fixe, sauf pour un élément dont le style
 * est `display: none` — exactement ce qu'un vrai navigateur rendrait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appelPage,
  decoderAppelPage,
  PING_NAVIGATEUR,
  SOURCE_NOYAU_NAVIGATEUR,
  type FocusPage,
  type LocalisationPage,
  type MessagePage,
  type MethodePage
} from './navigateur-page-script'
import type { InstantanePage } from '../shared/navigateur'

interface NoyauDeTest {
  calque: ShadowRoot | null
  bulleTexte?: HTMLTextAreaElement
  mode: string | null
  file: MessagePage[]
}

function jouer<T>(methode: MethodePage, args: unknown[] = []): T {
  // Eval INDIRECT : portée globale, comme `executeJavaScriptInIsolatedWorld`.
  return (0, eval)(appelPage(methode, args)) as T
}

function noyau(): NoyauDeTest {
  return (window as unknown as { __awNav: NoyauDeTest }).__awNav
}

function pointeur(type: string, cible: EventTarget, x: number, y: number): void {
  cible.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y
    })
  )
}

const rectOriginal = Element.prototype.getBoundingClientRect

beforeEach(() => {
  // Le mode du test précédent écoute encore `window` : on l'éteint, sinon il avale nos événements.
  const precedent = (window as unknown as { __awNav?: { quitterMode(s: boolean): void } }).__awNav
  precedent?.quitterMode(false)
  delete (window as unknown as { __awNav?: unknown }).__awNav
  document.querySelectorAll('aw-nav-calque').forEach((h) => h.remove())
  document.body.innerHTML = ''
  document.title = 'Page de test'
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const cache = getComputedStyle(this).display === 'none'
    const taille = cache ? 0 : 1
    return {
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      width: 100 * taille,
      height: 30 * taille,
      right: 110,
      bottom: 50,
      toJSON: () => ({})
    } as DOMRect
  }
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = rectOriginal
  vi.restoreAllMocks()
})

describe('appelPage — la source envoyée à la page', () => {
  it('se relit à l’identique, même avec des guillemets et des accolades dans les arguments', () => {
    const args = [{ selecteur: 'a[title="x"]);alert(1);//' }, { focaliser: true }]
    expect(decoderAppelPage(appelPage('localiser', args))).toEqual({ methode: 'localiser', args })
  })

  it('le noyau est idempotent : le rejouer ne vide pas la file en attente', () => {
    document.body.innerHTML = '<button id="b">OK</button>'
    jouer('activerMode', ['choisir'])
    const b = document.getElementById('b') as HTMLElement
    pointeur('pointerdown', b, 50, 30)
    pointeur('pointerup', b, 50, 30)
    ;(0, eval)(SOURCE_NOYAU_NAVIGATEUR)
    expect(jouer<MessagePage[]>('prendre')).toHaveLength(1)
  })
})

describe('instantane', () => {
  it('numérote les éléments interactifs visibles et saute les cachés, désactivés et masqués', () => {
    document.body.innerHTML = `
      <a href="/x">Lien</a>
      <button>Envoyer</button>
      <button style="display:none">Caché</button>
      <button disabled>Gris</button>
      <div hidden><button>Dans hidden</button></div>
      <input type="hidden" value="secret-cache">
      <label for="nom">Nom</label><input id="nom" value="Ada">
      <div role="button" aria-label="Menu"></div>
      <p>Paragraphe simple</p>`
    const inst = jouer<InstantanePage>('instantane', [100, 1000])
    expect(inst.elements.map((e) => [e.ref, e.role, e.nom, e.valeur])).toEqual([
      [1, 'link', 'Lien', undefined],
      [2, 'button', 'Envoyer', undefined],
      [3, 'textbox', 'Nom', 'Ada'],
      [4, 'button', 'Menu', undefined]
    ])
    expect(document.querySelectorAll('[data-aw-ref]')).toHaveLength(4)
    expect(inst.titre).toBe('Page de test')
    expect(inst.texte).toContain('Paragraphe simple')
  })

  it('ne livre JAMAIS la valeur d’un mot de passe ou d’un code à usage unique', () => {
    document.body.innerHTML = `
      <input type="password" value="hunter2">
      <input autocomplete="current-password" value="motdepasse">
      <input autocomplete="one-time-code" value="123456">`
    const inst = jouer<InstantanePage>('instantane', [100, 1000])
    expect(inst.elements).toHaveLength(3)
    expect(inst.elements.every((e) => e.role === 'password' && e.valeur === undefined)).toBe(true)
    expect(JSON.stringify(inst)).not.toMatch(/hunter2|motdepasse|123456/)
  })

  it('renumérote à chaque lecture (aucune référence périmée) et borne éléments et texte', () => {
    document.body.innerHTML = '<button>A</button><button>B</button><button>C</button>'
    jouer('instantane', [100, 1000])
    document.body.firstElementChild?.remove()
    const inst = jouer<InstantanePage>('instantane', [1, 5])
    expect(inst.elements).toEqual([{ ref: 1, role: 'button', nom: 'B' }])
    expect(document.querySelectorAll('[data-aw-ref]')).toHaveLength(1)
    expect(inst.texte.length).toBeLessThanOrEqual(5)
  })
})

describe('localiser et focus — la garde mot de passe côté page', () => {
  it('trouve par ref et par sélecteur, rend le centre, et signale un champ secret', () => {
    document.body.innerHTML = '<input id="mdp" type="password"><button>Go</button>'
    jouer('instantane', [100, 1000])
    const parRef = jouer<LocalisationPage>('localiser', [{ ref: 2 }, {}])
    expect(parRef).toMatchObject({ trouve: true, x: 60, y: 35, secret: false })
    const parSel = jouer<LocalisationPage>('localiser', [
      { selecteur: '#mdp' },
      { focaliser: true }
    ])
    expect(parSel).toMatchObject({ trouve: true, secret: true })
    expect(jouer<{ secret: boolean }>('focus').secret).toBe(true)
  })

  it('un champ ordinaire n’est pas secret ; une cible absente ou un sélecteur invalide = non trouvé', () => {
    document.body.innerHTML = '<input id="q" type="search" autocomplete="off">'
    expect(
      jouer<LocalisationPage>('localiser', [{ selecteur: '#q' }, { focaliser: true }]).secret
    ).toBe(false)
    expect(jouer<{ secret: boolean }>('focus').secret).toBe(false)
    expect(jouer<LocalisationPage>('localiser', [{ ref: 99 }, {}]).trouve).toBe(false)
    expect(jouer<LocalisationPage>('localiser', [{ selecteur: '))' }, {}]).trouve).toBe(false)
  })

  // Objection du juge (conv-1287, réparation 1) : une frappe sans cible doit pouvoir surligner le
  // champ actif, donc `focus` rend sa position ; sans champ actif, la touche va à la page entière.
  it('focus rend la position du champ actif, ou toute la fenêtre quand rien n’a le focus', () => {
    document.body.innerHTML = '<input id="q">'
    ;(document.getElementById('q') as HTMLInputElement).focus()
    expect(jouer<FocusPage>('focus')).toMatchObject({
      aucun: false,
      rect: { x: 10, y: 20, largeur: 100, hauteur: 30 }
    })
    ;(document.getElementById('q') as HTMLInputElement).blur()
    expect(jouer<FocusPage>('focus')).toMatchObject({
      aucun: true,
      rect: { x: 0, y: 0, largeur: window.innerWidth, hauteur: window.innerHeight }
    })
  })

  it('un cadre intégré est signalé : son contenu n’est pas vérifiable', () => {
    document.body.innerHTML = '<iframe id="f"></iframe>'
    expect(jouer<LocalisationPage>('localiser', [{ selecteur: '#f' }, {}]).cadreIntegre).toBe(true)
  })
})

describe('surbrillance', () => {
  it('pose puis retire un cadre dans un calque à racine fermée', () => {
    jouer('surligner', [{ x: 1, y: 2, largeur: 30, hauteur: 40 }, 'clic'])
    const calque = noyau().calque as ShadowRoot
    const cadre = calque.querySelector('.surbrillance') as HTMLElement
    expect(cadre.style.width).toBe('30px')
    expect(cadre.textContent).toBe('clic')
    expect(document.querySelector('aw-nav-calque')?.shadowRoot).toBeNull()
    jouer('retirerSurbrillance')
    expect(calque.querySelector('.surbrillance')).toBeNull()
  })
})

describe('mode annoter', () => {
  it('un clic ouvre la bulle sans déclencher la page ; Entrée range l’annotation et pose la pastille 1', () => {
    document.body.innerHTML = '<h1 id="titre" style="color: rgb(255, 0, 0)">Bonjour</h1>'
    const clicPage = vi.fn()
    document.addEventListener('click', clicPage)
    const ping = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    jouer('activerMode', ['annoter'])
    const h1 = document.getElementById('titre') as HTMLElement
    pointeur('pointerdown', h1, 50, 30)
    pointeur('pointerup', h1, 50, 30)
    h1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicPage).not.toHaveBeenCalled()

    const texte = noyau().bulleTexte as HTMLTextAreaElement
    texte.value = 'Plus gros, en bleu'
    texte.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )

    expect(ping).toHaveBeenCalledWith(PING_NAVIGATEUR)
    const [message] = jouer<MessagePage[]>('prendre')
    expect(message).toMatchObject({
      type: 'annotation',
      selecteur: '#titre',
      texteElement: 'Bonjour',
      commentaire: 'Plus gros, en bleu',
      rect: { x: 10, y: 20, largeur: 100, hauteur: 30 }
    })
    if (message.type !== 'annotation') throw new Error('type inattendu')
    expect(message.styles.couleur).toBe('rgb(255, 0, 0)')
    expect(message.styles.marges).toMatch(/^marge .* · retrait /)
    expect(jouer<MessagePage[]>('prendre')).toEqual([])
    const pastilles = (noyau().calque as ShadowRoot).querySelectorAll('.pastille')
    expect([...pastilles].map((p) => p.textContent)).toEqual(['1'])
  })

  it('un glisser trace une zone : l’annotation porte le rectangle de la zone', () => {
    document.body.innerHTML = '<div id="carte">Carte</div>'
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const carte = document.getElementById('carte') as HTMLElement
    document.elementFromPoint = (): Element => carte
    jouer('activerMode', ['annoter'])
    pointeur('pointerdown', carte, 10, 10)
    pointeur('pointermove', carte, 110, 60)
    pointeur('pointerup', carte, 110, 60)
    const texte = noyau().bulleTexte as HTMLTextAreaElement
    texte.value = 'Cette zone'
    texte.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(jouer<MessagePage[]>('prendre')[0]).toMatchObject({
      selecteur: '#carte',
      rect: { x: 10, y: 10, largeur: 100, hauteur: 50 }
    })
  })

  it('un commentaire vide n’ajoute rien ; Échap ferme la bulle puis quitte le mode', () => {
    document.body.innerHTML = '<p id="p">Texte</p>'
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    jouer('activerMode', ['annoter'])
    const p = document.getElementById('p') as HTMLElement
    pointeur('pointerdown', p, 5, 5)
    pointeur('pointerup', p, 5, 5)
    const texte = noyau().bulleTexte as HTMLTextAreaElement
    texte.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(jouer<MessagePage[]>('prendre')).toEqual([])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect((noyau().calque as ShadowRoot).querySelector('.bulle')).toBeNull()
    expect(noyau().mode).toBe('annoter')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(noyau().mode).toBeNull()
    expect(jouer<MessagePage[]>('prendre')).toEqual([{ type: 'mode-quitte' }])
  })

  it('retirer une pastille renumérote les autres ; vider les retire toutes', () => {
    document.body.innerHTML = '<p id="a">A</p><p id="b">B</p>'
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    jouer('activerMode', ['annoter'])
    for (const id of ['a', 'b']) {
      const el = document.getElementById(id) as HTMLElement
      pointeur('pointerdown', el, 5, 5)
      pointeur('pointerup', el, 5, 5)
      const texte = noyau().bulleTexte as HTMLTextAreaElement
      texte.value = `note ${id}`
      texte.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
    const [premiere] = jouer<Array<{ idPage: string }>>('prendre')
    jouer('retirerPastille', [premiere.idPage])
    const calque = noyau().calque as ShadowRoot
    expect([...calque.querySelectorAll('.pastille')].map((p) => p.textContent)).toEqual(['1'])
    jouer('viderPastilles')
    expect(calque.querySelectorAll('.pastille')).toHaveLength(0)
  })
})

describe('mode choisir', () => {
  it('un seul clic : l’élément est rangé sans commentaire et le mode s’éteint', () => {
    document.body.innerHTML = '<button id="b" style="font-size: 18px">Payer</button>'
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    jouer('activerMode', ['choisir'])
    const b = document.getElementById('b') as HTMLElement
    pointeur('pointerdown', b, 50, 30)
    pointeur('pointerup', b, 50, 30)
    const [message] = jouer<MessagePage[]>('prendre')
    expect(message).toMatchObject({
      type: 'choisi',
      selecteur: '#b',
      texteElement: 'Payer',
      commentaire: ''
    })
    if (message.type !== 'choisi') throw new Error('type inattendu')
    expect(message.styles.taille).toBe('18px')
    expect(noyau().mode).toBeNull()
    expect((noyau().calque as ShadowRoot).querySelector('.bulle')).toBeNull()
  })
})
