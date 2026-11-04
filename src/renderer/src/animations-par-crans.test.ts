// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANIMATIONS_PAR_CRANS,
  calerSurLHorloge,
  installerAnimationsParCrans
} from './animations-par-crans'

/**
 * Plafond de 10 images/s levé le 2026-11-04 (conv-1512, « remove the 10 fps cap everywhere ») : les
 * animations de mouvement sont fluides. Seuls clignotent encore par `steps(1)` / `steps(2)` le curseur
 * de l'accueil et la pastille « question en attente », calés ensemble sur l'horloge du document.
 */
const ICI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const lire = (relatif: string): string => readFileSync(path.join(ICI, relatif), 'utf8')
const FICHIERS = [
  'assets/theme.css',
  'assets/theme-nebuleuse-verre.css',
  'assets/theme-holographique-clair.css',
  'components/AnimationAccueilChat.css',
  'components/ChatView.css',
  'components/SuperConvMosaique.css'
]
const sansCommentaires = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('animations fluides — plus de plafond à 10 images/s', () => {
  it.each(FICHIERS)('%s : aucun mouvement découpé en crans (steps(3) et plus)', (fichier) => {
    const crans = [...sansCommentaires(lire(fichier)).matchAll(/steps\((\d+)\)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 2)
    expect(crans).toEqual([])
  })

  it('seules les animations qui clignotent restent calées sur la grille commune', () => {
    expect([...ANIMATIONS_PAR_CRANS].sort()).toEqual([
      'aa-barre',
      'conv-asking-list',
      'conv-asking-wiggle'
    ])
  })
})

describe('animations par crans — le calage sur une horloge commune', () => {
  it("recale sur l'origine du document les seules animations nommées et listées", () => {
    const atome = { animationName: 'aa-barre', startTime: 123_456.7 as number | null }
    const autre = { animationName: 'conv-asking-dots', startTime: 98_765.4 as number | null }
    expect(ANIMATIONS_PAR_CRANS.has('aa-barre')).toBe(true)
    expect(calerSurLHorloge([atome, autre], 'aa-barre')).toBe(1)
    expect(atome.startTime).toBe(0)
    expect(autre.startTime).toBe(98_765.4)
    // Une animation non listée n'est jamais touchée, même nommée par l'événement.
    expect(calerSurLHorloge([autre], 'conv-asking-dots')).toBe(0)
    expect(autre.startTime).toBe(98_765.4)
  })

  it('cale une animation au moment où elle démarre, et se désinstalle', () => {
    const element = document.createElement('span')
    document.body.appendChild(element)
    const animation = { animationName: 'conv-asking-list', startTime: 4_321.5 as number | null }
    ;(element as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [animation]
    const demarre = (): void => {
      const evenement = new Event('animationstart', { bubbles: true })
      Object.defineProperty(evenement, 'animationName', { value: 'conv-asking-list' })
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
