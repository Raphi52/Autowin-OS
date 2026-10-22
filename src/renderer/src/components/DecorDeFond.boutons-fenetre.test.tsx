// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LES BOUTONS DE FENÊTRE SUIVENT CE QUI EST DERRIÈRE EUX (conv-1076, 2026-10-22).
 *
 * Demande : « Sur l'Accueil avec le fond Cyberpunk ou Planètes, rends les boutons
 * réduire/agrandir/fermer clairs dans les thèmes clairs, et laisse-les foncés sur les autres vues ».
 * Windows peint ces boutons d'une seule couleur, envoyée par la page (`theme-mode.ts`). Elle n'était
 * recalculée qu'au changement de THÈME : depuis que tous les thèmes affichent la scène choisie,
 * un thème clair posait des symboles foncés sur la ville sombre de l'Accueil.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : ne plus signaler la scène depuis `DecorDeFond`, la
 * signaler aussi en veille (hors de l'Accueil) ou sur « Aucun », ou éclaircir aussi les thèmes
 * sombres, qui ont déjà leurs propres symboles clairs.
 */

vi.mock('./home-decor-scene', () => ({
  DECOR_DEFAUT: 'avenue',
  createDecorScene: vi.fn(() => {
    const canvas = document.createElement('canvas')
    return { canvas, render: vi.fn(), resize: vi.fn(), dispose: vi.fn(() => canvas.remove()) }
  })
}))

const { DecorDeFond } = await import('./DecorDeFond')
const { choisirFondAccueil, CLE_FOND_ACCUEIL } = await import('./fond-accueil')
const { appliquerThemeMode, SYMBOLE_SUR_SCENE } = await import('../theme-mode')

/** Couleurs envoyées au processus principal, dans l'ordre. */
const envoyees: string[] = []
const derniere = (): string | undefined => envoyees[envoyees.length - 1]
const g = globalThis as { api?: unknown }
let apiAvant: unknown
let monte: { root: Root; hote: HTMLElement } | null = null

/** Le jeton que chaque feuille de thème déclare (theme-modes.css, theme-nebuleuse-verre.css…). */
const poserTheme = (id: string, symbole: string): void => {
  document.documentElement.style.setProperty('--titlebar-symbol', symbole)
  appliquerThemeMode(id)
}

const rendre = async (actif: boolean): Promise<void> => {
  if (!monte) {
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    monte = { root: createRoot(hote), hote }
  }
  const { root } = monte
  await act(async () => root.render(createElement(DecorDeFond, { actif })))
}

beforeEach(() => {
  apiAvant = g.api
  g.api = { setTitlebarSymbolColor: (c: string) => (envoyees.push(c), Promise.resolve(true)) }
})

afterEach(() => {
  if (monte) {
    const { root } = monte
    act(() => root.unmount())
    monte.hote.remove()
    monte = null
  }
  g.api = apiAvant
  envoyees.length = 0
  window.localStorage.removeItem(CLE_FOND_ACCUEIL)
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-base')
  document.documentElement.style.removeProperty('--titlebar-symbol')
})

describe('couleur des boutons de fenêtre selon le fond de l Accueil', () => {
  it('thème clair : clairs sur la scène Cyberpunk, foncés dès qu on quitte l Accueil', async () => {
    poserTheme('clair', '#14192a')
    expect(derniere()).toBe('#14192a')
    choisirFondAccueil('avenue')
    await rendre(true)
    expect(derniere()).toBe(SYMBOLE_SUR_SCENE)
    await rendre(false)
    expect(derniere()).toBe('#14192a')
    await rendre(true)
    expect(derniere()).toBe(SYMBOLE_SUR_SCENE)
  })

  it('thème clair : clairs aussi sur Planètes, foncés sur « Aucun »', async () => {
    poserTheme('vanilla-claude', '#141413')
    choisirFondAccueil('actuel')
    await rendre(true)
    expect(derniere()).toBe(SYMBOLE_SUR_SCENE)
    await act(async () => choisirFondAccueil('noir'))
    expect(derniere()).toBe('#141413')
  })

  it('changer de thème SUR l Accueil garde la règle', async () => {
    poserTheme('nebuleuse-verre', '#ece8f7')
    choisirFondAccueil('avenue')
    await rendre(true)
    // Thème sombre : ses propres symboles clairs, rien n'est imposé.
    expect(derniere()).toBe('#ece8f7')
    // Le fond observe `data-theme` : le changement passe par `act`, comme un vrai rendu.
    await act(async () => {
      poserTheme('nier-automata', '#4e4b42')
      await Promise.resolve()
    })
    expect(derniere()).toBe(SYMBOLE_SUR_SCENE)
  })

  it('l Accueil démonté ne laisse pas les boutons clairs derrière lui', async () => {
    poserTheme('holographique-clair', '#1c172b')
    choisirFondAccueil('avenue')
    await rendre(true)
    expect(derniere()).toBe(SYMBOLE_SUR_SCENE)
    const { root } = monte!
    act(() => root.unmount())
    monte!.hote.remove()
    monte = null
    expect(derniere()).toBe('#1c172b')
  })
})
