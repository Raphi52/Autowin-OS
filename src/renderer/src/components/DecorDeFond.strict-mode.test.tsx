// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LE DÉFAUT, mesuré le 2026-10-17 (conv-301, sonde de l'Accueil, pile d'appel relevée par CDP) :
 * à chaque ouverture de l'Accueil, le fond avenue était construit DEUX fois, à 0,2-0,8 s d'écart.
 * La seconde construction venait de `commitDoubleInvokeEffectsInDEV` : en développement,
 * `<StrictMode>` (main.tsx) monte chaque effet, le démonte et le remonte aussitôt. L'utilisateur
 * fait tourner Autowin EN DÉVELOPPEMENT (`.autowin-data/electron-dev/electron.exe .`) : il payait
 * donc une scène entière (contexte WebGL, ~0,5 s de construction sur le fil principal, compilation)
 * jetée aussitôt, et la rue apparaissait d'autant plus tard.
 *
 * Ce n'était PAS un changement de thème, comme je l'avais d'abord supposé : `data-theme` est posé
 * une seule fois, avant le premier rendu (main.tsx), et la sonde n'a vu aucune mutation entre les
 * deux constructions.
 *
 * L'ENTRÉE QUI CASSERAIT UN FAUX FIX : StrictMode lui-même. Sans lui, le double montage reste
 * invisible en test — d'où son emploi ici, comme dans `JarvisWidget.test.tsx`.
 */

interface FausseScene {
  canvas: HTMLCanvasElement
  render: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}
const creees: FausseScene[] = []

vi.mock('./home-decor-scene', () => ({
  DECOR_DEFAUT: 'avenue',
  tempsDecor: (t: number) => t,
  createDecorScene: vi.fn(() => {
    const scene: FausseScene = {
      canvas: document.createElement('canvas'),
      render: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn()
    }
    creees.push(scene)
    return scene
  })
}))

const { DecorDeFond } = await import('./DecorDeFond')

let monte: { root: Root; hote: HTMLElement } | null = null
const monter = async (): Promise<HTMLElement> => {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const root = createRoot(hote)
  await act(async () => root.render(createElement(StrictMode, null, createElement(DecorDeFond))))
  monte = { root, hote }
  return hote
}

afterEach(() => {
  if (monte) {
    act(() => monte!.root.unmount())
    monte.hote.remove()
    monte = null
  }
  creees.length = 0
  document.documentElement.removeAttribute('data-theme')
})

describe('le fond 3D n est construit qu une fois, même sous StrictMode', () => {
  it('UNE ouverture de l Accueil = UNE scène construite, vivante, dans la page', async () => {
    const hote = await monter()
    expect(creees).toHaveLength(1)
    expect(creees[0].dispose).not.toHaveBeenCalled()
    expect(hote.querySelector('.decor-de-fond canvas')).toBe(creees[0].canvas)
  })

  it('quitter l Accueil libère la scène', async () => {
    await monter()
    act(() => monte!.root.unmount())
    monte!.hote.remove()
    monte = null
    expect(creees).toHaveLength(1)
    expect(creees[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('un VRAI changement de thème reconstruit toujours la scène (teintes relues)', async () => {
    await monter()
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'holographique-clair')
      // l'observateur de mutations notifie en microtâche
      await Promise.resolve()
    })
    expect(creees).toHaveLength(2)
    expect(creees[0].dispose).toHaveBeenCalledTimes(1)
    expect(creees[1].dispose).not.toHaveBeenCalled()
  })

  it('démonté avant d avoir construit, il ne construit rien du tout', async () => {
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    act(() => root.render(createElement(DecorDeFond)))
    act(() => root.unmount())
    await act(async () => {
      await Promise.resolve()
    })
    hote.remove()
    expect(creees).toHaveLength(0)
  })
})
