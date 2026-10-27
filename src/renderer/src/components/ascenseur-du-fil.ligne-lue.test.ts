// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  elementDeLecture,
  garderLePointLu,
  hautDuPointLu,
  pointDeLecture
} from './ascenseur-du-fil'

/*
 * LA LIGNE LUE, tenue pendant que la carte de l'ascenseur s'ouvre et se replie (conv-1143,
 * 2026-10-25). Sonde sur conv-1139 : après une ouverture puis un repli, la vue finissait de 24 à
 * 368 px plus bas qu'avant, 9 positions sur 25. L'espion de `document.elementFromPoint` a montré
 * pourquoi :
 *  - à 6 % du fil, les 4 points visés tombaient sur la CARTE et ses aperçus, posés par-dessus le
 *    fil : la barre se rabattait sur le message ENTIER, dont le haut était loin au-dessus de l'écran ;
 *  - à 50 %, le point tombait entre deux blocs et rendait le corps du message (1 635 px, haut à
 *    −1 609 px) ; au repli, elle prenait la ligne de liste visée (−47 px), et la vue ne revenait pas.
 * Tenir le haut d'un bloc loin au-dessus de la ligne laisse le texte entre les deux la déplacer.
 *
 * Le fil est simulé : vue en haut à 100 px, la ligne lue passe à 100 + 10 + 14 = 124 px.
 */

type Rect = { top: number; height: number }

function poser<T extends HTMLElement>(element: T, { top, height }: Rect): T {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 386,
      width: height > 0 ? 386 : 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({})
    }) as DOMRect
  return element
}

function bloc(tag: string, rect: Rect, ...enfants: (HTMLElement | string)[]): HTMLElement {
  const element = poser(document.createElement(tag), rect)
  for (const enfant of enfants)
    element.append(typeof enfant === 'string' ? document.createTextNode(enfant) : enfant)
  return element
}

/** Le fil : un message de l'agent dont le haut est 800 px au-dessus de la vue. */
function fil(...contenu: HTMLElement[]): HTMLElement {
  const conteneur = poser(document.createElement('div'), { top: 100, height: 264 })
  conteneur.className = 'chat-scroll'
  const message = bloc(
    'div',
    { top: -700, height: 1635 },
    bloc('div', { top: -700, height: 1635 }, ...contenu)
  )
  message.dataset.origine = 'reponse-agent'
  ;(message.firstElementChild as HTMLElement).className = 'msg-body'
  conteneur.append(bloc('div', { top: -2000, height: 3000 }, message))
  document.body.append(conteneur)
  return conteneur
}

afterEach(() => {
  document.body.innerHTML = ''
  delete (document as { elementFromPoint?: unknown }).elementFromPoint
  vi.restoreAllMocks()
})

