import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * LA LIGNE « Brain » COMPTE LES NOTES DES ÉTAPES (conv-339). Le nombre vient du run
 * (`notesBrainDeposees`, joint par `avecNotesDeposees`) ; ces tests tiennent son affichage.
 */
const issue = (learning: Record<string, unknown>): Record<string, unknown> => ({
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  result: 'fait',
  learning
})
const ligneBrain = (learning: Record<string, unknown>): string | undefined =>
  formatOrchestrationOutcome(true, issue(learning) as never)
    .split('\n')
    .find((ligne) => ligne.startsWith('Brain : '))

describe('ligne Brain : les notes déposées par les étapes du run', () => {
  it('seules des notes : leur nombre est le libellé', () => {
    expect(ligneBrain({ state: 'inbox', detail: '', notesEnRevue: 2 })).toBe(
      'Brain : 2 notes candidates gardées en revue'
    )
    expect(ligneBrain({ state: 'inbox', detail: '', notesEnRevue: 1 })).toBe(
      'Brain : 1 note candidate gardée en revue'
    )
  })

  it('une leçon de fin de run ET des notes : les deux sont dits', () => {
    expect(
      ligneBrain({ state: 'published', detail: 'preuve causale confirmée', notesEnRevue: 3 })
    ).toBe(
      'Brain : leçon prouvée publiée · 3 notes candidates gardées en revue — preuve causale confirmée'
    )
  })

  it('jumeaux : sans note, ou avec un compte illisible, le libellé de l’état est inchangé', () => {
    expect(ligneBrain({ state: 'none', detail: 'aucune leçon proposée pour ce run' })).toBe(
      'Brain : aucune leçon proposée'
    )
    expect(ligneBrain({ state: 'none', detail: '', notesEnRevue: 'deux' })).toBe(
      'Brain : aucune leçon proposée'
    )
    expect(ligneBrain({ state: 'inbox', detail: 'preuve locale seulement' })).toBe(
      'Brain : leçon gardée en revue — preuve locale seulement'
    )
  })
})
