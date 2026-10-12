import { describe, expect, it } from 'vitest'
import {
  FPS_SUPPOSE,
  fpsValide,
  formatTemps,
  imageAuTemps,
  libelleCadence,
  nomImagePointee,
  nombreDImages,
  referenceVideo,
  tempsDeLImage
} from './video-pointage'

/**
 * POINTER UNE IMAGE D'UNE VIDÉO DANS LE CHAT (conv-253, 2026-10-11 : « je pourrais te dire
 * modifie telle frame a telle seconde »). Mesures faites sur le film B6 : 30 images/s, 1188 images,
 * 39,6 s (ffprobe, code 0). Une conversion naïve `floor(t * fps)` décale 22 images sur 1188
 * (k/30 * 30 tombe juste sous k en virgule flottante, ex. l'image 123).
 */
describe('video-pointage — temps ↔ image', () => {
  it('12,40 s à 30 images/s donne l’image 372', () => {
    expect(imageAuTemps(12.4, 30, 1188)).toBe(372)
  })

  it('chaque instant k/30 du film donne exactement l’image k (les 22 cas piégeux compris)', () => {
    const decalees: number[] = []
    for (let k = 0; k < 1188; k += 1) if (imageAuTemps(k / 30, 30, 1188) !== k) decalees.push(k)
    expect(decalees).toEqual([])
  })

  it('heure d’image du navigateur arrondie à la microseconde (1.033333 = image 31, pas 30)', () => {
    // Mesuré dans Chromium (instance cachée, film B6) : après « image suivante » vers l'image 31,
    // `requestVideoFrameCallback` rend `mediaTime: 1.033333`. 1.033333 × 30 = 30,99999 : l'étiquette
    // retombait sur « image 30 » alors que la référence et le PNG joints citaient l'image 31.
    for (const fps of [30, 30000 / 1001, 60, 240]) {
      const decalees: number[] = []
      for (let k = 0; k < 1188; k += 1) {
        for (const arrondi of [Math.round, Math.floor]) {
          const mediaTime = arrondi((k / fps) * 1e6) / 1e6
          if (imageAuTemps(mediaTime, fps) !== k) decalees.push(k)
        }
      }
      expect({ fps, decalees: decalees.slice(0, 5) }).toEqual({ fps, decalees: [] })
    }
  })

  it('jumeau : juste avant le début de l’image suivante, c’est encore l’image courante', () => {
    for (const fps of [30, 240]) {
      expect(imageAuTemps(31 / fps - 1e-5, fps)).toBe(30)
      expect(imageAuTemps(32 / fps - 1e-5, fps)).toBe(31)
    }
  })

  it('la fin du film (39,6 s) donne la dernière image, 1187, pas 1188', () => {
    expect(imageAuTemps(39.6, 30, 1188)).toBe(1187)
  })

  it('reste dans les bornes avant 0 et au-delà de la fin', () => {
    expect(imageAuTemps(-3, 30, 1188)).toBe(0)
    expect(imageAuTemps(500, 30, 1188)).toBe(1187)
  })

  it('image → temps vise le MILIEU de l’image : (N + 0,5) / fps', () => {
    expect(tempsDeLImage(372, 30)).toBeCloseTo(372.5 / 30, 10)
    expect(imageAuTemps(tempsDeLImage(372, 30), 30, 1188)).toBe(372)
  })

  it('le nombre d’images se déduit de la durée', () => {
    expect(nombreDImages(39.6, 30)).toBe(1188)
    expect(nombreDImages(Number.NaN, 30)).toBeUndefined()
    expect(nombreDImages(Number.POSITIVE_INFINITY, 30)).toBeUndefined()
    expect(nombreDImages(0, 30)).toBeUndefined()
  })
})

describe('video-pointage — images/s', () => {
  it('accepte un nombre fini dans ]0 ; 240]', () => {
    expect(fpsValide(30)).toBe(30)
    expect(fpsValide(23.976)).toBe(23.976)
    expect(fpsValide(240)).toBe(240)
  })

  it('traite 0, négatif, NaN, au-delà de 240 ou du texte comme absent', () => {
    for (const invalide of [
      0,
      -30,
      Number.NaN,
      241,
      Number.POSITIVE_INFINITY,
      '30',
      null,
      undefined
    ])
      expect(fpsValide(invalide)).toBeUndefined()
  })

  it('le repli supposé est 30 images/s', () => {
    expect(FPS_SUPPOSE).toBe(30)
  })

  it('libellé de cadence : arrondi au millième, virgule décimale, sans zéros inutiles', () => {
    expect(libelleCadence(30000 / 1001)).toBe('29,97')
    expect(libelleCadence(24000 / 1001)).toBe('23,976')
    expect(libelleCadence(60000 / 1001)).toBe('59,94')
    // Jumeaux entiers : inchangés.
    expect(libelleCadence(30)).toBe('30')
    expect(libelleCadence(25)).toBe('25')
    expect(libelleCadence(240)).toBe('240')
  })
})

describe('video-pointage — référence insérée dans le message', () => {
  it('format exact : temps du DÉBUT de l’image (N / fps), image N/total, chemin d’origine', () => {
    expect(formatTemps(372 / 30)).toBe('00:12.40')
    expect(
      referenceVideo({
        nom: 'b6-clavier.mp4',
        image: 372,
        total: 1188,
        fps: 30,
        fpsSuppose: false,
        chemin: 'D:\\Autowin\\artifacts\\video-b6-clavier\\b6-clavier.mp4'
      })
    ).toBe(
      '[vidéo b6-clavier.mp4 · 00:12.40 · image 372/1188 · D:\\Autowin\\artifacts\\video-b6-clavier\\b6-clavier.mp4]'
    )
  })

  it('dit quand les images/s sont supposées, et quand le total est inconnu', () => {
    expect(
      referenceVideo({
        nom: 'clip.webm',
        image: 45,
        fps: 30,
        fpsSuppose: true,
        chemin: 'clip.webm'
      })
    ).toBe('[vidéo clip.webm · 00:01.50 · image 45 · 30 i/s supposé · clip.webm]')
  })

  it('formate les minutes au-delà de 60 s et ne rend jamais 60 centièmes', () => {
    expect(formatTemps(0)).toBe('00:00.00')
    expect(formatTemps(75.5)).toBe('01:15.50')
    expect(formatTemps(59.999)).toBe('01:00.00')
    expect(formatTemps(-1)).toBe('00:00.00')
  })

  it('nomme l’image jointe d’après la vidéo et le numéro d’image', () => {
    expect(nomImagePointee('b6-clavier.mp4', 372)).toBe('b6-clavier-i372.png')
    expect(nomImagePointee('sans-extension', 7)).toBe('sans-extension-i7.png')
  })
})
