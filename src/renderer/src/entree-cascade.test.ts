// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTRIBUT_CHANFREIN,
  ATTRIBUT_ENTREE,
  DUREE_CHANFREIN_MS,
  NOM_ANIMATION_CHANFREIN,
  DUREE_MS,
  NOM_ANIMATION,
  PAS_MS,
  RANG_MAX,
  SECOURS_MS,
  blocsDeCascade,
  marquerSurfacesChanfrein,
  jouerEntreeCascade
} from './entree-cascade'

/**
 * LA CASCADE D'ENTREE D'UNE VUE (conv-987, 2026-10-16, direction « 1 · Cascade » du draft) : les
 * blocs de la vue montent de 8 px en apparaissant, de haut en bas, un tous les 40 ms.
 *
 * happy-dom ne calcule aucune mise en page : chaque element recoit ici le rectangle qu'il aurait a
 * l'ecran, comme dans les vues mesurees le 16/10 (Task Manager : en-tete, bandeau, deux colonnes).
 */
type Boite = { top: number; left: number; width: number; height: number }
function poser(el: Element, b: Boite): Element {
  ;(el as HTMLElement).getBoundingClientRect = () =>
    ({ ...b, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top }) as DOMRect
  return el
}
function el(parent: Element, classe: string, b: Boite, tag = 'div'): Element {
  const e = document.createElement(tag)
  e.className = classe
  parent.appendChild(e)
  return poser(e, b)
}

