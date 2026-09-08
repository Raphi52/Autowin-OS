import { describe, expect, it, vi } from 'vitest'
import { CLE_SONDE_GRAPHE, exposerSondeGraphe, type SondeGraphe } from './graph-sonde'

function sondeFactice(): SondeGraphe {
  return {
    noeuds: () => [{ id: 'knowledge/a', label: 'A' }],
    positionEcran: (id) => (id === 'knowledge/a' ? { x: 12, y: 34 } : null),
    ouvrir: vi.fn(() => true)
  }
}

describe('poignee de pilotage du graphe', () => {
  it('pose la poignee en developpement et la retire proprement', () => {
    const cible: Record<string, unknown> = {}
    const retirer = exposerSondeGraphe(sondeFactice(), cible, true)

    expect(cible[CLE_SONDE_GRAPHE]).toBeDefined()
    retirer()
    expect(CLE_SONDE_GRAPHE in cible).toBe(false)
  })

  it('NE POSE RIEN hors developpement : aucune prise depuis une page', () => {
    const cible: Record<string, unknown> = {}
    exposerSondeGraphe(sondeFactice(), cible, false)
    expect(CLE_SONDE_GRAPHE in cible).toBe(false)
  })

  it('rend la position ecran d un noeud rendu, et null pour un inconnu', () => {
    const cible: Record<string, unknown> = {}
    exposerSondeGraphe(sondeFactice(), cible, true)
    const sonde = cible[CLE_SONDE_GRAPHE] as SondeGraphe

    expect(sonde.noeuds()).toEqual([{ id: 'knowledge/a', label: 'A' }])
    expect(sonde.positionEcran('knowledge/a')).toEqual({ x: 12, y: 34 })
    expect(sonde.positionEcran('knowledge/inconnu')).toBeNull()
  })
})
