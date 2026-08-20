import { describe, expect, it } from 'vitest'
import { parseDisplayArg } from './commands'
import { WindowsDesktopController } from './desktop-control'
import type { DesktopObservation } from './desktop-control'

const observation = (display?: number): DesktopObservation => ({
  data: {
    width: 1920,
    height: 1080,
    sourceWidth: 1920,
    sourceHeight: 1080,
    originX: 0,
    originY: 0,
    mimeType: 'image/jpeg',
    scope: 'desktop',
    displays: 3,
    ...(display === undefined ? {} : { display })
  },
  attachment: {
    name: 'desktop-current.jpg',
    mimeType: 'image/jpeg',
    size: 4,
    kind: 'image',
    content: Buffer.from([1, 2, 3, 4]).toString('base64')
  }
})

describe('parseDisplayArg', () => {
  it('rend undefined pour une absence d argument', () => {
    expect(parseDisplayArg(undefined)).toBeUndefined()
    expect(parseDisplayArg(null)).toBeUndefined()
    expect(parseDisplayArg('')).toBeUndefined()
  })

  it('accepte un entier et sa forme chaine', () => {
    expect(parseDisplayArg(2)).toBe(2)
    expect(parseDisplayArg(' 3 ')).toBe(3)
  })

  it('refuse zero, negatif, decimal et non-numerique', () => {
    for (const bad of [0, -1, 1.5, 'gauche', {}, true]) {
      expect(() => parseDisplayArg(bad)).toThrow('display invalide')
    }
  })
})

describe('WindowsDesktopController.observe', () => {
  it('transmet le display demande a la capture', async () => {
    const seen: unknown[] = []
    const controller = new WindowsDesktopController({
      platform: 'win32',
      capture: async (options) => {
        seen.push(options)
        return observation(2)
      }
    })
    const result = await controller.observe({ display: 2 })
    expect(seen).toEqual([{ display: 2 }])
    expect(result.data.display).toBe(2)
    expect(result.data.displays).toBe(3)
  })

  it('reste sur le bureau complet sans display', async () => {
    const seen: unknown[] = []
    const controller = new WindowsDesktopController({
      platform: 'win32',
      capture: async (options) => {
        seen.push(options)
        return observation()
      }
    })
    const result = await controller.observe()
    expect(seen).toEqual([{ display: undefined }])
    expect(result.data.display).toBeUndefined()
  })
})
