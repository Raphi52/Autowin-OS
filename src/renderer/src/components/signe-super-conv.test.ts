import { describe, expect, it } from 'vitest'
import type { Conv } from './chat-view-types'
import { lireSigneSuperConv, signesDesSuperConvs } from './signe-super-conv'

// conv-1395 : le signe « Raccourci » d'une super conv dans la liste de gauche.
const fil = (id: string, etat: Partial<Conv> = {}): Conv => ({
  id,
  title: id,
  provider: 'claude',
  updatedAt: 0,
  messageCount: 2,
  lastMessageRole: 'assistant',
  lastAssistantStatus: 'completed',
  ...etat
})

const lien = (chef: string, rang: number, total: number, onglet = true) => ({
  chef,
  rang,
  total,
  onglet
})

describe('signesDesSuperConvs', () => {
  it('un segment par lot du plan montré, par rang ; un lot sans fil est à faire', () => {
    const convs = [
      fil('chef'),
      fil('l1'),
      fil('l2', { lastAssistantStatus: 'failed' }),
      fil('l3'),
      fil('l4', { lastAssistantAsksUser: true })
    ]
    const liens = new Map([
      ['l3', lien('chef', 3, 6)],
      ['l1', lien('chef', 1, 6)],
      ['l2', lien('chef', 2, 6)],
      ['l4', lien('chef', 5, 6)]
    ])
    const signes = signesDesSuperConvs(convs, liens, new Set(['l3']))
    expect(signes.get('chef')).toBe('fecxqx|5|l4')
    expect(lireSigneSuperConv(signes.get('chef') ?? '')).toEqual({
      segments: ['fini', 'echec', 'cours', 'afaire', 'question', 'afaire'],
      finis: 1,
      total: 6,
      question: { rang: 5, fil: 'l4' }
    })
  })

  it('le raccourci vise la PREMIÈRE question par rang', () => {
    const convs = [fil('a', { lastAssistantAsksUser: true }), fil('b', { lastAssistantAsksUser: true })]
    const liens = new Map([
      ['b', lien('chef', 4, 4)],
      ['a', lien('chef', 2, 4)]
    ])
    expect(signesDesSuperConvs(convs, liens, new Set()).get('chef')).toBe('xqxq|2|a')
  })

  it('les lots des anciens plans ne comptent pas, mais le chef garde son signe (pile seule)', () => {
    const liens = new Map([['vieux', lien('chef', 1, 3, false)]])
    const signes = signesDesSuperConvs([fil('vieux')], liens, new Set())
    expect(signes.get('chef')).toBe('')
    expect(lireSigneSuperConv('')).toEqual({ segments: [], finis: 0, total: 0 })
  })

  it('un fil hors plan n’a pas de signe', () => {
    const signes = signesDesSuperConvs([fil('seul')], new Map(), new Set())
    expect(signes.has('seul')).toBe(false)
  })
})
