// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANIMATIONS_PAR_CRANS,
  calerSurLHorloge,
  CRAN_MS,
  installerAnimationsParCrans
} from './animations-par-crans'

/**
 * Ce que ces tests défendent (conv-1075) : un indicateur qui tourne en continu fait recomposer la
 * fenêtre ENTIÈRE 60 fois par seconde — 20 à 33 % d'une GT 1030 pour un atome de 16 px ou le point
 * qui bat de la carte du fil. Par crans de 100 ms, calés sur la même horloge : 6 à 9 %.
 * Deux choses le cassent sans bruit : une animation repassée en fluide (`linear`, `ease-in-out`),
 * ou une durée qui n'est plus un multiple du cran (les crans des atomes se décaleraient).
 */
const ICI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const lire = (relatif: string): string => readFileSync(path.join(ICI, relatif), 'utf8')

/** Le corps du PREMIER bloc dont le sélecteur est exactement `selecteur`. */
function bloc(css: string, selecteur: string): string {
  const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|\\n)${echappe}\\s*\\{([^}]*)\\}`).exec(css)
  if (!m) throw new Error(`bloc introuvable : ${selecteur}`)
  return m[1]
}

/**
 * La durée d'UN cran, en ms : durée ÷ segments ÷ crans. `segments` = nombre d'intervalles entre
 * images clés (`steps()` s'applique à chacun : 0 % → 50 % → 100 % en fait deux).
 */
function cranMs(duree: string, crans: string, segments: number): number {
  return Math.round(((parseFloat(duree) * 1000) / segments / Number(crans)) * 1000) / 1000
}

describe('animations par crans — le CSS', () => {
  const theme = lire('assets/theme.css')
  const carte = lire('components/CarteDuFil.css')

  it('les orbites des atomes avancent par crans de CRAN_MS', () => {
    const rot = bloc(theme, '.aw-atom__rot')
    const m = /animation:\s*aw-atom-spin\s+([\d.]+)s\s+steps\((\d+)\)\s+infinite/.exec(rot)
    expect(m, rot).not.toBeNull()
    expect(cranMs(m![1], m![2], 1)).toBe(CRAN_MS)

    for (const variante of ['.aw-atom__rot--2', '.aw-atom__rot--3']) {
      const b = bloc(theme, variante)
      const duree = /animation-duration:\s*([\d.]+)s/.exec(b)
      const crans = /animation-timing-function:\s*steps\((\d+)\)/.exec(b)
      expect(duree && crans, `${variante} : ${b}`).toBeTruthy()
      expect(cranMs(duree![1], crans![1], 1)).toBe(CRAN_MS)
      // Le décalage négatif doit lui aussi tomber sur la grille, sinon cette orbite a ses crans à part.
      const delai = /animation-delay:\s*(-?[\d.]+)s/.exec(b)
      // (`Math.abs` : un délai négatif rend `-0`, que `toBe(0)` distingue de `0`.)
      if (delai) expect(Math.abs(Math.round(parseFloat(delai[1]) * 1000) % CRAN_MS)).toBe(0)
    }
  })

  it("l'étoile des atomes scintille par crans de CRAN_MS (0 % → 50 % → 100 % : deux segments)", () => {
    const b = bloc(theme, '.aw-atom__star')
    const m = /animation:\s*aw-atom-tw\s+([\d.]+)s\s+steps\((\d+)\)\s+infinite/.exec(b)
    expect(m, b).not.toBeNull()
    expect(cranMs(m![1], m![2], 2)).toBe(CRAN_MS)
  })

  it('le point qui bat de la carte du fil bat par crans de CRAN_MS (deux segments)', () => {
    const b = bloc(carte, ".carte-station[data-statut='en-cours'] .carte-point")
    const m = /animation:\s*carte-bat\s+([\d.]+)s\s+steps\((\d+)\)\s+infinite/.exec(b)
    expect(m, b).not.toBeNull()
    expect(cranMs(m![1], m![2], 2)).toBe(CRAN_MS)
  })
})

/**
 * Où vit chaque animation par crans : son `@keyframes` ET la déclaration `animation:` qui la pose.
 * Étendu aux indicateurs d'avancement d'une réponse et à la pastille « question en attente »
 * (conv-1075, deuxième passe) : retirer un nom de la liste ou repasser une animation en fluide
 * rend ce test rouge.
 */
const FICHIER_DE: Record<string, string> = {
  'aw-atom-spin': 'assets/theme.css',
  'aw-atom-tw': 'assets/theme.css',
  'carte-bat': 'components/CarteDuFil.css',
  'carte-file': 'components/CarteDuFil.css',
  'etape-flux': 'components/ChatView.css',
  'etape-pouls': 'components/ChatView.css',
  'etape-reflet': 'components/ChatView.css',
  'conv-asking-list': 'components/ChatView.css',
  'conv-asking-wiggle': 'components/ChatView.css'
}

const sansCommentaires = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Les images clés d'un `@keyframes` : position (0 à 1) et déclarations normalisées, triées. */
function imagesCles(css: string, nom: string): { position: number; corps: string }[] {
  const debut = css.indexOf(`@keyframes ${nom} {`)
  if (debut < 0) throw new Error(`@keyframes ${nom} introuvable`)
  let i = css.indexOf('{', debut) + 1
  const ouverture = i
  for (let profondeur = 1; profondeur > 0; i++) {
    if (css[i] === '{') profondeur++
    else if (css[i] === '}') profondeur--
  }
  const images: { position: number; corps: string }[] = []
  for (const m of css.slice(ouverture, i - 1).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const corps = m[2].replace(/\s+/g, ' ').trim()
    for (const selecteur of m[1].split(',').map((s) => s.trim())) {
      const position =
        selecteur === 'from' ? 0 : selecteur === 'to' ? 1 : parseFloat(selecteur) / 100
      images.push({ position, corps })
    }
  }
  // Une extrémité non écrite prend la valeur de base de l'élément : jamais égale à une image écrite.
  for (const bout of [0, 1])
    if (!images.some((x) => x.position === bout))
      images.push({ position: bout, corps: '(valeur de base)' })
  return images.sort((a, b) => a.position - b.position)
}

/** Les déclarations `animation: <nom> …` d'un fichier : durée et délai (ms), nombre de crans. */
function declarations(
  css: string,
  nom: string
): { texte: string; dureeMs: number; delaiMs: number; crans: number | null }[] {
  return [...css.matchAll(new RegExp(`animation:\\s*${nom}\\s+([^;]+);`, 'g'))].map((m) => {
    const temps = [...m[1].matchAll(/(-?[\d.]+)(m?s)\b/g)].map(
      (t) => parseFloat(t[1]) * (t[2] === 's' ? 1000 : 1)
    )
    const crans = /steps\((\d+)\)/.exec(m[1])
    return {
      texte: m[0],
      dureeMs: temps[0],
      delaiMs: temps[1] ?? 0,
      crans: crans ? Number(crans[1]) : null
    }
  })
}

/**
 * Tout ce qui empêche une animation de ne changer QUE sur la grille commune de `CRAN_MS` : délai ou
 * image clé hors grille, segment animé dont le cran n'est pas `CRAN_MS`. Un segment immobile (mêmes
 * déclarations aux deux bouts) ne produit aucune image, son découpage est libre.
 */
function horsGrille(
  css: string,
  nom: string,
  dureeMs: number,
  crans: number,
  delaiMs: number
): string[] {
  const surGrille = (ms: number): boolean => Math.abs(ms - Math.round(ms / CRAN_MS) * CRAN_MS) < 0.5
  const fautes: string[] = []
  if (!surGrille(delaiMs)) fautes.push(`délai ${delaiMs} ms`)
  const images = imagesCles(css, nom)
  for (const image of images)
    if (!surGrille(image.position * dureeMs))
      fautes.push(
        `image clé ${+(image.position * 100).toFixed(4)} % = ${+(image.position * dureeMs).toFixed(2)} ms`
      )
  for (let k = 1; k < images.length; k++) {
    const [a, b] = [images[k - 1], images[k]]
    if (a.corps === b.corps) continue
    const cran = ((b.position - a.position) * dureeMs) / crans
    if (Math.abs(cran - CRAN_MS) >= 0.5)
      fautes.push(
        `segment ${+(a.position * 100).toFixed(2)} → ${+(b.position * 100).toFixed(2)} % : cran de ${+cran.toFixed(2)} ms`
      )
  }
  return fautes
}

describe('animations par crans — toutes sur la grille commune', () => {
  it('la liste des animations calées est exactement celle qui avance par crans', () => {
    expect([...ANIMATIONS_PAR_CRANS].sort()).toEqual(Object.keys(FICHIER_DE).sort())
  })

  for (const [nom, fichier] of Object.entries(FICHIER_DE)) {
    it(`${nom} (${fichier}) : chaque changement tombe sur un cran de ${CRAN_MS} ms`, () => {
      const css = sansCommentaires(lire(fichier))
      const poses = declarations(css, nom)
      expect(
        poses.length,
        `aucune déclaration « animation: ${nom} » dans ${fichier}`
      ).toBeGreaterThan(0)
      for (const pose of poses) {
        expect(pose.crans, `${pose.texte} : animation fluide, pas de steps()`).not.toBeNull()
        expect(horsGrille(css, nom, pose.dureeMs, pose.crans!, pose.delaiMs), pose.texte).toEqual(
          []
        )
      }
    })
  }

  it('le « ? » et la colonne de la pastille « question en attente » gardent le même cycle', () => {
    // Un seul cycle en deux temps (le « ? » gigote, PUIS la colonne liste ses points) : deux
    // durées différentes les désynchroniseraient dès le deuxième tour (ChatView.css).
    const css = sansCommentaires(lire('components/ChatView.css'))
    const [liste] = declarations(css, 'conv-asking-list')
    const [gigue] = declarations(css, 'conv-asking-wiggle')
    expect(liste.dureeMs).toBe(gigue.dureeMs)
  })
})

describe('animations par crans — le calage sur une horloge commune', () => {
  it("recale sur l'origine du document les seules animations nommées et listées", () => {
    const atome = { animationName: 'aw-atom-spin', startTime: 123_456.7 as number | null }
    const autre = { animationName: 'conv-asking-dots', startTime: 98_765.4 as number | null }
    expect(ANIMATIONS_PAR_CRANS.has('aw-atom-spin')).toBe(true)
    expect(calerSurLHorloge([atome, autre], 'aw-atom-spin')).toBe(1)
    expect(atome.startTime).toBe(0)
    expect(autre.startTime).toBe(98_765.4)
    // Une animation non listée n'est jamais touchée, même nommée par l'événement.
    expect(calerSurLHorloge([autre], 'conv-asking-dots')).toBe(0)
    expect(autre.startTime).toBe(98_765.4)
  })

  it('cale une animation au moment où elle démarre, et se désinstalle', () => {
    const element = document.createElement('span')
    document.body.appendChild(element)
    const animation = { animationName: 'carte-bat', startTime: 4_321.5 as number | null }
    ;(element as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [animation]
    const demarre = (): void => {
      const evenement = new Event('animationstart', { bubbles: true })
      Object.defineProperty(evenement, 'animationName', { value: 'carte-bat' })
      element.dispatchEvent(evenement)
    }

    const desinstaller = installerAnimationsParCrans(document)
    demarre()
    expect(animation.startTime).toBe(0)

    desinstaller()
    animation.startTime = 777
    demarre()
    expect(animation.startTime).toBe(777)
    element.remove()
  })

  it("cale aussi l'animation d'un pseudo-élément (le « ? » en ::before), absente de getAnimations() seul", () => {
    // Pour une animation posée sur ::before, `animationstart` vise l'élément porteur ; ses
    // animations propres (`getAnimations()`) n'incluent PAS celles du pseudo-élément — il faut
    // `{ subtree: true }`. Sans cela, le « ? » resterait hors grille, et décalé de sa colonne.
    const element = document.createElement('span')
    document.body.appendChild(element)
    const duPseudo = { animationName: 'conv-asking-wiggle', startTime: 555 as number | null }
    ;(
      element as unknown as { getAnimations: (o?: { subtree?: boolean }) => unknown[] }
    ).getAnimations = (o) => (o?.subtree ? [duPseudo] : [])
    const desinstaller = installerAnimationsParCrans(document)
    const evenement = new Event('animationstart', { bubbles: true })
    Object.defineProperty(evenement, 'animationName', { value: 'conv-asking-wiggle' })
    Object.defineProperty(evenement, 'pseudoElement', { value: '::before' })
    element.dispatchEvent(evenement)
    expect(duPseudo.startTime).toBe(0)
    desinstaller()
    element.remove()
  })
})
