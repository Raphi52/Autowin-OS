import { describe, expect, it } from 'vitest'
import { parseDecompositionPlan } from './greedy-decompose'

describe('parseDecompositionPlan', () => {
  it('parse un tableau JSON propre en nœuds', () => {
    const plan = parseDecompositionPlan(
      '[{"id":"a","prompt":"fais a","deps":[]},{"id":"b","prompt":"fais b","deps":["a"]}]'
    )
    expect(plan).toEqual([
      { id: 'a', prompt: 'fais a', deps: [] },
      { id: 'b', prompt: 'fais b', deps: ['a'] }
    ])
  })

  it('extrait le JSON même entouré de prose / fences ```json', () => {
    const text = 'Voici le plan :\n```json\n[{"id":"x","prompt":"p","deps":[]}]\n```\nVoilà.'
    expect(parseDecompositionPlan(text)).toEqual([{ id: 'x', prompt: 'p', deps: [] }])
  })

  it('rejette (→ []) un plan avec dépendance inconnue', () => {
    expect(
      parseDecompositionPlan('[{"id":"a","prompt":"p","deps":["ghost"]}]')
    ).toEqual([])
  })

  it('rejette (→ []) un cycle', () => {
    expect(
      parseDecompositionPlan(
        '[{"id":"a","prompt":"p","deps":["b"]},{"id":"b","prompt":"q","deps":["a"]}]'
      )
    ).toEqual([])
  })

  it('rejette (→ []) ids dupliqués, prompt vide, ou item non-objet', () => {
    expect(parseDecompositionPlan('[{"id":"a","prompt":"p","deps":[]},{"id":"a","prompt":"q","deps":[]}]')).toEqual([])
    expect(parseDecompositionPlan('[{"id":"a","prompt":"","deps":[]}]')).toEqual([])
    expect(parseDecompositionPlan('[42]')).toEqual([])
  })

  it('renvoie [] sur absence de JSON, JSON invalide, ou tableau vide', () => {
    expect(parseDecompositionPlan('aucun plan ici')).toEqual([])
    expect(parseDecompositionPlan('[{cassé}]')).toEqual([])
    expect(parseDecompositionPlan('[]')).toEqual([])
    expect(parseDecompositionPlan('')).toEqual([])
  })

  it('tolère deps absent (⇒ [])', () => {
    expect(parseDecompositionPlan('[{"id":"a","prompt":"p"}]')).toEqual([{ id: 'a', prompt: 'p', deps: [] }])
  })
})
