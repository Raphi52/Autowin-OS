import { describe, expect, it } from 'vitest'
import { layoutTurnEvents, normalizeResponse, type MinimalEvent } from './observatory-turn-layout'

const ev = (kind: string, content = ''): MinimalEvent => ({ kind, content })

describe('layoutTurnEvents', () => {
  it('regroupe message + injection + boundary en un seul item « sortant »', () => {
    const items = layoutTurnEvents([ev('message', 'salut'), ev('injection', 'sys'), ev('boundary', '{}')])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'sortant' })
    expect(items[0].type === 'sortant' && items[0].events.map((e) => e.kind)).toEqual([
      'message',
      'injection',
      'boundary'
    ])
  })

  it('réponse identique : masque response-displayed → une seule ligne model-response', () => {
    const items = layoutTurnEvents([
      ev('model-response', 'Bonjour à toi'),
      ev('response-displayed', 'Bonjour  à toi\n') // même texte, espaces différents
    ])
    const kinds = items.map((i) => (i.type === 'event' ? i.event.kind : 'sortant'))
    expect(kinds).toEqual(['model-response'])
  })

  it('réponse divergente : garde les 2 lignes + marque response-displayed diverges', () => {
    const items = layoutTurnEvents([
      ev('model-response', 'Texte + <cmd>{"name":"x"}</cmd>'),
      ev('response-displayed', 'Texte') // commande retirée à l’affichage
    ])
    expect(items).toHaveLength(2)
    const displayed = items.find((i) => i.type === 'event' && i.event.kind === 'response-displayed')
    expect(displayed).toMatchObject({ type: 'event', diverges: true })
  })

  it('response-displayed vide → pas de divergence signalée, et masqué', () => {
    const items = layoutTurnEvents([ev('model-response', 'x'), ev('response-displayed', '   ')])
    expect(items.map((i) => (i.type === 'event' ? i.event.kind : 's'))).toEqual(['model-response'])
  })

  it('préserve les autres events (retry, error) et l’ordre autour du bloc sortant', () => {
    const items = layoutTurnEvents([
      ev('message', 'm'),
      ev('boundary', 'o'),
      ev('retry', 'r'),
      ev('model-response', 'ok')
    ])
    expect(items.map((i) => i.type)).toEqual(['sortant', 'event', 'event'])
  })

  it('normalizeResponse écrase espaces/bords', () => {
    expect(normalizeResponse('  a\n b  ')).toBe('a b')
  })
})
