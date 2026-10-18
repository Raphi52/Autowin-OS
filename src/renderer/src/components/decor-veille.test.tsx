// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DECOR_VEILLE_MS, useDecorEnVeille } from './decor-veille'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LA VEILLE DU FOND 3D (conv-337). Avant : quitter l'Accueil détruisait la scène, et chaque retour la
 * reconstruisait (2,2 à 3,7 s avant la première image, banc du décor). Ce qui doit faire échouer ce
 * fichier : un démontage IMMÉDIAT au départ de l'Accueil (le défaut d'avant), une veille sans fin
 * (la mémoire graphique jamais rendue), ou un montage avant la première visite de l'Accueil.
 */

let racine: { root: Root; hote: HTMLElement } | null = null
const releves: boolean[] = []
function Sonde({ actif }: { actif: boolean }): null {
  releves.push(useDecorEnVeille(actif))
  return null
}
const rendre = (actif: boolean): void => {
  if (!racine) {
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    racine = { root: createRoot(hote), hote }
  }
  act(() => racine!.root.render(createElement(Sonde, { actif })))
}
const dernier = (): boolean => releves[releves.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  releves.length = 0
})
afterEach(() => {
  if (racine) {
    act(() => racine!.root.unmount())
    racine.hote.remove()
    racine = null
  }
  vi.useRealTimers()
})

describe('le fond 3D en veille hors de l Accueil', () => {
  it('pas monté tant que l Accueil n a jamais été ouvert', () => {
    rendre(false)
    act(() => vi.advanceTimersByTime(DECOR_VEILLE_MS * 2))
    expect(releves.every((v) => v === false)).toBe(true)
  })

  it('quitter l Accueil le GARDE monté (veille) ; y revenir avant le délai ne le démonte jamais', () => {
    rendre(true)
    expect(dernier()).toBe(true)
    rendre(false)
    expect(dernier()).toBe(true)
    act(() => vi.advanceTimersByTime(DECOR_VEILLE_MS - 1000))
    rendre(true)
    rendre(false)
    act(() => vi.advanceTimersByTime(DECOR_VEILLE_MS - 1000))
    expect(releves.every((v) => v === true)).toBe(true)
  })

  it('libéré après le délai de veille, puis remonté au retour sur l Accueil', () => {
    rendre(true)
    rendre(false)
    act(() => vi.advanceTimersByTime(DECOR_VEILLE_MS + 10))
    expect(dernier()).toBe(false)
    rendre(true)
    expect(dernier()).toBe(true)
  })

  it('un délai de veille borné : quelques minutes, pas une session entière', () => {
    expect(DECOR_VEILLE_MS).toBeGreaterThanOrEqual(60_000)
    expect(DECOR_VEILLE_MS).toBeLessThanOrEqual(15 * 60_000)
  })
})
