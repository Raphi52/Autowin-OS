import { describe, expect, it } from 'vitest'
import { physicalDisplayLayout } from './electron-desktop-capture'

describe('physicalDisplayLayout', () => {
  it('convertit les bounds DIP en pixels physiques avec un ecran a 150 %', () => {
    expect(
      physicalDisplayLayout(
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1280, height: 720 },
          scaleFactor: 1.5
        },
        { x: 0, y: 0 }
      )
    ).toEqual({ id: 1, left: 0, top: 0, width: 1920, height: 1080 })
  })

  it('conserve une origine physique negative dans une configuration mixte', () => {
    expect(
      physicalDisplayLayout(
        {
          id: 2,
          bounds: { x: -1280, y: -160, width: 1280, height: 1024 },
          scaleFactor: 1.25
        },
        { x: -1600, y: -200 }
      )
    ).toEqual({ id: 2, left: -1600, top: -200, width: 1600, height: 1280 })
  })
})