describe('ligne lue — le bloc SOUS la ligne, jamais un bloc qui commence loin au-dessus', () => {
  it('la carte et ses aperçus recouvrent la ligne : la ligne de liste visée quand même (mesuré à 6 %)', () => {
    const visee = bloc('li', { top: 93, height: 109 }, 'Rien de tout ça n’existe aujourd’hui.')
    const conteneur = fil(
      bloc('p', { top: -700, height: 600 }, 'Long paragraphe au-dessus.'),
      bloc(
        'ul',
        { top: -90, height: 400 },
        bloc('li', { top: -90, height: 170 }, 'Ligne d’avant.'),
        visee,
        bloc('li', { top: 210, height: 100 }, 'Ligne d’après.')
      )
    )
    // Mesuré : `adf-apercu-t` sous chacun des 4 points visés.
    const carte = bloc('div', { top: 100, height: 264 })
    carte.className = 'adf-apercu-t'
    document.body.append(carte)
    document.elementFromPoint = () => carte
    expect(elementDeLecture(conteneur)).toBe(visee)
  })

  it('la ligne tombe entre deux blocs : le bloc qui suit, pas le corps du message (mesuré à 50 %)', () => {
    const suivant = bloc('li', { top: 130, height: 108 }, 'Aucun vrai échange n’a encore eu lieu.')
    const conteneur = fil(
      bloc('p', { top: -700, height: 500 }, 'Je lance la construction de l’option A.'),
      bloc(
        'ul',
        { top: -150, height: 400 },
        bloc('li', { top: -150, height: 270 }, 'Ligne d’avant, finie à 120 px.'),
        suivant
      )
    )
    // Mesuré : le point visé rend le corps du message, dans l'espace entre deux lignes de liste.
    document.elementFromPoint = () => conteneur.querySelector<HTMLElement>('.msg-body')
    expect(elementDeLecture(conteneur)).toBe(suivant)
  })

  it('la ligne tombe dans le texte d’un paragraphe : ce paragraphe, pas un mot en code plus bas', () => {
    const code = bloc('code', { top: 150, height: 18 }, 'scrollTop')
    const paragraphe = bloc(
      'p',
      { top: 110, height: 60 },
      'Le texte lu, puis ',
      code,
      ' plus loin.'
    )
    const conteneur = fil(bloc('p', { top: -700, height: 790 }, 'Au-dessus.'), paragraphe)
    document.elementFromPoint = () => null
    expect(elementDeLecture(conteneur)).toBe(paragraphe)
  })

  it('une liste en `display: contents` (sans boîte) : on descend dans ses lignes', () => {
    const cellule = bloc('span', { top: 115, height: 30 }, 'valeur lue')
    const rangee = bloc(
      'li',
      { top: 0, height: 0 },
      bloc('span', { top: 115, height: 30 }, 'clé'),
      cellule
    )
    const conteneur = fil(bloc('ul', { top: -100, height: 400 }, rangee))
    document.elementFromPoint = () => null
    // Deux cellules sur la même ligne : la première suffit, elles ont le même haut.
    expect(elementDeLecture(conteneur)?.textContent).toBe('clé')
  })
})

describe('ligne lue — gardée tant que la vue n’a pas bougé', () => {
  it('ni toi ni la barre n’ont bougé la vue : la même ligne, de l’ouverture au repli', () => {
    // Sinon le repli tient une autre ligne que l'ouverture, et la vue ne revient pas à sa place.
    expect(garderLePointLu(19223, 19223, false)).toBe(true)
    expect(garderLePointLu(19223.4, 19223, false)).toBe(true)
  })
  it('tu as défilé, ou le navigateur a borné la vue : on reprend la ligne en haut de la vue', () => {
    expect(garderLePointLu(19300, 19223, false)).toBe(false)
    expect(garderLePointLu(19100, 19223, false)).toBe(false)
  })
  it('un glissement ou la barre mènent la vue : on reprend la ligne en haut de la vue', () => {
    expect(garderLePointLu(19223, 19223, true)).toBe(false)
  })
})

/*
 * LE TEXTE EXACT SOUS LA LIGNE LUE (conv-1143, 2026-10-25). Sonde sur conv-1139, carte ouverte :
 * quand la ligne lue tombait au milieu d'un paragraphe de plusieurs lignes, le texte descendait
 * d'environ une ligne (19 à 22 px), 2 positions sur 4. Le maintien tenait le HAUT du paragraphe ;
 * plus étroit, le paragraphe se réagence et le texte lu passe plus bas DANS le paragraphe.
 *
 * Mise en page simulée : chaque caractère a sa boîte, `parLigne` caractères par ligne de 20 px. La
 * carte ouverte en laisse moins par ligne. La ligne lue est toujours à 124 px (vue à 100 px).
 */
type Disposition = (decalage: number) => Rect | null
const dispositions = new Map<Node, Disposition>()

