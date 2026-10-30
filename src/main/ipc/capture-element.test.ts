/**
 * Canal de la capture d'un élément de l'interface (Alt+clic, conv-1338).
 *
 * Mesures qui fondent ces refus (sonde Electron hors écran, conv-1338, 2026-10-30) : un rectangle de
 * largeur 0 rend PRESQUE TOUTE LA FENÊTRE (790×590) au lieu de rien, et un rectangle hors de la
 * fenêtre lève `UnknownVizError`. Sans contrôle, un clic mal mesuré joindrait donc l'écran entier.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const simule = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  gardes: [] as string[],
  refuser: false
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => simule.handlers.set(canal, fn)
  }
}))
vi.mock('../ipc-senders', () => ({
  assertTrustedRendererSender: (_event: unknown, portee: string) => {
    simule.gardes.push(portee)
    if (simule.refuser) throw new Error(`Origine renderer non autorisée pour ${portee}`)
  }
}))

import { capturerElement, registerCaptureElementIpc, rectangleDeCapture } from './capture-element'

const RECT = { x: 10, y: 20, largeur: 100, hauteur: 50 }

function fausseImage(vide = false): { isEmpty: () => boolean; toDataURL: () => string } {
  return { isEmpty: () => vide, toDataURL: () => 'data:image/png;base64,QUJD' }
}

describe('rectangleDeCapture', () => {
  it('nominal : un rectangle en pixels entiers, au format de capturePage', () => {
    expect(rectangleDeCapture({ x: 10.4, y: 20.6, largeur: 100.2, hauteur: 49.7 })).toEqual({
      x: 10,
      y: 21,
      width: 100,
      height: 50
    })
  })

  it.each([
    ['absent', undefined],
    ['nul', null],
    ['un texte', 'rect'],
    ['champ manquant', { x: 1, y: 1, largeur: 10 }],
    ['champ texte', { ...RECT, largeur: '100' }],
    ['NaN', { ...RECT, x: Number.NaN }],
    ['infini', { ...RECT, hauteur: Number.POSITIVE_INFINITY }],
    ['largeur 0', { ...RECT, largeur: 0 }],
    ['hauteur 0', { ...RECT, hauteur: 0 }],
    ['largeur négative', { ...RECT, largeur: -5 }],
    ['départ négatif', { ...RECT, x: -1 }],
    ['largeur énorme', { ...RECT, largeur: 32769 }]
  ])('refuse : %s', (_nom, valeur) => {
    expect(() => rectangleDeCapture(valeur)).toThrow(/Rectangle de capture invalide/u)
  })

  // Jumeaux acceptés, à la même borne de l'autre côté.
  it.each([
    ['départ à 0', { ...RECT, x: 0, y: 0 }],
    ['largeur de 1 pixel', { ...RECT, largeur: 1, hauteur: 1 }],
    ['largeur maximale', { ...RECT, largeur: 32768 }]
  ])('accepte : %s', (_nom, valeur) => {
    expect(() => rectangleDeCapture(valeur)).not.toThrow()
  })
})

describe('capturerElement', () => {
  it('rend l’image recadrée en adresse data, sur le rectangle demandé', async () => {
    const capturePage = vi.fn().mockResolvedValue(fausseImage())
    expect(await capturerElement({ capturePage }, RECT)).toBe('data:image/png;base64,QUJD')
    expect(capturePage).toHaveBeenCalledWith({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('un rectangle invalide ne touche jamais à la fenêtre', async () => {
    const capturePage = vi.fn()
    await expect(capturerElement({ capturePage }, { ...RECT, largeur: 0 })).rejects.toThrow(
      /Rectangle de capture invalide/u
    )
    expect(capturePage).not.toHaveBeenCalled()
  })

  it('image vide : aucune capture, sans erreur', async () => {
    const capturePage = vi.fn().mockResolvedValue(fausseImage(true))
    expect(await capturerElement({ capturePage }, RECT)).toBeNull()
  })

  // Mesuré : un rectangle hors de la fenêtre lève `UnknownVizError` (sonde conv-1338).
  it('échec du moteur d’affichage : aucune capture, le texte de la référence reste', async () => {
    const capturePage = vi.fn().mockRejectedValue(new Error('UnknownVizError'))
    expect(await capturerElement({ capturePage }, RECT)).toBeNull()
  })
})

describe('canal app:capturer-element', () => {
  beforeEach(() => {
    simule.handlers.clear()
    simule.gardes.length = 0
    simule.refuser = false
    registerCaptureElementIpc()
  })

  const appeler = (
    rect: unknown,
    capturePage = vi.fn().mockResolvedValue(fausseImage())
  ): unknown => simule.handlers.get('app:capturer-element')!({ sender: { capturePage } }, rect)

  it('passe par le contrôle d’expéditeur, puis capture la fenêtre qui demande', async () => {
    const capturePage = vi.fn().mockResolvedValue(fausseImage())
    expect(await appeler(RECT, capturePage)).toBe('data:image/png;base64,QUJD')
    expect(simule.gardes).toEqual(['Capture d’un élément'])
    expect(capturePage).toHaveBeenCalledTimes(1)
  })

  it('un expéditeur non reconnu est refusé avant toute capture', async () => {
    simule.refuser = true
    const capturePage = vi.fn()
    expect(() => appeler(RECT, capturePage)).toThrow(/Origine renderer non autorisée/u)
    expect(capturePage).not.toHaveBeenCalled()
  })

  it('un rectangle mal formé est refusé par le canal', async () => {
    await expect(appeler({ x: 'a' })).rejects.toThrow(/Rectangle de capture invalide/u)
  })
})
