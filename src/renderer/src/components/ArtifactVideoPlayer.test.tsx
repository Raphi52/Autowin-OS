// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatArtifact } from '../../../shared/artifacts'
import { ArtifactPreview } from './ArtifactPreview'
import { PointerMomentVideo, type MomentPointe } from './video-pointage-context'

/**
 * LE LECTEUR VIDÉO DU FIL, IMAGE PAR IMAGE (conv-253, 2026-10-11 : « je pourrais te dire modifie
 * telle frame a telle seconde »). Avant : un `<video controls>` nu, précis à la seconde, sans
 * numéro d'image ni lien avec la saisie.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER une mauvaise correction : la carte conservée par le fil porte un
 * `path` de COPIE (`.autowin-data/chat-artifacts/…`) ; la référence doit citer
 * `source.originalPath`, le film que l'agent peut modifier.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const ORIGINAL = 'D:\\Autowin\\artifacts\\video-b6-clavier\\film.mp4'
const COPIE = 'D:\\Autowin\\.autowin-data\\chat-artifacts\\conv-253\\tour\\artifact-x.mp4'

function carte(overrides: Partial<ChatArtifact> = {}): ChatArtifact {
  return {
    id: 'video-b6',
    name: 'film.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    size: 3,
    createdAt: 1,
    encoding: 'base64',
    content: 'YWJj',
    path: COPIE,
    fps: 30,
    source: { provider: 'autowin', tool: 'show_video', originalPath: ORIGINAL },
    ...overrides
  }
}

// fix-ok: conv-253 — causes re-prouvées en remettant l'ancien code dans ArtifactVideoPlayer.tsx,
// chaque fois rouge (code 1) puis vert : libellé `${fps} i/s` brut (« 29.97002997002997 i/s ») ;
// `immobile` absent (vidéo d'une image : 2 tests) ; `pret` toujours vrai (avant `loadeddata` et
// pendant `seeking` : 2 tests).
describe('ArtifactVideoPlayer', () => {
  let container: HTMLDivElement
  let root: Root
  let moments: MomentPointe[]

  beforeEach(() => {
    moments = []
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1920
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 1080
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage: vi.fn() }) as never
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['png-image'], { type: 'image/png' }))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  function rendre(
    artifact: ChatArtifact,
    avecPointeur = true,
    { duree = 39.6, charger = true }: { duree?: number; charger?: boolean } = {}
  ): HTMLVideoElement {
    const preview = createElement(ArtifactPreview, {
      artifact,
      conversationId: 'conv-253',
      turnId: 'tour'
    })
    act(() => {
      root.render(
        avecPointeur
          ? createElement(
              PointerMomentVideo.Provider,
              { value: (moment: MomentPointe) => moments.push(moment) },
              preview
            )
          : preview
      )
    })
    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: duree })
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'))
      // `loadeddata` = la première image est décodée : c'est elle qui rend « Pointer » actif.
      if (charger) video.dispatchEvent(new Event('loadeddata'))
    })
    return video
  }

  const etat = (): string =>
    container.querySelector('[data-lecteur-etat]')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const bouton = (nom: string): HTMLButtonElement =>
    container.querySelector(`button[aria-label="${nom}"]`) as HTMLButtonElement
  const lecteur = (): HTMLElement => container.querySelector('[data-lecteur-video]') as HTMLElement

  async function aller(video: HTMLVideoElement, temps: number): Promise<void> {
    video.currentTime = temps
    await act(async () => {
      video.dispatchEvent(new Event('seeked'))
    })
  }

  async function touche(key: string, shiftKey = false): Promise<void> {
    await act(async () => {
      lecteur().dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
    })
  }

  async function pointer(): Promise<void> {
    await act(async () => {
      bouton('Pointer ce moment').click()
      await Promise.resolve()
    })
  }

  /*
   * VIDÉO DE PLUS DE 16 Mo = LUE PAR `autowin-media://` (cd9a7fe9, kaizen conv-260), une AUTRE
   * origine que la fenêtre. Sans `crossorigin`, Chromium la charge sans CORS : le canevas où
   * « Pointer ce moment » dessine l'image est contaminé et `toBlob` lève une SecurityError, malgré
   * l'en-tête `Access-Control-Allow-Origin` du serveur. La pub de 71 Mo de conv-260 aurait eu un
   * lecteur, mais aucune image pointable.
   */
  it('vidéo lue par plages (autowin-media://) : demandée en CORS, l’image reste copiable', () => {
    const video = rendre(carte({ content: undefined, encoding: undefined, size: 74_601_555 }))
    expect(video.getAttribute('src')).toMatch(/^autowin-media:\/\//)
    expect(video.getAttribute('crossorigin')).toBe('anonymous')
  })

  it('garde les contrôles natifs et affiche le temps, l’image et les images/s', () => {
    rendre(carte())
    expect(container.querySelector('video[controls]')).not.toBeNull()
    expect(etat()).toContain('00:00.00')
    expect(etat()).toContain('image 0/1188')
    expect(etat()).toContain('30 i/s')
  })

  it('cadence NTSC mesurée par ffprobe (30000/1001) : « 29,97 i/s », jamais « 29.97002997002997 »', () => {
    rendre(carte({ fps: 30000 / 1001 }))
    expect(etat()).toContain('29,97 i/s')
    expect(etat()).not.toContain('29.970')
  })

  it('« +1 image » avance d’une image (1/30 s), « −1 image » recule', async () => {
    const video = rendre(carte())
    await act(async () => bouton('Image suivante').click())
    expect(video.currentTime).toBeCloseTo(1.5 / 30, 10)
    expect(etat()).toContain('image 1/1188')
    expect(etat()).toContain('00:00.03')
    await act(async () => bouton('Image précédente').click())
    expect(etat()).toContain('image 0/1188')
  })

  it('les flèches pilotent le lecteur quand il a le focus : ±1 image, Maj = ±1 s', async () => {
    rendre(carte())
    await touche('ArrowRight')
    expect(etat()).toContain('image 1/1188')
    await touche('ArrowRight', true)
    expect(etat()).toContain('image 31/1188')
    await touche('ArrowLeft')
    expect(etat()).toContain('image 30/1188')
    await touche('ArrowLeft', true)
    expect(etat()).toContain('image 0/1188')
  })

  it('reste sur la première image avant 0 et sur la dernière (1187) au-delà de la fin', async () => {
    const video = rendre(carte())
    await touche('ArrowLeft')
    expect(etat()).toContain('image 0/1188')
    await aller(video, 39.6)
    expect(etat()).toContain('image 1187/1188')
    await touche('ArrowRight')
    expect(etat()).toContain('image 1187/1188')
    // La POSITION aussi reste sur la dernière image : l'affichage est borné de toute façon, il ne
    // suffit pas à prouver la butée.
    expect(video.currentTime).toBeCloseTo(1187.5 / 30, 6)
    await act(async () => bouton('Avancer d’une seconde').click())
    expect(video.currentTime).toBeCloseTo(1187.5 / 30, 6)
    // Image 15 : reculer d'une seconde (30 images) s'arrête sur l'image 0, et y reste.
    await aller(video, 0.5)
    expect(etat()).toContain('image 15/1188')
    await act(async () => bouton('Reculer d’une seconde').click())
    expect(video.currentTime).toBeCloseTo(0.5 / 30, 6)
    await act(async () => bouton('Image précédente').click())
    expect(video.currentTime).toBeCloseTo(0.5 / 30, 6)
    expect(etat()).toContain('image 0/1188')
  })

  it('« Pointer ce moment » envoie la référence exacte (chemin d’ORIGINE) et le PNG de l’image', async () => {
    const video = rendre(carte())
    await aller(video, 12.4)
    await pointer()
    expect(moments).toHaveLength(1)
    expect(moments[0].reference).toBe(`[vidéo film.mp4 · 00:12.40 · image 372/1188 · ${ORIGINAL}]`)
    expect(moments[0].reference).not.toContain(COPIE)
    expect(moments[0].image?.name).toBe('film-i372.png')
    expect(moments[0].image?.type).toBe('image/png')
  })

  it('pointer pendant la lecture met d’abord en pause', async () => {
    const video = rendre(carte())
    await act(async () => {
      await video.play()
    })
    expect(video.paused).toBe(false)
    await pointer()
    expect(video.paused).toBe(true)
    expect(moments).toHaveLength(1)
  })

  it('même image pointée deux fois : deux références, deux PNG identiques (même nom, même taille)', async () => {
    const video = rendre(carte())
    await aller(video, 12.4)
    await pointer()
    await pointer()
    expect(moments.map((m) => m.reference)).toHaveLength(2)
    expect(moments[0].image?.name).toBe(moments[1].image?.name)
    expect(moments[0].image?.size).toBe(moments[1].image?.size)
  })

  it('deux images différentes : deux PNG de noms différents', async () => {
    const video = rendre(carte())
    await aller(video, 12.4)
    await pointer()
    await touche('ArrowRight')
    await pointer()
    expect(moments.map((m) => m.image?.name)).toEqual(['film-i372.png', 'film-i373.png'])
  })

  it('images/s absentes : « 30 supposé » est affiché et écrit dans la référence', async () => {
    const video = rendre(carte({ fps: undefined }))
    expect(etat()).toContain('images/s inconnues · 30 supposé')
    await aller(video, 1.5)
    await pointer()
    expect(moments[0].reference).toContain('30 i/s supposé')
  })

  it('« Pointer ce moment » est inactif tant que la première image n’est pas chargée', async () => {
    const video = rendre(carte(), true, { charger: false })
    expect(bouton('Pointer ce moment').disabled).toBe(true)
    await pointer()
    expect(moments).toHaveLength(0)
    // Jumeau : l'image chargée, le même clic pointe.
    await act(async () => {
      video.dispatchEvent(new Event('loadeddata'))
    })
    expect(bouton('Pointer ce moment').disabled).toBe(false)
    await pointer()
    expect(moments).toHaveLength(1)
  })

  it('« Pointer ce moment » est inactif pendant un déplacement (seeking → seeked)', async () => {
    const video = rendre(carte())
    expect(bouton('Pointer ce moment').disabled).toBe(false)
    await act(async () => {
      video.dispatchEvent(new Event('seeking'))
    })
    expect(bouton('Pointer ce moment').disabled).toBe(true)
    await pointer()
    expect(moments).toHaveLength(0)
    await aller(video, 12.4)
    expect(bouton('Pointer ce moment').disabled).toBe(false)
  })

  it('vidéo d’une seule image : les 4 boutons de déplacement sont inactifs, les flèches sans effet', async () => {
    const video = rendre(carte({ images: 1 }), true, { duree: Number.NaN })
    expect(etat()).toContain('image 0/1')
    for (const nom of [
      'Reculer d’une seconde',
      'Image précédente',
      'Image suivante',
      'Avancer d’une seconde'
    ])
      expect(bouton(nom).disabled).toBe(true)
    video.currentTime = 0.01
    await touche('ArrowRight')
    await touche('ArrowLeft', true)
    expect(video.currentTime).toBe(0.01)
    expect(etat()).toContain('image 0/1')
    // Pointer reste possible : c'est l'image elle-même qu'on désigne.
    expect(bouton('Pointer ce moment').disabled).toBe(false)
  })

  it('une seule image connue par la seule durée (ffprobe en échec) : boutons inactifs aussi', () => {
    rendre(carte({ fps: undefined }), true, { duree: 1 / 30 })
    expect(etat()).toContain('image 0/1')
    expect(bouton('Image suivante').disabled).toBe(true)
  })

  it('jumeau : deux images, les boutons de déplacement restent actifs', () => {
    rendre(carte({ images: 2 }), true, { duree: 2 / 30 })
    expect(bouton('Image suivante').disabled).toBe(false)
    expect(bouton('Image précédente').disabled).toBe(false)
  })

  it('le nombre d’images mesuré par ffprobe prime sur la durée du navigateur', () => {
    rendre(carte({ images: 1188 }), true, { duree: Number.NaN })
    expect(etat()).toContain('image 0/1188')
  })

  describe('vidéo de plus de 16 Mo (aperçu refusé par le processus principal)', () => {
    const observateur = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
    const api = Object.getOwnPropertyDescriptor(window, 'api')

    afterEach(() => {
      if (observateur) Object.defineProperty(globalThis, 'IntersectionObserver', observateur)
      if (api) Object.defineProperty(window, 'api', api)
      else Reflect.deleteProperty(window, 'api')
    })

    async function rendreConservee(
      lecture: Record<string, unknown>
    ): Promise<{ reveler: ReturnType<typeof vi.fn> }> {
      // Sans observateur, la carte se charge tout de suite (pas d'attente « à l'approche »).
      Object.defineProperty(globalThis, 'IntersectionObserver', {
        configurable: true,
        value: undefined
      })
      const reveler = vi.fn(async () => undefined)
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { readChatArtifact: vi.fn(async () => lecture), revealChatArtifact: reveler }
      })
      await act(async () => {
        root.render(
          createElement(
            PointerMomentVideo.Provider,
            { value: (moment: MomentPointe) => moments.push(moment) },
            createElement(ArtifactPreview, {
              artifact: carte({ content: undefined, encoding: undefined, size: 17 * 1024 * 1024 }),
              conversationId: 'conv-253',
              turnId: 'tour'
            })
          )
        )
      })
      await act(async () => {})
      return { reveler }
    }

    /*
     * Ancien cas limite (« plus de 16 Mo = message + Afficher le fichier, sans lecteur ») retiré par
     * cd9a7fe9 (kaizen conv-260 : « tu dois me la montrer dans un lecteur » pour une pub de 74,6 Mo).
     * Une vidéo CONSERVÉE se lit désormais par plages : lecteur présent, aucune copie base64.
     */
    it('plus de 16 Mo conservée : lecteur par plages, sans copie base64 ; « Afficher le fichier » reste', async () => {
      const { reveler } = await rendreConservee({ ok: false, error: 'Aperçu limité à 16 Mo' })
      const api = (window as unknown as { api: { readChatArtifact: ReturnType<typeof vi.fn> } }).api
      expect(api.readChatArtifact).not.toHaveBeenCalled()
      expect(container.querySelector('[data-lecteur-video]')).not.toBeNull()
      expect(container.querySelector('video')?.getAttribute('src')).toMatch(/^autowin-media:\/\//)
      expect(container.querySelector('.artifact-preview__blocked')).toBeNull()
      const afficher = [...container.querySelectorAll('button')].find(
        (element) => element.textContent === 'Afficher le fichier'
      )
      expect(afficher).toBeTruthy()
      await act(async () => afficher!.click())
      expect(reveler).toHaveBeenCalledWith('conv-253', 'tour', 'video-b6')
    })

    it('jumeau : aperçu servi, le lecteur s’affiche', async () => {
      await rendreConservee({ ok: true, encoding: 'base64', content: 'YWJj' })
      expect(container.querySelector('[data-lecteur-video]')).not.toBeNull()
      expect(container.querySelector('.artifact-preview__blocked')).toBeNull()
    })
  })

  it('sans zone de saisie reliée, pas de bouton « Pointer ce moment »', () => {
    rendre(carte(), false)
    expect(bouton('Pointer ce moment')).toBeNull()
    expect(bouton('Image suivante')).not.toBeNull()
  })
})
