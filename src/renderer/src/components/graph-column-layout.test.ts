import { describe, expect, it } from 'vitest'
import { fitNormalColumnWidths, GRAPH_COLUMN_LIMITS } from './graph-column-layout'

describe('fitNormalColumnWidths', () => {
  it('préserve la borne centrale après un partage en demi-pixels', () => {
    const fitted = fitNormalColumnWidths({ theme: 420, visibility: 500 }, 1104)

    expect(fitted.theme + fitted.visibility).toBeLessThanOrEqual(904)
    expect(1104 - fitted.theme - fitted.visibility).toBeGreaterThanOrEqual(
      GRAPH_COLUMN_LIMITS.graph
    )
  })

  it.each([1103, 1104, 1105])('respecte la borne près de la frontière à %i px', (width) => {
    const fitted = fitNormalColumnWidths({ theme: 420, visibility: 500 }, width)

    expect(width - fitted.theme - fitted.visibility).toBeGreaterThanOrEqual(
      GRAPH_COLUMN_LIMITS.graph
    )
  })

  it('ne modifie pas des largeurs qui laissent déjà assez de place', () => {
    expect(fitNormalColumnWidths({ theme: 210, visibility: 290 }, 1200)).toEqual({
      theme: 210,
      visibility: 290
    })
  })
})
