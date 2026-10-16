// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTRIBUT_ENTREE,
  DUREE_MS,
  NOM_ANIMATION,
  PAS_MS,
  RANG_MAX,
  SECOURS_MS,
  blocsDeCascade,
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
