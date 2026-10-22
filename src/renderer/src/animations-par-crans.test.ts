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

describe('animations par crans — le calage sur une horloge commune', () => {
  it("recale sur l'origine du document les seules animations nommées et listées", () => {
    const atome = { animationName: 'aw-atom-spin', startTime: 123_456.7 as number | null }
    const autre = { animationName: 'etape-pouls', startTime: 98_765.4 as number | null }
    expect(ANIMATIONS_PAR_CRANS.has('aw-atom-spin')).toBe(true)
    expect(calerSurLHorloge([atome, autre], 'aw-atom-spin')).toBe(1)
    expect(atome.startTime).toBe(0)
    expect(autre.startTime).toBe(98_765.4)
    // Une animation non listée n'est jamais touchée, même nommée par l'événement.
    expect(calerSurLHorloge([autre], 'etape-pouls')).toBe(0)
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
})