function mesurerLesCaracteres(): void {
  const rects = (rect: Rect | null): DOMRectList =>
    (rect ? [poser(document.createElement('i'), rect).getBoundingClientRect()] : []) as never
  // Comme le navigateur : une plage de plusieurs caractères a une boîte dès que l'un d'eux en a une.
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const disposition = dispositions.get(this.startContainer)
    for (let decalage = this.startOffset; disposition && decalage < this.endOffset; decalage++) {
      const rect = disposition(decalage)
      if (rect) return rects(rect)
    }
    return rects(null)
  })
  // Comme le navigateur : la boîte d'une plage réunit celles de ses caractères.
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const disposition = dispositions.get(this.startContainer)
    let haut = Number.POSITIVE_INFINITY
    let bas = Number.NEGATIVE_INFINITY
    for (let decalage = this.startOffset; disposition && decalage < this.endOffset; decalage++) {
      const rect = disposition(decalage)
      if (!rect) continue
      haut = Math.min(haut, rect.top)
      bas = Math.max(bas, rect.top + rect.height)
    }
    const rect = bas > haut ? { top: haut, height: bas - haut } : { top: 0, height: 0 }
    return poser(document.createElement('i'), rect).getBoundingClientRect()
  })
}

/** Du texte dont le caractère `debut + i` est posé à la ligne `(debut + i) / parLigne` du bloc. */
function texte(
  nombre: number,
  disposition: { haut: () => number; parLigne: () => number; debut?: number; vides?: number }
): Text {
  const noeud = document.createTextNode('a'.repeat(nombre))
  dispositions.set(noeud, (decalage) => {
    const rang = (disposition.debut ?? 0) + decalage
    if (disposition.vides && rang % disposition.vides === 0) return null
    return { top: disposition.haut() + Math.floor(rang / disposition.parLigne()) * 20, height: 20 }
  })
  return noeud
}

