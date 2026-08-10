import { describe, expect, it } from 'vitest'
import { layoutTurnEvents, normalizeResponse, type MinimalEvent } from './observatory-turn-layout'

const ev = (kind: string, content = ''): MinimalEvent => ({ kind, content })

describe('layoutTurnEvents', () => {
  it('regroupe message + injection + boundary en un groupe zone « sortant »', () => {
    const items = layoutTurnEvents([
      ev('message', 'salut'),
      ev('injection', 'sys'),
      ev('boundary', '{}')
    ])
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

describe('artefact — zone « réponse »', () => {
  // Ajouté le 2026-08-07 avec le traçage des artefacts : un artefact est une SORTIE du modèle, il
  // appartient donc à la zone réponse. Sans entrée dans ZONE_OF il serait rendu « hors zone »,
  // c'est-à-dire isolé au milieu de la chronologie, comme s'il n'avait aucun lien avec la réponse
  // qu'il accompagne.
  it('regroupe un artefact AVEC la réponse du modèle', () => {
    const items = layoutTurnEvents([
      { kind: 'model-response', content: 'voici ton rapport' },
      { kind: 'artifact', content: 'artefact : rapport.md' }
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'group', zone: 'reponse' })
    const group = items[0] as { type: 'group'; events: Array<{ event: { kind: string } }> }
    expect(group.events.map((entry) => entry.event.kind)).toEqual(['model-response', 'artifact'])
  })

  it('ne masque JAMAIS un artefact au titre de la déduplication de réponse', () => {
    // La dédup ne concerne que model-response vs response-displayed ; un artefact au contenu
    // ressemblant ne doit pas disparaître.
    const items = layoutTurnEvents([
      { kind: 'model-response', content: 'rapport' },
      { kind: 'artifact', content: 'rapport' }
    ])
    const group = items[0] as { type: 'group'; events: Array<{ event: { kind: string } }> }
    expect(group.events.map((entry) => entry.event.kind)).toContain('artifact')
  })
})
