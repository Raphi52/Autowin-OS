import { describe, expect, it } from 'vitest'
import { fitDetailColumnWidth, GRAPH_COLUMN_LIMITS } from './graph-column-layout'

describe('fitDetailColumnWidth', () => {
  it('autorise le panneau fichier presque jusqu au bord gauche', () => {
    expect(fitDetailColumnWidth(1800, 1600, 210)).toBe(1294)
    expect(1600 - 210 - fitDetailColumnWidth(1800, 1600, 210)).toBe(GRAPH_COLUMN_LIMITS.detailGraph)
  })

  it('conserve une largeur minimale utilisable', () => {
    expect(fitDetailColumnWidth(20, 1600)).toBe(GRAPH_COLUMN_LIMITS.detail.min)
  })
})
