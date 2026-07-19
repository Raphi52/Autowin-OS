import { describe, expect, it } from 'vitest'
import {
  fitDetailColumnWidth,
  fitNormalColumnWidths,
  GRAPH_COLUMN_LIMITS
} from './graph-column-layout'

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

describe('fitDetailColumnWidth', () => {
  it('autorise le panneau fichier presque jusqu au bord gauche', () => {
    expect(fitDetailColumnWidth(1800, 1600, 210)).toBe(1294)
    expect(1600 - 210 - fitDetailColumnWidth(1800, 1600, 210)).toBe(GRAPH_COLUMN_LIMITS.detailGraph)
  })

  it('conserve une largeur minimale utilisable', () => {
    expect(fitDetailColumnWidth(20, 1600)).toBe(GRAPH_COLUMN_LIMITS.detail.min)
  })
})
