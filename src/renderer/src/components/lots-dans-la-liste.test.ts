import { describe, expect, it } from 'vitest'
import { chefsAvecUnLotActif, lotsSousOnglets } from './lots-dans-la-liste'

const FILS = new Map([
  ['chef', 'Le fil chef'],
  ['l1', 'Lot 1'],
  ['l2', 'Lot 2']
])

describe('lotsSousOnglets — conv-1381', () => {
  it('masque le lot qui a son onglet et dont le chef existe', () => {
    const liens = new Map([['l1', { chef: 'chef', onglet: true }]])
    expect([...lotsSousOnglets(liens, FILS)]).toEqual(['l1'])
  })

  it('garde le lot sans onglet : un ancien plan ne se rejoint que par sa ligne', () => {
    const liens = new Map([['l1', { chef: 'chef', onglet: false }]])
    expect(lotsSousOnglets(liens, FILS).size).toBe(0)
  })

  it('garde le lot dont le chef a disparu : plus aucun onglet ne mène à lui', () => {
    const liens = new Map([['l1', { chef: 'supprime', onglet: true }]])
    expect(lotsSousOnglets(liens, FILS).size).toBe(0)
  })
})

describe('chefsAvecUnLotActif — conv-1381', () => {
  const liens = new Map([
    ['l1', { chef: 'chef-a' }],
    ['l2', { chef: 'chef-b' }]
  ])

  it('voit un lot suivi par cet écran', () => {
    const chefs = chefsAvecUnLotActif([{ id: 'l1' }, { id: 'l2' }], liens, new Set(['l1']))
    expect([...chefs]).toEqual(['chef-a'])
  })

  it('voit un lot dont le tour tourne hors de cet écran', () => {
    const chefs = chefsAvecUnLotActif(
      [{ id: 'l1' }, { id: 'l2', hasStreamingTurn: true }],
      liens,
      new Set()
    )
    expect([...chefs]).toEqual(['chef-b'])
  })

  it('n’allume aucun chef quand tous les lots sont au repos', () => {
    const chefs = chefsAvecUnLotActif([{ id: 'l1' }, { id: 'l2' }], liens, new Set())
    expect(chefs.size).toBe(0)
  })

  it('un fil hors plan qui tourne n’allume aucun chef', () => {
    const chefs = chefsAvecUnLotActif([{ id: 'x' }], liens, new Set(['x']))
    expect(chefs.size).toBe(0)
  })
})
