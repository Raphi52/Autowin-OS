// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * POINTER UNE IMAGE DU FILM DANS LA SAISIE, DE BOUT EN BOUT (conv-253, 2026-10-11).
 *
 * Carte vidéo du fil → « Pointer ce moment » → la référence est insérée AU CURSEUR du brouillon
 * (pas en fin, pas à la place) et l'image affichée est jointe en PNG. Le dédoublonnage des pièces
 * jointes (nom + taille, `addFiles`) fait qu'une même image pointée deux fois n'est jointe qu'une
 * fois, alors que deux images différentes donnent deux PNG.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

// L'encodage réel passe par un <canvas> de miniature : hors sujet ici.
vi.mock('./chat-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-attachments')>()
  return {
    ...original,
    encodeAttachment: vi.fn(async (file: File) => ({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: 'image' as const,
      content: 'YWJj',
      thumbnail: 'data:image/png;base64,YWJj'
    }))
  }
})

const ORIGINAL = 'D:\\Autowin\\artifacts\\video-b6-clavier\\film.mp4'

const historique = [
  { role: 'user', content: 'montre le film', ts: 1 },
  {
    role: 'assistant',
    content: '[artefact film.mp4]',
    ts: 2,
    turnId: 'tour-video',
    status: 'completed',
    parts: [
      {
        kind: 'artifact',
        artifact: {
          id: 'video-b6',
          name: 'film.mp4',
          mimeType: 'video/mp4',
          kind: 'video',
          size: 3,
          createdAt: 1,
          encoding: 'base64',
          content: 'YWJj',
          fps: 30,
          source: { provider: 'autowin', tool: 'show_video', originalPath: ORIGINAL }
        }
      }
    ]
  }
]

describe('ChatView — pointer un moment d’une vidéo du fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null

  beforeEach(() => {
    // Le brouillon survit au démontage (brouillons-persistes) : chaque cas part d'une saisie vide.
    window.localStorage.clear()
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

  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function ouvrir(): Promise<HTMLVideoElement> {
    h = await mountChat(
      chatApi({ conversations: vi.fn().mockResolvedValue([conversation('A', historique)]) })
    )
    await h.click('.conv-pick')
    const video = h.container.querySelector('[data-lecteur-video] video') as HTMLVideoElement
    expect(video).toBeTruthy()
    Object.defineProperty(video, 'duration', { configurable: true, value: 39.6 })
    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'))
      video.dispatchEvent(new Event('loadeddata'))
    })
    return video
  }

  async function aller(video: HTMLVideoElement, temps: number): Promise<void> {
    video.currentTime = temps
    await act(async () => {
      video.dispatchEvent(new Event('seeked'))
    })
  }

  async function pointer(): Promise<void> {
    const bouton = h!.container.querySelector(
      'button[aria-label="Pointer ce moment"]'
    ) as HTMLButtonElement
    expect(bouton).toBeTruthy()
    await act(async () => {
      bouton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const puces = (): string[] =>
    [...h!.container.querySelectorAll('.attachment-list.pending .attachment-chip')].map(
      (puce) => puce.textContent ?? ''
    )

  const REF_372 = `[vidéo film.mp4 · 00:12.40 · image 372/1188 · ${ORIGINAL}]`

  it('insère la référence AU CURSEUR du brouillon (abc|def → abc [réf] def) et joint le PNG', async () => {
    const video = await ouvrir()
    await h!.type('abcdef')
    h!.textarea().setSelectionRange(3, 3)
    await aller(video, 12.4)
    await pointer()
    expect(h!.textarea().value).toBe(`abc ${REF_372} def`)
    expect(puces().some((texte) => texte.includes('film-i372.png'))).toBe(true)
  })

  it('brouillon vide : la référence seule', async () => {
    const video = await ouvrir()
    await aller(video, 12.4)
    await pointer()
    expect(h!.textarea().value).toBe(REF_372)
  })

  it('même image pointée deux fois : deux références, UNE image jointe', async () => {
    const video = await ouvrir()
    await aller(video, 12.4)
    await pointer()
    await pointer()
    expect(h!.textarea().value.split(REF_372)).toHaveLength(3)
    expect(puces().filter((texte) => texte.includes('film-i372.png'))).toHaveLength(1)
  })

  it('brouillon et sélection jamais effacés : abc[de]f garde « de » sélectionné et ses pièces jointes', async () => {
    const video = await ouvrir()
    // Une pièce jointe déjà là (une autre image pointée), puis le brouillon de l'utilisateur.
    await aller(video, 13)
    await pointer()
    await h!.type('abcdef')
    h!.textarea().setSelectionRange(3, 5)
    await aller(video, 12.4)
    await pointer()
    const champ = h!.textarea()
    expect(champ.value).toBe(`abc ${REF_372} def`)
    expect(champ.value.slice(champ.selectionStart, champ.selectionEnd)).toBe('de')
    expect(puces().filter((texte) => /film-i(372|390)\.png/.test(texte))).toHaveLength(2)
  })

  it('même instant pointé deux fois SANS attendre : deux références, UNE image jointe', async () => {
    const video = await ouvrir()
    await aller(video, 12.4)
    const bouton = h!.container.querySelector(
      'button[aria-label="Pointer ce moment"]'
    ) as HTMLButtonElement
    await act(async () => {
      bouton.click()
      bouton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(h!.textarea().value.split(REF_372)).toHaveLength(3)
    expect(puces().filter((texte) => texte.includes('film-i372.png'))).toHaveLength(1)
  })

  it('deux images différentes : deux références et deux PNG', async () => {
    const video = await ouvrir()
    await aller(video, 12.4)
    await pointer()
    await aller(video, 13)
    await pointer()
    expect(h!.textarea().value).toContain('image 372/1188')
    expect(h!.textarea().value).toContain('image 390/1188')
    expect(puces().filter((texte) => /film-i(372|390)\.png/.test(texte))).toHaveLength(2)
  })
})