/** La vue Task Manager telle que mesuree (622 px de haut). */
function vueTaskManager(): { racine: Element; noms: (blocs: Element[]) => string[] } {
  const racine = poser(document.createElement('section'), {
    top: 0,
    left: 0,
    width: 600,
    height: 622
  })
  const tete = el(racine, 'topbar', { top: 16, left: 18, width: 560, height: 180 }, 'header')
  el(tete, 'identite', { top: 34, left: 18, width: 188, height: 110 })
  el(tete, 'actions', { top: 34, left: 222, width: 356, height: 34 })
  el(tete, 'onglets', { top: 148, left: 18, width: 199, height: 50 })
  el(racine, 'stats', { top: 209, left: 18, width: 560, height: 35 })
  const corps = el(racine, 'layout', { top: 256, left: 18, width: 560, height: 351 })
  el(corps, 'liste', { top: 256, left: 18, width: 240, height: 351 })
  el(corps, 'detail', { top: 256, left: 270, width: 308, height: 351 })
  el(corps, 'poignee', { top: 256, left: 259, width: 9, height: 351 })
  return { racine, noms: (blocs) => blocs.map((b) => b.className) }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('blocsDeCascade', () => {
  it("descend dans l'en-tete et le grand conteneur, et rend les blocs en ordre de lecture", () => {
    const { racine, noms } = vueTaskManager()
    expect(noms(blocsDeCascade(racine))).toEqual([
      'identite',
      'actions',
      'onglets',
      'stats',
      'liste',
      'detail'
    ])
  })

  it('ignore les elements minuscules (poignees) et ceux hors de la vue', () => {
    const { racine, noms } = vueTaskManager()
    el(racine, 'hors-champ', { top: 900, left: 18, width: 560, height: 40 })
    const blocs = noms(blocsDeCascade(racine))
    expect(blocs).not.toContain('poignee')
    expect(blocs).not.toContain('hors-champ')
  })

  it('traverse un emballage a enfant unique (Knowledge : domain-content > graphe)', () => {
    const racine = poser(document.createElement('section'), {
      top: 0,
      left: 0,
      width: 600,
      height: 622
    })
    const emballage = el(racine, 'domain-content', { top: 16, left: 18, width: 560, height: 590 })
    const graphe = el(emballage, 'graphe', { top: 16, left: 18, width: 560, height: 590 })
    el(graphe, 'barre', { top: 16, left: 18, width: 560, height: 160 })
    el(graphe, 'scene', { top: 176, left: 18, width: 560, height: 430 })
    expect(blocsDeCascade(racine).map((b) => b.className)).toEqual(['barre', 'scene'])
  })

  it("une carte qui se peint entre d'un bloc ; une colonne peinte reste un conteneur", () => {
    // Mesure du 16/10 (Accueil) : descendre dans une tuile peinte faisait entrer ses poignees d'angle
    // a part, cadre deja en place — l'effet « squelette », pas la cascade.
    const racine = poser(document.createElement('section'), {
      top: 0,
      left: 0,
      width: 600,
      height: 622
    })
    document.body.appendChild(racine)
    const carte = el(racine, 'tuile', { top: 0, left: 0, width: 290, height: 300 }) as HTMLElement
    carte.style.backgroundColor = 'rgb(14, 14, 17)'
    el(carte, 'titre', { top: 0, left: 0, width: 290, height: 30 })
    el(carte, 'poignee', { top: 280, left: 270, width: 17, height: 17 })
    const colonne = el(racine, 'colonne', {
      top: 0,
      left: 300,
      width: 290,
      height: 622
    }) as HTMLElement
    colonne.style.backgroundColor = 'rgb(5, 5, 6)'
    el(colonne, 'tete', { top: 0, left: 300, width: 290, height: 90 })
    el(colonne, 'fil', { top: 90, left: 300, width: 290, height: 532 })
    expect(blocsDeCascade(racine).map((b) => b.className)).toEqual(['tuile', 'tete', 'fil'])
  })

  it('une vue sans mise en page (cachee, happy-dom) ne rend aucun bloc', () => {
    const racine = document.createElement('section')
    racine.appendChild(document.createElement('div'))
    expect(blocsDeCascade(racine)).toEqual([])
  })
})

describe('app-shell.css', () => {
  // Le CSS joue l'animation, ce module minute la fin : deux durees qui divergent laisseraient
  // l'attribut retire en pleine entree (bloc qui saute a sa place) ou pose bien apres.
  // Chemin et non `new URL(...)` : sous happy-dom, `URL` est celle du faux navigateur, que
  // `readFileSync` refuse (« The URL must be of scheme file »).
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'assets/app-shell.css'),
    'utf8'
  )
  const regle = css.match(/\.view-slot \[data-entree-cascade\]\s*\{([^}]*)\}/)?.[1] ?? ''

  it('joue la cascade de la maquette : 8 px, DUREE_MS, PAS_MS par rang, sans garde reduced-motion', () => {
    expect(css).toMatch(
      /@keyframes entree-cascade\s*\{\s*from\s*\{[^}]*opacity:\s*0;[^}]*translate:\s*0 8px/
    )
    expect(regle).toMatch(new RegExp(`animation:\\s*entree-cascade\\s+${DUREE_MS}ms`))
    expect(regle).toMatch(new RegExp(`var\\(--entree-rang, 0\\) \\* ${PAS_MS}ms`))
    expect(css).not.toMatch(/@media[^{]*prefers-reduced-motion[^{]*\{[^@]*entree-cascade/s)
  })

  it("ne fond plus la page entiere : l'ancienne vue disparait, la nouvelle n'est pas fondue", () => {
    expect(css).toMatch(
      /::view-transition-old\(root\)\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*0/
    )
    expect(css).toMatch(/::view-transition-new\(root\)\s*\{[^}]*animation:\s*none/)
  })
})

describe('jouerEntreeCascade', () => {
  function finir(bloc: Element, nom = NOM_ANIMATION): void {
    const evenement = new Event('animationend', { bubbles: true })
    Object.defineProperty(evenement, 'animationName', { value: nom })
    bloc.dispatchEvent(evenement)
  }

  it('pose le rang de chaque bloc et plafonne les derniers au meme rang', () => {
    const racine = poser(document.createElement('section'), {
      top: 0,
      left: 0,
      width: 600,
      height: 622
    })
    const blocs = Array.from({ length: RANG_MAX + 3 }, (_, i) =>
      el(racine, `b${i}`, { top: i * 40, left: 0, width: 600, height: 38 })
    )
    jouerEntreeCascade(racine)
    expect(blocs.every((b) => b.hasAttribute(ATTRIBUT_ENTREE))).toBe(true)
    const rangs = blocs.map((b) => (b as HTMLElement).style.getPropertyValue('--entree-rang'))
    expect(rangs.slice(0, 3)).toEqual(['0', '1', '2'])
    expect(rangs.at(-1)).toBe(String(RANG_MAX))
  })

  it("libere chaque bloc a la FIN de son entree, pas a l'echeance d'une minuterie", () => {
    vi.useFakeTimers()
    const racine = poser(document.createElement('section'), {
      top: 0,
      left: 0,
      width: 600,
      height: 622
    })
    const [a, b] = [0, 1].map((i) =>
      el(racine, `b${i}`, { top: i * 100, left: 0, width: 600, height: 90 })
    )
    jouerEntreeCascade(racine)
    // Montage lourd : la premiere image arrive tard, l'entree n'est pas finie — rien ne bouge.
    vi.advanceTimersByTime(PAS_MS + DUREE_MS + 400)
    expect(a.hasAttribute(ATTRIBUT_ENTREE)).toBe(true)
    // La fin d'une animation propre a un descendant (autre nom) ne libere rien.
    finir(a, 'jarvis-pulse')
    expect(a.hasAttribute(ATTRIBUT_ENTREE)).toBe(true)
    finir(a)
    expect(a.hasAttribute(ATTRIBUT_ENTREE)).toBe(false)
    expect((a as HTMLElement).style.getPropertyValue('--entree-rang')).toBe('')
    expect(b.hasAttribute(ATTRIBUT_ENTREE)).toBe(true)
    finir(b)
    expect(b.hasAttribute(ATTRIBUT_ENTREE)).toBe(false)
  })

  it('sans fin d animation (bloc demonte), le secours libere tout', () => {
    vi.useFakeTimers()
    const racine = poser(document.createElement('section'), {
      top: 0,
      left: 0,
      width: 600,
      height: 622
    })
    const bloc = el(racine, 'b', { top: 10, left: 0, width: 600, height: 100 })
    jouerEntreeCascade(racine)
    vi.advanceTimersByTime(SECOURS_MS)
    expect(bloc.hasAttribute(ATTRIBUT_ENTREE)).toBe(false)
  })

  it('une nouvelle entree efface la precedente (clics rapides)', () => {
    vi.useFakeTimers()
    const a = poser(document.createElement('section'), { top: 0, left: 0, width: 600, height: 622 })
    const blocA = el(a, 'a', { top: 10, left: 0, width: 600, height: 100 })
    const b = poser(document.createElement('section'), { top: 0, left: 0, width: 600, height: 622 })
    const blocB = el(b, 'b', { top: 10, left: 0, width: 600, height: 100 })
    jouerEntreeCascade(a)
    jouerEntreeCascade(b)
    expect(blocA.hasAttribute(ATTRIBUT_ENTREE)).toBe(false)
    expect(blocB.hasAttribute(ATTRIBUT_ENTREE)).toBe(true)
  })
})

/**
 * L'ENTREE DES CADRES A CHANFREIN (conv-987, 2026-10-16, variante « 2 · Elan », 1 s). Le module
 * marque les cadres coupes de la vue ; le THEME decide (son animation est l'inscription). Seul le
 * CADRE entre : le texte est la tout de suite (retour utilisateur du 16/10 apres la livraison :
 * « le texte doit etre la instantanement, l'animation concerne les box »).
 */
describe('cadres a chanfrein', () => {
  /** L'Accueil tel que mesure : plaque du titre dans l'en-tete, puis une tuile (titre + panneau). */
  function accueil(): { racine: Element; trouver: (classe: string) => Element } {
    const racine = poser(document.createElement('div'), {
      top: 0,
      left: 0,
      width: 600,
      height: 622
    })
    racine.className = 'home-view'
    document.body.appendChild(racine)
    const entete = el(racine, 'home-view__header', { top: 16, left: 0, width: 600, height: 109 })
    const plaque = el(entete, 'home-view__masthead', { top: 16, left: 0, width: 364, height: 109 })
    el(plaque, 'ligne', { top: 26, left: 14, width: 334, height: 26 })
    el(plaque, 'texte', { top: 57, left: 14, width: 334, height: 56 })
    const tuile = el(racine, 'home-tile', { top: 141, left: 0, width: 280, height: 116 }, 'section')
    el(tuile, 'home-tile__label', { top: 141, left: 0, width: 280, height: 24 })
    const panneau = el(tuile, 'home-tile__panel', { top: 165, left: 0, width: 280, height: 92 })
    el(panneau, 'home-tile__scroll', { top: 174, left: 7, width: 266, height: 74 })
    return { racine, trouver: (classe) => racine.querySelector(`.${classe}`) as Element }
  }
  const nomme =
    (n: string): ((e: Element) => boolean) =>
    (e) =>
      e.className === n

  it('ne garde que les cadres que le theme anime, et ne laisse aucune trace sur les autres', () => {
    const { racine, trouver } = accueil()
    const gardes = marquerSurfacesChanfrein(racine, nomme('home-tile__panel'))
    expect(gardes).toEqual([trouver('home-tile__panel')])
    expect(trouver('home-tile__panel').hasAttribute(ATTRIBUT_CHANFREIN)).toBe(true)
    expect(trouver('home-view__masthead').hasAttribute(ATTRIBUT_CHANFREIN)).toBe(false)
    expect(
      (trouver('home-view__masthead') as HTMLElement).style.getPropertyValue('--entree-rang')
    ).toBe('')
  })

  it('sans theme a chanfrein (happy-dom : aucune animation), la cascade reste celle de toujours', () => {
    const { racine, trouver } = accueil()
    jouerEntreeCascade(racine)
    expect(trouver('home-tile').hasAttribute(ATTRIBUT_ENTREE)).toBe(true)
    expect(racine.querySelectorAll(`[${ATTRIBUT_CHANFREIN}]`)).toHaveLength(0)
  })

  it("seuls les cadres entrent : aucun bloc de texte n'est marque, il est la tout de suite", () => {
    const { racine, trouver } = accueil()
    jouerEntreeCascade(racine, () => true)
    const plaque = trouver('home-view__masthead') as HTMLElement
    const panneau = trouver('home-tile__panel') as HTMLElement
    expect(plaque.hasAttribute(ATTRIBUT_CHANFREIN)).toBe(true)
    expect(panneau.hasAttribute(ATTRIBUT_CHANFREIN)).toBe(true)
    expect([plaque, panneau].map((s) => s.style.getPropertyValue('--entree-rang'))).toEqual([
      '0',
      '1'
    ])
    // Ni la tuile, ni son titre, ni la plaque, ni le contenu des cadres ne montent.
    expect(racine.querySelectorAll(`[${ATTRIBUT_ENTREE}]`)).toHaveLength(0)
    for (const c of ['ligne', 'texte', 'home-tile__label', 'home-tile__scroll']) {
      expect((trouver(c) as HTMLElement).style.getPropertyValue('--entree-rang'), c).toBe('')
    }
  })

  it('libere un cadre a la fin de SON dessin, jamais sur la fin de la montee d un bloc', () => {
    vi.useFakeTimers()
    const { racine, trouver } = accueil()
    jouerEntreeCascade(racine, () => true)
    const panneau = trouver('home-tile__panel')
    const finir = (cible: Element, nom: string): void => {
      const evenement = new Event('animationend', { bubbles: true })
      Object.defineProperty(evenement, 'animationName', { value: nom })
      cible.dispatchEvent(evenement)
    }
    finir(panneau, NOM_ANIMATION)
    expect(panneau.hasAttribute(ATTRIBUT_CHANFREIN)).toBe(true)
    finir(panneau, NOM_ANIMATION_CHANFREIN)
    expect(panneau.hasAttribute(ATTRIBUT_CHANFREIN)).toBe(false)
    expect((panneau as HTMLElement).style.getPropertyValue('--entree-rang')).toBe('')
    // La plaque, elle, attend la fin de SON dessin (ou le secours).
    expect(trouver('home-view__masthead').hasAttribute(ATTRIBUT_CHANFREIN)).toBe(true)
    vi.advanceTimersByTime(SECOURS_MS)
    expect(racine.querySelectorAll(`[${ATTRIBUT_ENTREE}], [${ATTRIBUT_CHANFREIN}]`)).toHaveLength(0)
  })

  it('app-shell.css porte le minutage de l Elan : 1 s cote theme, coins a 10 %, traits a 65 %', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'assets/app-shell.css'),
      'utf8'
    )
    const theme = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'assets/theme-nebuleuse-verre.css'),
      'utf8'
    )
    expect(theme).toContain(
      `animation: ${NOM_ANIMATION_CHANFREIN} ${DUREE_CHANFREIN_MS}ms linear both;`
    )
    const cles = css.match(/@keyframes entree-chanfrein \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(cles).toMatch(
      /10% \{\s*--ch-coin: 1;\s*--ch-trait: 0;\s*animation-timing-function: cubic-bezier\(0\.12, 0\.75, 0\.2, 1\);/
    )
    expect(cles).toMatch(/65% \{\s*--ch-trait: 1;/)
    for (const p of ['coin', 'trait', 'trait-a', 'contour', 'fond', 'lum']) {
      expect(css, p).toMatch(new RegExp(`@property --ch-${p} \\{[^}]*inherits: false;`))
    }
    // Le texte n'attend plus l'elan des traits : plus aucun decalage du contenu.
    expect(css).toContain('animation-delay: calc(var(--entree-rang, 0) * 40ms);')
    expect(css).not.toContain('--entree-decalage')
  })
})
