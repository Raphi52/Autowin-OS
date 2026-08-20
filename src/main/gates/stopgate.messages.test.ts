/**
 * LES MOTIFS DE REFUS SONT ÉCRITS POUR L'UTILISATEUR, PAS POUR LE MÉCANISME.
 *
 * Demandé le 20/08, après conv-1334 : « Statut "red" : la clôture a été refusée en amont. / DoD non
 * tenue : « Mutation demandee produite avec une preuve executable ». — je comprends même pas ce que
 * ça veut dire ». Trois jargons dans deux lignes : `red` (le statut interne du RUN.md), « clôture »
 * (le fait de fermer un run), « DoD » (Definition of Done, la liste de ce qui était promis). Le
 * message disait la vérité et n'apprenait rien.
 *
 * Ces chaînes SORTENT de l'app : elles s'affichent dans le fil de conversation. Elles doivent donc
 * se lire sans connaître le vocabulaire du moteur.
 */
import { describe, expect, it } from 'vitest'
import { CLOSURE_UPSTREAM_REFUSAL, evaluateClosure } from './stopgate'

/** Aucun terme de mécanique interne ne doit survivre dans un message montré à l'utilisateur. */
const JARGON = ['DoD', 'clôture', 'red', 'open', '!=', 'Statut "']

describe('motifs de refus — lisibles sans le vocabulaire du moteur', () => {
  it('un run en échec dit QUI a échoué, sans parler de « statut red » ni de « clôture »', () => {
    const refus = evaluateClosure({ status: 'red', dod: [] })
    expect(refus.blocked).toBe(true)
    const motif = refus.reasons[0]
    expect(motif).toBe(CLOSURE_UPSTREAM_REFUSAL)
    for (const mot of JARGON) expect(motif).not.toContain(mot)
    expect(motif.toLowerCase()).toContain('échec')
  })

  it('un run jamais fermé le dit en français, sans « statut open »', () => {
    const motif = evaluateClosure({ status: 'open', dod: [] }).reasons[0]
    for (const mot of JARGON) expect(motif).not.toContain(mot)
    expect(motif.toLowerCase()).toContain('pas termin')
  })

  it('une promesse non tenue NOMME la promesse, sans dire « DoD »', () => {
    const motif = evaluateClosure({
      status: 'green',
      dod: [
        { checked: false, hasContent: true, label: 'Mutation demandée produite avec une preuve' }
      ]
    }).reasons[0]
    for (const mot of JARGON) expect(motif).not.toContain(mot)
    expect(motif).toContain('Mutation demandée produite avec une preuve')
    expect(motif.toLowerCase()).toContain('promis')
  })

  it('sans libellé, elle compte les promesses — toujours sans jargon', () => {
    const motif = evaluateClosure({
      status: 'green',
      dod: [
        { checked: false, hasContent: true },
        { checked: false, hasContent: true }
      ]
    }).reasons[0]
    for (const mot of JARGON) expect(motif).not.toContain(mot)
    expect(motif).toContain('2')
  })

  it('un contrôle en échec explique ce qu’est un code de sortie', () => {
    const motif = evaluateClosure({ status: 'green', dod: [], signalExitCode: 1 }).reasons[0]
    for (const mot of JARGON) expect(motif).not.toContain(mot)
    expect(motif).toContain('1')
    expect(motif).toContain('0 = réussi')
  })
})
