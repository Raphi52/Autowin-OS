import { describe, expect, it } from 'vitest'
import { attendUneDecision, isBlocked, mentionDEtatDuRun } from './run-blocked'

/**
 * LA RÈGLE DU « RUN BLOQUÉ » FACE À UN RUN QUI ATTEND SA PUBLICATION (conv-1455, 2026-11-03).
 *
 * conv-1431 (`mvz01n0m`) : juge VALIDE, fusion refusée `base-dirty`, RUN.md clos `red` avec une DoD
 * à 3 sur 4 (la case du commit). Il restait « bloqué » dans la liste servie à chaque tour, alors que
 * le coordinateur le repêchait seul et qu'il a été publié une heure plus tard (b0c4cad9).
 *
 * L'ENTRÉE QUI FERAIT ÉCHOUER CES TESTS SI LA CORRECTION ÉTAIT FAUSSE : un run `red` sans cause, même
 * DoD — il doit rester bloqué ; une règle qui sortirait tout `red` à DoD 3/4 le cacherait.
 */
const DOD_CONV_1431 = { dodTotal: 4, dodChecked: 3 }

describe('isBlocked / mentionDEtatDuRun — en attente de publication', () => {
  it('un run interrompu pour attendre sa publication n’est pas bloqué, et le dit', () => {
    const run = { status: 'interrupted', interruption: 'publication' as const, ...DOD_CONV_1431 }
    expect(isBlocked(run)).toBe(false)
    expect(attendUneDecision({ ...run, decisionAttendue: true })).toBe(false)
    expect(mentionDEtatDuRun(run)).toBe('en attente de publication')
  })

  it('JUMEAU : le même run clos `red` sans cause (conv-1431 tel qu’il est aujourd’hui) reste bloqué', () => {
    const run = { status: 'red', ...DOD_CONV_1431 }
    expect(isBlocked(run)).toBe(true)
    expect(mentionDEtatDuRun(run)).toBe('bloqué')
  })

  it('JUMEAU : un run interrompu sans cause lisible garde « interrompu, relançable »', () => {
    expect(mentionDEtatDuRun({ status: 'interrupted', ...DOD_CONV_1431 })).toBe(
      'interrompu, relançable'
    )
  })
})
