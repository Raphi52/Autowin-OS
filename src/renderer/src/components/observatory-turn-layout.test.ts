import { describe, expect, it } from 'vitest'
import { layoutTurnEvents, normalizeResponse, type MinimalEvent } from './observatory-turn-layout'

const ev = (kind: string, content = ''): MinimalEvent => ({ kind, content })

describe('layoutTurnEvents', () => {
  it('regroupe message + injection + boundary en un groupe zone « sortant »', () => {
    const items = layoutTurnEvents([ev('message', 'salut'), ev('injection', 'sys'), ev('boundary', '{}')])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'group', zone: 'sortant' })
    expect(items[0].type === 'group' && items[0].events.map((e) => e.event.kind)).toEqual([
      'message',
      'injection',
      'boundary'
    ])
  })

  it('regroupe model-response + response-displayed en zone « reponse »', () => {
    const items = layoutTurnEvents([
      ev('model-response', 'Texte + <cmd>x</cmd>'),
      ev('response-displayed', 'Texte')
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'group', zone: 'reponse' })
    const group = items[0]
    if (group.type !== 'group') throw new Error('attendu group')
    expect(group.events.map((e) => e.event.kind)).toEqual(['model-response', 'response-displayed'])
    // Le displayed divergent est marqué
    expect(group.events.find((e) => e.event.kind === 'response-displayed')?.diverges).toBe(true)
  })

  it('réponse identique : masque response-displayed → groupe reponse à une seule ligne', () => {
    const items = layoutTurnEvents([
      ev('model-response', 'Bonjour à toi'),
      ev('response-displayed', 'Bonjour  à toi\n')
    ])
    expect(items).toHaveLength(1)
    const group = items[0]
    if (group.type !== 'group') throw new Error('attendu group')
    expect(group.events.map((e) => e.event.kind)).toEqual(['model-response'])
  })

  it('regroupe handoff + verdict en zone « sousagent »', () => {
    const items = layoutTurnEvents([ev('handoff', 'délègue'), ev('verdict', 'ok')])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'group', zone: 'sousagent' })
  })

  it('events hors zone (retry, décision, outil) rendus isolés, ordre préservé', () => {
    const items = layoutTurnEvents([
      ev('message', 'm'),
      ev('boundary', 'o'),
      ev('retry', 'r'),
      ev('model-response', 'ok')
    ])
    expect(items.map((i) => (i.type === 'group' ? `g:${i.zone}` : `e:${i.event.kind}`))).toEqual([
      'g:sortant',
      'e:retry',
      'g:reponse'
    ])
  })

  it('normalizeResponse écrase espaces/bords', () => {
    expect(normalizeResponse('  a\n b  ')).toBe('a b')
  })
})
