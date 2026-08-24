import { describe, expect, it } from 'vitest'
import {
  DELAI_ENTRE_DEUX_REPECHAGES_MS,
  estRepechable,
  travauxARepecher,
  type CandidatAuRepechage
} from './repechage-automatique'

/**
 * LE DÉFAUT que ces tests verrouillent : rien ne repêchait un travail tout seul. Republier
 * n'existait que comme un bouton — `worktree:retry-recovery` est un `ipcMain.handle` sans aucun
 * appelant automatique. Quatorze travaux terminés dormaient sur des branches de secours parce que
 * personne n'avait ouvert le bon panneau.
 *
 * Ces tests tiennent les deux exigences opposées : repêcher SEUL ce qui est récupérable, et ne
 * JAMAIS toucher à ce qui demande une vraie décision humaine.
 */

const candidat = (partiel: Partial<CandidatAuRepechage>): CandidatAuRepechage => ({
  runId: 'run-1',
  ...partiel
})

describe('qui mérite d’être repêché sans demander à personne', () => {
  it('repêche un travail dont la reprise s’est épuisée — le cas des quatorze dormants', () => {
    expect(
      estRepechable(candidat({ publication: 'pending', attentionReason: 'retry-exhausted' }))
    ).toBe(true)
  })

  it('repêche un travail JAMAIS JUGÉ — onze des quatorze sont des `command-edit` sans verdict', () => {
    expect(
      estRepechable(
        candidat({ publication: 'pending', attentionReason: 'retry-exhausted', verdict: undefined })
      )
    ).toBe(true)
  })

  it('NE repêche JAMAIS un travail jugé mauvais, même si tout le reste l’y autorise', () => {
    // L'entrée qui DOIT faire échouer une garde trop permissive : elle coche chaque condition de
    // reprise, et seul `red` la retient.
    expect(
      estRepechable(
        candidat({ publication: 'pending', attentionReason: 'retry-exhausted', verdict: 'red' })
      )
    ).toBe(false)
  })

  it('repêche un refus de fusion, qui se répare souvent tout seul quand la base se calme', () => {
    expect(
      estRepechable(candidat({ publication: 'blocked', attentionReason: 'merge-failed' }))
    ).toBe(true)
  })

  it('laisse tranquille un travail bloqué pour une raison qui EXIGE une décision humaine', () => {
    expect(
      estRepechable(candidat({ publication: 'blocked', attentionReason: 'conflict' }))
    ).toBe(false)
  })

  it('ne touche pas à un travail déjà publié', () => {
    expect(estRepechable(candidat({ publication: 'published' }))).toBe(false)
  })

  it('ne touche pas à un travail qui n’attend rien', () => {
    expect(estRepechable(candidat({ publication: 'pending' }))).toBe(false)
  })
})

describe('à quelle cadence le balayage repasse', () => {
  const dormant = candidat({
    runId: 'dormant',
    publication: 'pending',
    attentionReason: 'retry-exhausted'
  })

  it('emporte au PREMIER tour un travail jamais tenté automatiquement', () => {
    expect(travauxARepecher([dormant], new Map(), 1_000_000)).toEqual(['dormant'])
  })

  it('ne le martèle pas : juste après un essai, il est laissé au repos', () => {
    const derniers = new Map([['dormant', 1_000_000]])
    expect(travauxARepecher([dormant], derniers, 1_000_000 + 1_000)).toEqual([])
  })

  it('le reprend une fois le délai écoulé', () => {
    const derniers = new Map([['dormant', 1_000_000]])
    expect(
      travauxARepecher([dormant], derniers, 1_000_000 + DELAI_ENTRE_DEUX_REPECHAGES_MS)
    ).toEqual(['dormant'])
  })

  it('une horloge qui RECULE ne gèle pas un travail pour toujours', () => {
    // Changement d'heure, machine remise à l'heure : sans cette garde, `maintenant - dernier` reste
    // négatif et le travail n'est plus jamais repêché.
    const derniers = new Map([['dormant', 5_000_000]])
    expect(travauxARepecher([dormant], derniers, 1_000)).toEqual(['dormant'])
  })

  it('ne rend que les repêchables, en ignorant les autres du même lot', () => {
    const lot = [
      dormant,
      candidat({ runId: 'juge-mauvais', publication: 'pending', attentionReason: 'retry-exhausted', verdict: 'red' }),
      candidat({ runId: 'publie', publication: 'published' })
    ]
    expect(travauxARepecher(lot, new Map(), 1_000_000)).toEqual(['dormant'])
  })
})
