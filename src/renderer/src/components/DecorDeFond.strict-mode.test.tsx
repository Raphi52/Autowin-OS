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
    const canvas = document.createElement('canvas')
    const scene: FausseScene = {
      canvas,
      render: vi.fn(),
      resize: vi.fn(),
      // Comme les vraies scènes (home-decor-scene.ts, decor-avenue-hote.ts) : libérer retire l'image.
      dispose: vi.fn(() => canvas.remove())
    }
    creees.push(scene)
    return scene
  })
}))

/** Ce que la boucle dit à la cadence à chaque battement : au repos (true) ou non (false). */
const appelsRepos: boolean[] = []
vi.mock('./decor-cadence', async (original) => {
  const vrai = await original<typeof import('./decor-cadence')>()
  return {
    ...vrai,
    creerCadence: (...args: Parameters<typeof vrai.creerCadence>) => {
      const c = vrai.creerCadence(...args)
      const repos = c.repos
      c.repos = (r: boolean) => {
        appelsRepos.push(r)
        repos(r)
      }
      return c
    }
  }
})

const { DecorDeFond } = await import('./DecorDeFond')
const { autowinStorageKey } = await import('../storage-keys')

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
  window.localStorage.removeItem(autowinStorageKey('home.decor.v3'))
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

  it('un VRAI changement de thème reconstruit une direction spatiale (teintes relues)', async () => {
    window.localStorage.setItem(autowinStorageKey('home.decor.v3'), 'actuel')
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

  it('un changement de thème NE reconstruit PAS l avenue : sa palette ne dépend pas du thème', async () => {
    // conv-337 : home-decor-avenue.ts ne lit aucune teinte du thème ; la reconstruire recompilait
    // toute la scène (2 à 3,7 s sans rue) pour une image identique.
    await monter()
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'holographique-clair')
      await Promise.resolve()
    })
    expect(creees).toHaveLength(1)
    expect(creees[0].dispose).not.toHaveBeenCalled()
  })

  it('EN VEILLE (hors de l Accueil) : la scène reste, cachée, ne dessine plus ; au retour, redessine sans être reconstruite', async () => {
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    monte = { root, hote }
    await act(async () => root.render(createElement(DecorDeFond, { actif: true })))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120))
    })
    expect(creees).toHaveLength(1)
    const scene = creees[0]
    expect(scene.render.mock.calls.length).toBeGreaterThan(0)

    await act(async () => root.render(createElement(DecorDeFond, { actif: false })))
    const fond = hote.querySelector('.decor-de-fond') as HTMLElement
    expect(fond.style.display).toBe('none')
    // la dernière image en cours peut passer ; ensuite plus rien
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60))
    })
    const enVeille = scene.render.mock.calls.length
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(scene.render.mock.calls.length).toBe(enVeille)
    expect(scene.dispose).not.toHaveBeenCalled()

    await act(async () => root.render(createElement(DecorDeFond, { actif: true })))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120))
    })
    expect(fond.style.display).toBe('')
    expect(scene.render.mock.calls.length).toBeGreaterThan(enVeille)
    expect(creees).toHaveLength(1)
  })

  it('AU REPOS quand la fenêtre perd le focus, de retour à la cadence visée quand elle le retrouve', async () => {
    // conv-337 : 34 ms de calcul par image, des heures durant, pour un Accueil qu'on ne regarde pas.
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    try {
      await monter()
      appelsRepos.length = 0
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120))
      })
      expect(appelsRepos.length).toBeGreaterThan(0)
      expect(appelsRepos.every((r) => r === true)).toBe(true)
      focus.mockReturnValue(true)
      window.dispatchEvent(new Event('focus'))
      appelsRepos.length = 0
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120))
      })
      expect(appelsRepos.length).toBeGreaterThan(0)
      expect(appelsRepos.every((r) => r === false)).toBe(true)
    } finally {
      focus.mockRestore()
    }
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

describe('le fond suit le choix fait dans les réglages de l Accueil (conv-346)', () => {
  /** Ce que fait le menu « Fond » des réglages : enregistrer, puis prévenir la fenêtre. */
  const choisir = async (fond: string): Promise<void> => {
    await act(async () => {
      window.localStorage.setItem(autowinStorageKey('home.decor.v3'), fond)
      window.dispatchEvent(new Event('autowin:fond-accueil'))
      await Promise.resolve()
    })
  }

  it('passer à Planètes reconstruit le décor sur les planètes, sans redémarrer', async () => {
    await monter()
    expect(creees).toHaveLength(1)
    const { createDecorScene } = await import('./home-decor-scene')
    expect(vi.mocked(createDecorScene).mock.calls.at(-1)?.[0]).toBe('avenue')
    await choisir('actuel')
    expect(creees).toHaveLength(2)
    expect(creees[0].dispose).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createDecorScene).mock.calls.at(-1)?.[0]).toBe('actuel')
  })

  it('Noir : aucune scène construite, l hôte peint le noir', async () => {
    window.localStorage.setItem(autowinStorageKey('home.decor.v3'), 'noir')
    const hote = await monter()
    expect(creees).toHaveLength(0)
    const fond = hote.querySelector('.decor-de-fond') as HTMLElement
    expect(fond.dataset.fond).toBe('noir')
    expect(fond.querySelector('canvas')).toBeNull()
  })

  it('passer de Cyberpunk à Noir libère la scène ; revenir la reconstruit', async () => {
    const hote = await monter()
    await choisir('noir')
    expect(creees[0].dispose).toHaveBeenCalledTimes(1)
    expect(hote.querySelector('.decor-de-fond canvas')).toBeNull()
    await choisir('avenue')
    expect(creees).toHaveLength(2)
    expect((hote.querySelector('.decor-de-fond') as HTMLElement).dataset.fond).toBeUndefined()
  })
})
