// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LA PLAINTE (2026-10-19, conv-1018) : « sur ce pc le fond d'écran 3d de l'accueil défile super
 * lentement ». Cause mesurée sur ce PC : les « Effets d'animation » de Windows y sont coupés
 * (`SPI_GETCLIENTAREAANIMATION` = False), Chromium le traduit en `prefers-reduced-motion: reduce`,
 * et `DecorDeFond` multipliait alors le temps du décor par 0,25 — l'avenue avançait 4 fois moins vite.
 *
 * DÉCISION DE L'UTILISATEUR, même jour : le fond tourne à vitesse NORMALE, quel que soit ce réglage.
 *
 * L'ENTRÉE QUI CASSE UN FAUX FIX : la préférence ACTIVE. Sans elle, l'ancien code passait déjà le
 * temps intact et ce test serait vert en ne prouvant rien.
 */

interface FausseScene {
  canvas: HTMLCanvasElement
  /** Chaque image : le temps reçu par la scène, et l'horloge réelle au même instant (s). */
  images: Array<{ temps: number; horloge: number }>
  render: (temps: number) => void
  resize: () => void
  dispose: () => void
}
const creees: FausseScene[] = []

// Le VRAI module, sauf la construction WebGL (absente sous happy-dom) : tout ce que `DecorDeFond`
// en emploie pour fabriquer le temps reste le code livré.
vi.mock('./home-decor-scene', async (original) => ({
  ...(await original<typeof import('./home-decor-scene')>()),
  createDecorScene: () => {
    const scene: FausseScene = {
      canvas: document.createElement('canvas'),
      images: [],
      render(temps: number) {
        scene.images.push({ temps, horloge: performance.now() / 1000 })
      },
      resize: vi.fn(),
      dispose: vi.fn()
    }
    creees.push(scene)
    return scene
  }
}))

const { DecorDeFond } = await import('./DecorDeFond')

let monte: { root: Root; hote: HTMLElement } | null = null

afterEach(() => {
  if (monte) {
    act(() => monte!.root.unmount())
    monte.hote.remove()
    monte = null
  }
  creees.length = 0
  vi.restoreAllMocks()
})

describe('le fond d accueil défile à vitesse normale, même quand Windows coupe les animations', () => {
  it('sous prefers-reduced-motion: reduce, le temps de la scène avance comme l horloge réelle', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (requete: string) =>
        ({
          matches: requete.includes('prefers-reduced-motion: reduce'),
          media: requete,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: () => false
        }) as unknown as MediaQueryList
    )
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    monte = { root, hote }
    await act(async () => root.render(createElement(DecorDeFond, { actif: true })))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500))
    })

    expect(creees).toHaveLength(1)
    const images = creees[0].images
    expect(images.length).toBeGreaterThan(3)
    const premiere = images[0]
    const derniere = images[images.length - 1]
    const ecoule = derniere.horloge - premiere.horloge
    expect(ecoule).toBeGreaterThan(0.2)
    // 1 = vitesse normale ; l'ancien ralenti donnait 0,25.
    expect((derniere.temps - premiere.temps) / ecoule).toBeGreaterThan(0.9)
  })
})
