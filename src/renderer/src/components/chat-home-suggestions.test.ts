import { describe, expect, it } from 'vitest'
import { STATIC_SUGGESTIONS, buildHomeSuggestions, isBlockedRun } from './chat-home-suggestions'

describe('buildHomeSuggestions', () => {
  it('retombe sur le jeu statique quand l’état est vide', () => {
    const groups = buildHomeSuggestions({})
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.label)).toEqual(STATIC_SUGGESTIONS)
  })

  it('propose de débloquer chaque run bloqué, avec une mention @run exploitable', () => {
    const groups = buildHomeSuggestions({
      runs: [
        { subject: 'workflow-bench-regression', summary: { status: 'bloqué' } },
        { subject: 'chatview-reprise-tours', summary: { status: 'open' } },
        { subject: 'deja-clos', summary: { status: 'green' } }
      ]
    })
    const labels = groups.flatMap((g) => g.items.map((i) => i.label))
    expect(labels).toEqual([
      'Débloque @run:workflow-bench-regression',
      'Débloque @run:chatview-reprise-tours'
    ])
  })

  it('n’affiche RIEN tant qu’un brouillon est en cours — il ne doit pas être recopié à l’écran', () => {
    expect(
      buildHomeSuggestions({
        resumedDraft: 'prompt à restaurer',
        runs: [{ subject: 'r1', summary: { status: 'bloqué' } }]
      })
    ).toEqual([])
  })

  it('classe les statuts sans se tromper sur les runs terminés', () => {
    expect(isBlockedRun('bloqué')).toBe(true)
    expect(isBlockedRun('open')).toBe(true)
    expect(isBlockedRun('green')).toBe(false)
    expect(isBlockedRun(undefined)).toBe(false)
  })
})