describe('ligne lue — le caractère sous la ligne, pas le haut de son paragraphe', () => {
  afterEach(() => dispositions.clear())

  it('carte ouverte, le paragraphe se réagence : le haut tenu suit le texte lu (mesuré : 19 à 22 px)', () => {
    mesurerLesCaracteres()
    let parLigne = 40
    const paragraphe = bloc('p', { top: -100, height: 300 })
    paragraphe.append(texte(600, { haut: () => -100, parLigne: () => parLigne }))
    const conteneur = fil(bloc('p', { top: -700, height: 590 }, 'Au-dessus.'), paragraphe)
    const point = pointDeLecture(conteneur)
    expect(point?.element).toBe(paragraphe)
    const avant = hautDuPointLu(point!, conteneur)
    // Ligne lue à 124 px : la 12e ligne du paragraphe (120 à 140 px), caractère 440.
    expect(avant).toBe(20)
    // La carte s'ouvre : 30 caractères par ligne, le caractère 440 passe à la 15e (180 px).
    parLigne = 30
    poser(paragraphe, { top: -100, height: 400 })
    expect(hautDuPointLu(point!, conteneur) - avant).toBe(60)
  })

  it('un paragraphe en plusieurs morceaux (gras, texte) : le caractère du bon morceau', () => {
    mesurerLesCaracteres()
    let parLigne = 40
    const haut = (): number => -100
    const paragraphe = bloc('p', { top: -100, height: 300 })
    const gras = bloc('b', { top: -100, height: 40 })
    gras.append(texte(80, { haut, parLigne: () => parLigne }))
    paragraphe.append(gras, texte(520, { haut, parLigne: () => parLigne, debut: 80 }))
    const conteneur = fil(bloc('p', { top: -700, height: 590 }, 'Au-dessus.'), paragraphe)
    const point = pointDeLecture(conteneur)!
    const avant = hautDuPointLu(point, conteneur)
    expect(avant).toBe(20)
    parLigne = 30
    expect(hautDuPointLu(point, conteneur) - avant).toBe(60)
  })

  it('un mot en gras au milieu de la ligne lue : le DÉBUT de la ligne, dans le paragraphe (mesuré à 6 %)', () => {
    // Mesuré sur conv-1139 (fil de 510 px) : le bloc retenu était le `strong` de la ligne lue. Son
    // haut restait à 18 px quand la carte s'ouvrait, mais le début de la ligne remontait à −4 px.
    mesurerLesCaracteres()
    let parLigne = 40
    const haut = (): number => -100
    const paragraphe = bloc('p', { top: -100, height: 300 })
    // Ligne lue : caractères 440 à 479 ; le gras (450 à 469) commence au milieu.
    const gras = bloc('strong', { top: 120, height: 20 })
    gras.append(texte(20, { haut, parLigne: () => parLigne, debut: 450 }))
    paragraphe.append(
      texte(450, { haut, parLigne: () => parLigne }),
      gras,
      texte(130, { haut, parLigne: () => parLigne, debut: 470 })
    )
    const conteneur = fil(bloc('p', { top: -700, height: 590 }, 'Au-dessus.'), paragraphe)
    expect(elementDeLecture(conteneur)).toBe(gras)
    const point = pointDeLecture(conteneur)!
    expect(point.element).toBe(paragraphe)
    const avant = hautDuPointLu(point, conteneur)
    expect(avant).toBe(20)
    // Carte ouverte : le début de la ligne (440) passe à 180 px, le gras (450) à 200 px.
    parLigne = 30
    expect(hautDuPointLu(point, conteneur) - avant).toBe(60)
  })

  it('des espaces repliés, sans boîte, ne perdent pas la ligne lue', () => {
    mesurerLesCaracteres()
    let parLigne = 40
    const paragraphe = bloc('p', { top: -100, height: 300 })
    paragraphe.append(texte(600, { haut: () => -100, parLigne: () => parLigne, vides: 7 }))
    const conteneur = fil(bloc('p', { top: -700, height: 590 }, 'Au-dessus.'), paragraphe)
    const point = pointDeLecture(conteneur)!
    const avant = hautDuPointLu(point, conteneur)
    expect(avant).toBe(20)
    parLigne = 30
    expect(hautDuPointLu(point, conteneur) - avant).toBe(60)
  })

  it('le texte d’un bouton posé par-dessus le bloc (« Copier ») n’est jamais le texte lu', () => {
    mesurerLesCaracteres()
    let parLigne = 40
    const blocDeCode = bloc('pre', { top: -100, height: 300 })
    const copier = bloc('button', { top: 115, height: 20 })
    copier.style.position = 'absolute'
    // Le bouton reste en place, sur la ligne lue, quelle que soit la largeur du code.
    copier.append(texte(6, { haut: () => 115, parLigne: () => 100 }))
    blocDeCode.append(copier, texte(600, { haut: () => -100, parLigne: () => parLigne }))
    const conteneur = fil(bloc('p', { top: -700, height: 590 }, 'Au-dessus.'), blocDeCode)
    const point = pointDeLecture(conteneur)!
    expect(point.element).toBe(blocDeCode)
    const avant = hautDuPointLu(point, conteneur)
    parLigne = 30
    expect(hautDuPointLu(point, conteneur) - avant).toBe(60)
  })

  it('aucun texte à la ligne lue (une image) : on tient le haut du bloc', () => {
    mesurerLesCaracteres()
    const image = bloc('img', { top: 90, height: 200 })
    const conteneur = fil(bloc('p', { top: -700, height: 780 }, 'Au-dessus.'), image)
    const point = pointDeLecture(conteneur)!
    expect(point.element).toBe(image)
    expect(point.noeud).toBeNull()
    expect(hautDuPointLu(point, conteneur)).toBe(-10)
  })

  it('la ligne lue tombe juste SOUS la fin du texte : le début de la dernière ligne, pas le haut du bloc (mesuré : 87 px)', () => {
    // Mesuré sur conv-1139 (1 150 px, vue à 31 539) : la dernière ligne d'une réponse finissait à
    // 23,4 px, la ligne lue passait à 24 px, encore dans la boîte du bloc (fin à 25,5 px). Aucun
    // caractère ne finissait sous la ligne : la barre tenait le haut du bloc, 1 050 px plus haut,
    // et la ligne lue descendait de 87 px carte ouverte. À 31 538, elle finissait à 24,4 : 0 px.
    // Tenir le DERNIER caractère (le point final) ne suffisait pas : la dernière ligne se coupe en
    // deux quand le fil rétrécit, et le début de la ligne remontait d'une ligne (−21 px, mesuré).
    mesurerLesCaracteres()
    let parLigne = 40
    const haut = (): number => -176.6
    // 600 caractères, 15 lignes : la dernière de 103,4 à 123,4 px.
    const paragraphe = bloc('p', { top: -176.6, height: 302.1 })
    const fin = bloc('strong', { top: 103.4, height: 20 })
    fin.append(texte(20, { haut, parLigne: () => parLigne, debut: 580 }))
    paragraphe.append(texte(580, { haut, parLigne: () => parLigne }), fin)
    const conteneur = fil(bloc('p', { top: -700, height: 523.4 }, 'Au-dessus.'), paragraphe)
    const point = pointDeLecture(conteneur)!
    expect(point.element).toBe(paragraphe)
    // Le début de la dernière ligne (caractère 560), avant le gras qui la finit.
    expect(point.noeud).toBe(paragraphe.firstChild)
    expect(point.decalage).toBe(560)
    const avant = hautDuPointLu(point, conteneur)
    expect(avant).toBeCloseTo(3.4)
    // Carte ouverte : 30 caractères par ligne, le caractère 560 passe à la 19e ligne (183,4 px).
    parLigne = 30
    expect(hautDuPointLu(point, conteneur) - avant).toBeCloseTo(80)
  })

  it('un schéma dont les libellés ne sont pas rangés de haut en bas : le libellé sur la ligne lue', () => {
    // Mesuré sur conv-1139 (1 150 px) : dans un schéma, les libellés se suivent dans la page sans
    // suivre l'écran (« réponse » à −883 px, puis « rejuge » à −942, puis « juge » à −976). Les
    // libellés sont dans un dessin vectoriel : la barre s'arrête au cadre du schéma et cherche le
    // caractère parmi eux. Une dichotomie, qui suppose le texte posé de haut en bas, y prenait un
    // libellé du BAS du schéma.
    mesurerLesCaracteres()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const libelle = (haut: number, nombre: number): Text => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      const noeud = texte(nombre, { haut: () => haut, parLigne: () => 100 })
      element.append(noeud)
      svg.append(element)
      return noeud
    }
    libelle(300, 8) // le bas du schéma, premier dans la page
    const lu = libelle(115, 7) // sur la ligne lue (124 px)
    libelle(-80, 6) // le haut du schéma
    const schema = bloc('div', { top: -150, height: 500 })
    schema.className = 'md-mermaid'
    schema.append(svg)
    const conteneur = fil(bloc('p', { top: -700, height: 540 }, 'Au-dessus.'), schema)
    const point = pointDeLecture(conteneur)!
    expect(point.element).toBe(schema)
    expect(point.noeud).toBe(lu)
    expect(point.decalage).toBe(0)
    expect(hautDuPointLu(point, conteneur)).toBe(15)
  })

  it('un schéma tout au-dessus de la ligne lue : le début de son libellé le plus BAS, pas le dernier de la page', () => {
    mesurerLesCaracteres()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const libelle = (haut: number, nombre: number): Text => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      const noeud = texte(nombre, { haut: () => haut, parLigne: () => 100 })
      element.append(noeud)
      svg.append(element)
      return noeud
    }
    const bas = libelle(98, 8) // le plus bas, juste au-dessus de la ligne lue (fin à 118 px)
    libelle(-40, 7)
    libelle(-120, 6) // le plus haut, dernier dans la page
    const schema = bloc('div', { top: -150, height: 280 })
    schema.className = 'md-mermaid'
    schema.append(svg)
    const conteneur = fil(bloc('p', { top: -700, height: 540 }, 'Au-dessus.'), schema)
    const point = pointDeLecture(conteneur)!
    expect(point.element).toBe(schema)
    expect(point.noeud).toBe(bas)
    expect(point.decalage).toBe(0)
  })
})
