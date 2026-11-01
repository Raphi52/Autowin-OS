import { describe, expect, it } from 'vitest'
import type { Conv } from './chat-view-types'
import { activiteDesLots, etatDuFil, lotsSousOnglets } from './lots-dans-la-liste'

const FILS = new Map([
  ['chef', 'Le fil chef'],
  ['l1', 'Lot 1'],
  ['l2', 'Lot 2']
])

/** Un fil au repos : son dernier tour est fini, rien n'attend. */
const fil = (id: string, surcharge: Partial<Conv> = {}): Conv =>
  ({
    id,
    title: id,
    messages: [],
    messageCount: 2,
    lastMessageRole: 'assistant',
    lastAssistantStatus: 'completed',
    ...surcharge
  }) as Conv

describe('lotsSousOnglets — conv-1381', () => {
  it('masque le lot qui a son onglet et dont le chef existe', () => {
    const liens = new Map([['l1', { chef: 'chef', onglet: true }]])
    expect([...lotsSousOnglets(liens, FILS)]).toEqual(['l1'])
  })

  it('masque aussi le lot d’un ancien plan : le bloc du chef y mène (conv-1394)', () => {
    const liens = new Map([['l1', { chef: 'chef', onglet: false }]])
    expect([...lotsSousOnglets(liens, FILS)]).toEqual(['l1'])
  })

  it('garde le lot dont le chef a disparu : plus aucun onglet ne mène à lui', () => {
    const liens = new Map([['l1', { chef: 'supprime', onglet: true }]])
    expect(lotsSousOnglets(liens, FILS).size).toBe(0)
  })
})

describe('activiteDesLots — conv-1381', () => {
  const liens = new Map([
    ['l1', { chef: 'chef-a' }],
    ['l2', { chef: 'chef-b' }]
  ])

  it('voit un lot suivi par cet écran', () => {
    const { chefsActifs } = activiteDesLots([fil('l1'), fil('l2')], liens, new Set(['l1']))
    expect([...chefsActifs]).toEqual(['chef-a'])
  })

  it('voit un lot dont le tour tourne hors de cet écran', () => {
    const { chefsActifs } = activiteDesLots(
      [fil('l1'), fil('l2', { hasStreamingTurn: true })],
      liens,
      new Set()
    )
    expect([...chefsActifs]).toEqual(['chef-b'])
  })

  it('n’allume aucun chef quand tous les lots sont au repos', () => {
    const activite = activiteDesLots([fil('l1'), fil('l2')], liens, new Set())
    expect(activite.chefsActifs.size).toBe(0)
    expect(activite.chefsEnQuestion.size).toBe(0)
    expect(activite.lotsEnQuestion.size).toBe(0)
  })

  it('un fil hors plan n’allume aucun chef, même s’il tourne ou questionne', () => {
    const activite = activiteDesLots(
      [fil('x', { lastAssistantAsksUser: true })],
      liens,
      new Set(['x'])
    )
    expect(activite.chefsActifs.size).toBe(0)
    expect(activite.chefsEnQuestion.size).toBe(0)
  })

  it('une question de lot se reporte sur son chef et sur le lot', () => {
    const activite = activiteDesLots(
      [fil('l1', { lastAssistantAsksUser: true }), fil('l2')],
      liens,
      new Set()
    )
    expect([...activite.chefsEnQuestion]).toEqual(['chef-a'])
    expect([...activite.lotsEnQuestion]).toEqual(['l1'])
  })

  // Entrées qui feraient échouer une correction trop large : même règle que la ligne du fil.
  it('une question périmée ne compte pas : le lot a repris, ou tu as déjà répondu', () => {
    const repris = activiteDesLots(
      [fil('l1', { lastAssistantAsksUser: true })],
      liens,
      new Set(['l1'])
    )
    expect(repris.lotsEnQuestion.size).toBe(0)
    const repondu = activiteDesLots(
      [fil('l1', { lastAssistantAsksUser: true, lastMessageRole: 'user' })],
      liens,
      new Set()
    )
    expect(repondu.lotsEnQuestion.size).toBe(0)
  })
})

describe('etatDuFil — conv-1381', () => {
  it('rend sur le chef la même animation qu’une question à lui', () => {
    expect(etatDuFil(fil('chef'), false, false, true).key).toBe(
      etatDuFil(fil('chef', { lastAssistantAsksUser: true }), false, false).key
    )
  })

  it('la question d’un lot passe devant le spinner du chef, et dit qu’elle vient d’un lot', () => {
    const etat = etatDuFil(fil('chef'), true, false, true)
    expect(etat.key).toBe('asking')
    expect(etat.detail).toMatch(/lot/i)
    expect(etatDuFil(fil('chef'), true, false).key).toBe('running')
  })
})
