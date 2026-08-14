import { describe, expect, it } from 'vitest'
import { extraireVotesJuges, lireContratEtendu } from './juges-votes'

/** Le panneau des juges (14/08) : votes en barre, verdict complet en dépliant. */
describe('extraireVotesJuges', () => {
  const steps = [
    { step: 'exec', model: 'worker', text: 'livrable' },
    {
      step: 'judge',
      model: 'claude-opus',
      detail: 'vote: VALIDE',
      text: 'VALIDE — les preuves couvrent la DoD.',
      costUsd: 0.12,
      durationMs: 9000
    },
    {
      step: 'judge',
      model: 'gpt-5.6-sol',
      detail: 'vote: DEFAUT',
      text: 'DEFAUT: la citation de la ligne 42 ne correspond pas au fichier.'
    },
    { step: 'judge', model: 'kimi', status: 'failed', error: 'timeout après 240s' }
  ]

  it('rend un vote par juge, avec le verdict complet et l’identité du modèle', () => {
    const votes = extraireVotesJuges(steps)
    expect(votes).toHaveLength(3)
    expect(votes[0]).toMatchObject({ libelle: 'claude-opus', vote: 'valide', costUsd: 0.12 })
    expect(votes[1]).toMatchObject({ libelle: 'gpt-5.6-sol', vote: 'defaut' })
    expect(votes[1].texte).toContain('ligne 42')
  })

  it('un juge crashé apparaît en ÉCHEC — le cacher gonflerait le quorum apparent', () => {
    const votes = extraireVotesJuges(steps)
    expect(votes[2]).toMatchObject({ libelle: 'kimi', vote: 'echec' })
    expect(votes[2].texte).toContain('timeout')
  })

  it('ignore les steps non-juge et le verdict agrégé sans modèle', () => {
    expect(
      extraireVotesJuges([
        { step: 'exec', model: 'w', text: 'x' },
        { step: 'judge', text: 'VALIDE' }
      ])
    ).toHaveLength(0)
  })

  it('sans detail vote:, le texte tranche (VALIDE en tête = valide)', () => {
    const votes = extraireVotesJuges([{ step: 'judge', model: 'm', text: 'VALIDE — ok.' }])
    expect(votes[0].vote).toBe('valide')
  })
})

describe('lireContratEtendu — SCORE et OBJECTIONS du contrat étendu (14/08)', () => {
  const verdict = [
    'DEFAUT: la preuve Vitest manque.',
    'SCORE: 62',
    'OBJECTIONS:',
    '- le « 59/59 tests réussis » n’est soutenu par aucune exécution observée',
    '- la synthèse CLEAN omet l’impact du chantier n°3'
  ].join('\n')

  it('lit la conclusion, le score et les objections', () => {
    const lu = lireContratEtendu(verdict)
    expect(lu.conclusion).toBe('DEFAUT: la preuve Vitest manque.')
    expect(lu.score).toBe(62)
    expect(lu.objections).toHaveLength(2)
    expect(lu.objections![0]).toContain('59/59')
  })

  it('tolère un verdict ancien sans contrat étendu', () => {
    const lu = lireContratEtendu('VALIDE')
    expect(lu.conclusion).toBe('VALIDE')
    expect(lu.score).toBeUndefined()
    expect(lu.objections).toBeUndefined()
  })

  it('les votes portent les champs étendus', () => {
    const votes = extraireVotesJuges([
      { step: 'judge', model: 'm', text: verdict, detail: 'vote: DEFAUT' }
    ])
    expect(votes[0]).toMatchObject({ score: 62, conclusion: 'DEFAUT: la preuve Vitest manque.' })
  })
})
